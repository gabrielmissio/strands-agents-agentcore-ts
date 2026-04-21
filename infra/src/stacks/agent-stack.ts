import * as cdk from 'aws-cdk-lib'
import * as bedrockagentcore from 'aws-cdk-lib/aws-bedrockagentcore'
import * as ecrassets from 'aws-cdk-lib/aws-ecr-assets'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'
import { fileURLToPath } from 'node:url'

export type AgentAuthMode = 'cognito' | 'sigv4'

export interface AgentStackProps extends cdk.StackProps {
  projectName: string
  agentAuthMode: AgentAuthMode
  imagePlatform?: ecrassets.Platform
  runtimeEnvironment?: Record<string, string>
  cognitoDiscoveryUrl?: string
  cognitoUserPoolClientId?: string
}

function compactEnvironment(environment: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value && value.trim().length > 0),
  ) as Record<string, string>
}

export class AgentStack extends cdk.Stack {
  public readonly runtimeArn: string
  public readonly runtimeId: string
  public readonly runtimeStatus: string
  public readonly executionRoleArn: string
  public readonly imageUri: string

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props)

    const {
      projectName,
      agentAuthMode,
      imagePlatform,
      runtimeEnvironment,
      cognitoDiscoveryUrl,
      cognitoUserPoolClientId,
    } = props

    const agentDirectory = fileURLToPath(new URL('../../../agent', import.meta.url))

    const imageAsset = new ecrassets.DockerImageAsset(this, 'AgentImage', {
      directory: agentDirectory,
      platform: imagePlatform,
    })

    const runtimeExecutionPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'EcrImageAccess',
          effect: iam.Effect.ALLOW,
          actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
          resources: [cdk.Stack.of(this).formatArn({ service: 'ecr', resource: 'repository', resourceName: '*' })],
        }),
        new iam.PolicyStatement({
          sid: 'EcrTokenAccess',
          effect: iam.Effect.ALLOW,
          actions: ['ecr:GetAuthorizationToken'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'RuntimeLogs',
          effect: iam.Effect.ALLOW,
          actions: ['logs:DescribeLogStreams', 'logs:CreateLogGroup'],
          resources: [
            cdk.Stack.of(this).formatArn({
              service: 'logs',
              resource: 'log-group',
              resourceName: '/aws/bedrock-agentcore/runtimes/*',
              arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
        new iam.PolicyStatement({
          sid: 'DescribeLogGroups',
          effect: iam.Effect.ALLOW,
          actions: ['logs:DescribeLogGroups'],
          resources: [
            cdk.Stack.of(this).formatArn({
              service: 'logs',
              resource: 'log-group',
              resourceName: '*',
              arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
        new iam.PolicyStatement({
          sid: 'WriteRuntimeLogs',
          effect: iam.Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [
            cdk.Stack.of(this).formatArn({
              service: 'logs',
              resource: 'log-group',
              resourceName: '/aws/bedrock-agentcore/runtimes/*:log-stream:*',
              arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
        new iam.PolicyStatement({
          sid: 'RuntimeTracing',
          effect: iam.Effect.ALLOW,
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          sid: 'RuntimeMetrics',
          effect: iam.Effect.ALLOW,
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'cloudwatch:namespace': 'bedrock-agentcore',
            },
          },
        }),
        new iam.PolicyStatement({
          sid: 'BedrockModelAccess',
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: [
            'arn:aws:bedrock:*::foundation-model/*',
            cdk.Stack.of(this).formatArn({ service: 'bedrock', resource: '*' }),
          ],
        }),
      ],
    })

    const runtimeRole = new iam.Role(this, 'RuntimeExecutionRole', {
      roleName: `${projectName}-agentcore-runtime-role`,
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': cdk.Stack.of(this).formatArn({
              service: 'bedrock-agentcore',
              resource: '*',
            }),
          },
        },
      }),
      description: 'Execution role for the Bedrock AgentCore runtime.',
      inlinePolicies: {
        RuntimeExecutionPolicy: runtimeExecutionPolicy,
      },
    })

    const authorizerConfiguration =
      agentAuthMode === 'cognito' && cognitoDiscoveryUrl && cognitoUserPoolClientId
        ? {
            customJwtAuthorizer: {
              discoveryUrl: cognitoDiscoveryUrl,
              allowedClients: [cognitoUserPoolClientId],
            },
          }
        : undefined

    const runtime = new bedrockagentcore.CfnRuntime(this, 'AgentRuntime', {
      agentRuntimeName: projectName.replaceAll('-', '_'),
      description: `AgentCore runtime for ${projectName}`,
      roleArn: runtimeRole.roleArn,
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: imageAsset.imageUri,
        },
      },
      networkConfiguration: {
        networkMode: 'PUBLIC',
      },
      protocolConfiguration: 'HTTP',
      environmentVariables: compactEnvironment({
        AWS_REGION: this.region,
        PORT: '8080',
        ...runtimeEnvironment,
      }),
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: 900,
        maxLifetime: 14400,
      },
      authorizerConfiguration,
      tags: {
        Project: projectName,
        AgentAuthMode: agentAuthMode,
      },
    })

    this.runtimeArn = runtime.attrAgentRuntimeArn
    this.runtimeId = runtime.attrAgentRuntimeId
    this.runtimeStatus = runtime.attrStatus
    this.executionRoleArn = runtimeRole.roleArn
    this.imageUri = imageAsset.imageUri

    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.runtimeArn,
      exportName: `${projectName}-AgentRuntimeArn`,
    })

    new cdk.CfnOutput(this, 'AgentRuntimeId', {
      value: this.runtimeId,
      exportName: `${projectName}-AgentRuntimeId`,
    })

    new cdk.CfnOutput(this, 'AgentRuntimeStatus', {
      value: this.runtimeStatus,
      exportName: `${projectName}-AgentRuntimeStatus`,
    })

    new cdk.CfnOutput(this, 'AgentRuntimeExecutionRoleArn', {
      value: this.executionRoleArn,
      exportName: `${projectName}-AgentRuntimeExecutionRoleArn`,
    })

    new cdk.CfnOutput(this, 'AgentImageUri', {
      value: this.imageUri,
      exportName: `${projectName}-AgentImageUri`,
    })
  }
}