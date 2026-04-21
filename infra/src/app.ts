#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import * as ecrassets from 'aws-cdk-lib/aws-ecr-assets'
import { AgentStack, type AgentAuthMode } from './stacks/agent-stack.js'
import { AuthStack } from './stacks/auth-stack.js'
import { BffStack } from './stacks/bff-stack.js'
import { FrontendStack } from './stacks/frontend-stack.js'

const app = new cdk.App()

const projectName = app.node.tryGetContext('projectName') ??  process.env.PROJECT_NAME ?? 'web3-caveman'

function resolveAgentAuthMode(input?: string): AgentAuthMode {
  const normalized = input?.trim().toLowerCase()

  if (!normalized || normalized === 'jwt' || normalized === 'cognito') {
    return 'cognito'
  }

  if (normalized === 'sigv4') {
    return 'sigv4'
  }

  throw new Error(`Unsupported AGENT_AUTH_MODE: ${input}`)
}

function resolveFrontendAgentMode(input: string | undefined, agentAuthMode: AgentAuthMode) {
  const normalized = input?.trim().toLowerCase()

  if (!normalized) {
    return agentAuthMode === 'cognito' ? 'direct' as const : 'bff' as const
  }

  if (normalized !== 'direct' && normalized !== 'bff') {
    throw new Error(`Unsupported FRONTEND_AGENT_MODE: ${input}`)
  }

  if (agentAuthMode === 'sigv4' && normalized === 'direct') {
    throw new Error('FRONTEND_AGENT_MODE=direct is not supported when AGENT_AUTH_MODE=sigv4. Use bff.')
  }

  return normalized
}

function pickDefinedEnvironment(keys: string[]) {
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]])
      .filter(([, value]) => value && value.trim().length > 0),
  ) as Record<string, string>
}

function resolveAgentImagePlatform(input?: string) {
  const normalized = input?.trim().toLowerCase()

  if (!normalized || normalized === 'linux/arm64' || normalized === 'arm64') {
    return ecrassets.Platform.LINUX_ARM64
  }

  if (normalized === 'linux/amd64' || normalized === 'amd64') {
    return ecrassets.Platform.LINUX_AMD64
  }

  if (normalized === 'current' || normalized === 'local' || normalized === 'host') {
    return undefined
  }

  return ecrassets.Platform.custom(input as string)
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
}

const agentAuthMode = resolveAgentAuthMode(
  app.node.tryGetContext('agentAuthMode') ?? process.env.AGENT_AUTH_MODE,
)

const frontendAgentMode = resolveFrontendAgentMode(
  app.node.tryGetContext('frontendAgentMode') ?? process.env.FRONTEND_AGENT_MODE,
  agentAuthMode,
)

const agentImagePlatform = resolveAgentImagePlatform(
  app.node.tryGetContext('agentImagePlatform') ?? process.env.AGENT_IMAGE_PLATFORM,
)

// ── Auth (Cognito User Pool + Identity Pool) ───────────────────────────
const authStack = new AuthStack(app, `${projectName}-auth`, {
  projectName,
  env,
})

// ── Agent Runtime (Bedrock AgentCore + container image) ───────────────
const agentStack = new AgentStack(app, `${projectName}-agent`, {
  projectName,
  agentAuthMode,
  imagePlatform: agentImagePlatform,
  cognitoDiscoveryUrl: `https://cognito-idp.${env.region ?? 'us-east-1'}.amazonaws.com/${authStack.userPool.userPoolId}/.well-known/openid-configuration`,
  cognitoUserPoolClientId: authStack.userPoolClient.userPoolClientId,
  runtimeEnvironment: pickDefinedEnvironment([
    'BEDROCK_MODEL_ID',
    'EXCHANGE_RATE_MCP_URL',
    'EVM_RPC_URL',
    'X402_APP_URL',
    'EVM_PRIVATE_KEY',
    'HTTP_MCP_ALLOWED_HOSTS',
  ]),
  env,
})
agentStack.addDependency(authStack)

// ── BFF (API Gateway + Lambda) ─────────────────────────────────────────────────
const bffStack = new BffStack(app, `${projectName}-bff`, {
  projectName,
  userPool: authStack.userPool,
  agentRuntimeArn: agentStack.runtimeArn,
  env,
})
bffStack.addDependency(agentStack)

// ── Frontend (S3 + CloudFront) ─────────────────────────────────────────
// Must run AFTER auth and bff stacks so their outputs are available.
const frontendStack = new FrontendStack(app, `${projectName}-frontend`, {
  projectName,
  bffUrl: bffStack.apiUrl,
  agentMode: frontendAgentMode,
  cognitoUserPoolId: authStack.userPool.userPoolId,
  cognitoUserPoolClientId: authStack.userPoolClient.userPoolClientId,
  cognitoIdentityPoolId: authStack.identityPool.ref,
  cognitoRegion: env.region ?? 'us-east-1',
  agentRuntimeArn: agentStack.runtimeArn,
  env,
})
frontendStack.addDependency(bffStack)
