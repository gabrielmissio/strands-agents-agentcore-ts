import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import { Construct } from 'constructs'

export interface BffStackProps extends cdk.StackProps {
  projectName: string
  userPool: cognito.UserPool
  agentRuntimeArn: string
}

export class BffStack extends cdk.Stack {
  /** The /chat endpoint URL — consumed by FrontendStack for env-var injection */
  public readonly apiUrl: string

  constructor(scope: Construct, id: string, props: BffStackProps) {
    super(scope, id, props)

    const { projectName, userPool, agentRuntimeArn } = props

    // ── Lambda function ────────────────────────────────────────────────
    const fn = new lambda.Function(this, 'ChatFunction', {
      functionName: `${projectName}-bff`,
      // Pre-built by `npm run build` in chatbot-bff/
      code: lambda.Code.fromAsset('../chatbot-bff', {
        exclude: ['node_modules', 'src', '*.ts', 'tsup.config.*', '.env*'],
      }),
      handler: 'dist/handler.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      architecture: lambda.Architecture.X86_64,
      environment: {
        ALLOWED_ORIGIN: '*',
        AGENT_RUNTIME_ARN: agentRuntimeArn,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
      },
      logGroup: new logs.LogGroup(this, 'ChatFunctionLogs', {
        logGroupName: `/aws/lambda/${projectName}-bff`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // ── IAM: allow invoking AgentCore (for sigv4 mode) ─────────────────
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [agentRuntimeArn, `${agentRuntimeArn}/runtime-endpoint/*`],
      }),
    )

    // ── API Gateway REST API ───────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: `${projectName}-chat-api`,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    // ── Cognito authorizer (mirrors the SAM CognitoAuthorizer) ─────────
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `${projectName}-cognito-authorizer`,
      identitySource: 'method.request.header.Authorization',
    })

    // ── Lambda integration with response streaming ─────────────────────
    // `streamifyResponse` requires InvokeWithResponseStream permission.
    fn.addPermission('ApiGwInvokeStream', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      action: 'lambda:InvokeWithResponseStream',
      sourceArn: api.arnForExecuteApi('POST', '/chat', 'prod'),
    })

    const integration = new apigateway.LambdaIntegration(fn, {
      proxy: true,
      responseTransferMode: apigateway.ResponseTransferMode.STREAM, // IMPORTANT: Sets stream mode
    })

    // ── POST /chat ─────────────────────────────────────────────────────
    const chatResource = api.root.addResource('chat')
    chatResource.addMethod('POST', integration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    })

    this.apiUrl = api.url

    // ── Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `${api.url}chat`,
      exportName: `${projectName}-BffUrl`,
    })
  }
}
