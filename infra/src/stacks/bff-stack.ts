import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import { Construct } from 'constructs'
import { ADMIN_GROUP_NAME } from './auth-stack.js'
import { DEFAULT_USER_RATE_LIMIT, type ApiThrottle, type UserRateLimit } from '../config.js'

export interface BffStackProps extends cdk.StackProps {
  projectName: string
  userPool: cognito.UserPool
  agentRuntimeArn: string
  /** Caps requests/second on the API stage. Every request that gets through costs Bedrock tokens. */
  throttle: ApiThrottle
  /**
   * Browser origin allowed to call this API — both on the CORS preflight and on every response
   * header the Lambdas set. Defaults to `*` (see `resolveAllowedOrigin` in `config.ts` for why).
   */
  allowedOrigin?: string
  /**
   * Caps how often one signed-in caller can hit `/chat`, independent of `throttle` above (which
   * caps the whole account). Defaults to `DEFAULT_USER_RATE_LIMIT`.
   */
  userRateLimit?: UserRateLimit
  /** Subscribed to alarms and to the budget. The alarms exist either way. */
  alertEmail?: string
  /** Monthly USD ceiling that triggers a budget notification. Omitted disables the budget. */
  monthlyBudgetUsd?: number
}

export class BffStack extends cdk.Stack {
  /** The /chat endpoint URL — consumed by FrontendStack for env-var injection */
  public readonly apiUrl: string

  constructor(scope: Construct, id: string, props: BffStackProps) {
    super(scope, id, props)

    const {
      projectName,
      userPool,
      agentRuntimeArn,
      throttle,
      allowedOrigin = '*',
      userRateLimit = DEFAULT_USER_RATE_LIMIT,
      alertEmail,
      monthlyBudgetUsd,
    } = props

    // ── Per-caller rate limit table ─────────────────────────────────────
    // Holds one item per (caller, time window) — see chatbot-bff/src/rate-limit.ts for the
    // check-and-increment logic. Pure operational counters, not user data: on-demand billing (this
    // is bursty, low-volume traffic, not worth provisioning capacity for) and always destroyable,
    // regardless of RETAIN_DATA — losing it just means every caller's quota resets.
    const rateLimitTable = new dynamodb.Table(this, 'RateLimitTable', {
      tableName: `${projectName}-bff-rate-limit`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

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
        ALLOWED_ORIGIN: allowedOrigin,
        AGENT_RUNTIME_ARN: agentRuntimeArn,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
        USER_RATE_LIMIT: String(userRateLimit.limit),
        USER_RATE_LIMIT_WINDOW_SECONDS: String(userRateLimit.windowSeconds),
      },
      logGroup: new logs.LogGroup(this, 'ChatFunctionLogs', {
        logGroupName: `/aws/lambda/${projectName}-bff`,
        // A week does not survive an incident found after a weekend.
        retention: logs.RetentionDays.ONE_MONTH,
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

    // ── IAM: rate-limit table — UpdateItem only, that's the only operation checkRateLimit needs ──
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:UpdateItem'],
        resources: [rateLimitTable.tableArn],
      }),
    )

    // ── API Gateway REST API ───────────────────────────────────────────
    // Access logs answer "who called what, when" at the edge — the admin function's own audit
    // lines (see chatbot-bff/src/admin.ts) cover intent, these cover reach. `dataTraceEnabled` stays
    // off on purpose: it would write request and response bodies into CloudWatch, which is how a
    // conversation leaks into the logs.
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/${projectName}-chat-api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: `${projectName}-chat-api`,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        // Without this the stage inherits the account default (10k rps), which is not a limit so
        // much as an invitation — every request that gets through costs Bedrock tokens.
        throttlingRateLimit: throttle.rateLimit,
        throttlingBurstLimit: throttle.burstLimit,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        // Identity and outcome, no payload.
        accessLogFormat: apigateway.AccessLogFormat.custom(
          JSON.stringify({
            requestId: apigateway.AccessLogField.contextRequestId(),
            at: apigateway.AccessLogField.contextRequestTime(),
            method: apigateway.AccessLogField.contextHttpMethod(),
            path: apigateway.AccessLogField.contextResourcePath(),
            status: apigateway.AccessLogField.contextStatus(),
            latencyMs: apigateway.AccessLogField.contextResponseLatency(),
            sourceIp: apigateway.AccessLogField.contextIdentitySourceIp(),
            actorSub: apigateway.AccessLogField.contextAuthorizerClaims('sub'),
          }),
        ),
      },
      defaultCorsPreflightOptions: {
        // Mirrors ALLOWED_ORIGIN on the Lambdas above — a specific origin here without a matching
        // env var (or vice versa) would pass preflight but fail on the actual response, or the
        // reverse. Both read from the same `allowedOrigin` prop so they can't drift.
        allowOrigins: allowedOrigin === '*' ? apigateway.Cors.ALL_ORIGINS : [allowedOrigin],
        // GET is here for the admin user listing; the chat route is POST only.
        allowMethods: ['GET', 'POST', 'OPTIONS'],
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

    // ── Admin function ─────────────────────────────────────────────────
    // Deliberately a second function rather than more routes on the chat one: this is the only
    // role that carries `cognito-idp:AdminCreate*`, and the chat function — the one relaying model
    // output — must not be able to create users or hand out admin membership.
    const adminFn = new lambda.Function(this, 'AdminFunction', {
      functionName: `${projectName}-bff-admin`,
      code: lambda.Code.fromAsset('../chatbot-bff', {
        exclude: ['node_modules', 'src', '*.ts', 'tsup.config.*', '.env*'],
      }),
      handler: 'dist/admin-handler.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      // Matched to the API Gateway REST integration ceiling, which is a hard 29 seconds for a
      // buffered (non-streaming) response like this one's. A longer Lambda timeout isn't extra
      // headroom — it's a function that keeps running and billing after the gateway has already
      // returned 504 to a client that's gone. The chat function stays at 60s: it streams
      // (`ResponseTransferMode.STREAM`), so it isn't held to the same buffered-integration cap.
      timeout: cdk.Duration.seconds(29),
      memorySize: 256,
      architecture: lambda.Architecture.X86_64,
      environment: {
        ALLOWED_ORIGIN: allowedOrigin,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        ADMIN_GROUP_NAME,
      },
      logGroup: new logs.LogGroup(this, 'AdminFunctionLogs', {
        logGroupName: `/aws/lambda/${projectName}-bff-admin`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Scoped to this pool, and to the specific actions the two routes need — no blanket
    // `cognito-idp:*`, which would also grant deleting users and rewriting the pool's policies.
    adminFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cognito-idp:ListUsers',
          'cognito-idp:ListUsersInGroup',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [userPool.userPoolArn],
      }),
    )

    // ── /admin/users ───────────────────────────────────────────────────
    // Same Cognito authorizer as /chat, so the gateway still validates the token's signature,
    // expiry and issuer. Membership in the admin group is enforced inside the function, which is
    // safe to centralize there because this function serves admin routes and nothing else.
    const adminIntegration = new apigateway.LambdaIntegration(adminFn, { proxy: true })
    const adminUsers = api.root.addResource('admin').addResource('users')

    for (const method of ['GET', 'POST']) {
      adminUsers.addMethod(method, adminIntegration, {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      })
    }

    // ── Operations: alarms and a spend ceiling ──────────────────────────
    // Without these you find out the deployment is broken, or expensive, from a user or an invoice.
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${projectName}-alarms`,
      displayName: `${projectName} alarms`,
    })

    if (alertEmail) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail))
    }

    const alarms: cloudwatch.Alarm[] = [
      new cloudwatch.Alarm(this, 'ChatFunctionErrors', {
        alarmName: `${projectName}-chat-errors`,
        alarmDescription: 'The chat Lambda is failing — users see a broken conversation.',
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'AdminFunctionErrors', {
        alarmName: `${projectName}-admin-errors`,
        alarmDescription: 'The admin Lambda is failing — invites and the user list are broken.',
        metric: adminFn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ApiServerErrors', {
        alarmName: `${projectName}-api-5xx`,
        alarmDescription: 'The API is returning 5XX — the failure is at or before the integration.',
        metric: api.metricServerError({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ]

    for (const alarm of alarms) {
      alarm.addAlarmAction(new cwactions.SnsAction(alarmTopic))
    }

    // A budget alerts; it cannot stop spend. It exists so a runaway loop is noticed in hours rather
    // than on the invoice. Account-wide by nature, so it needs an address to notify.
    if (monthlyBudgetUsd && alertEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: `${projectName}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [80, 100].map((threshold) => ({
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
        })),
      })
    }

    this.apiUrl = api.url

    // ── Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `${api.url}chat`,
      exportName: `${projectName}-BffUrl`,
    })
  }
}
