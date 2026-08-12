#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AgentStack } from './stacks/agent-stack.js'
import { AuthStack } from './stacks/auth-stack.js'
import { BffStack } from './stacks/bff-stack.js'
import { FrontendStack } from './stacks/frontend-stack.js'
import {
  DEFAULT_PROJECT_NAME,
  DEFAULT_REGION,
  cognitoDiscoveryUrl,
  pickDefinedEnvironment,
  resolveAgentAuthMode,
  resolveAgentImagePlatform,
  resolveAlertEmail,
  resolveAllowedOrigin,
  resolveApiThrottle,
  resolveFrontendAgentMode,
  resolveMonthlyBudgetUsd,
  resolvePublicSignUpEnabled,
  resolveRetainData,
  resolveUserRateLimit,
} from './config.js'

const app = new cdk.App()

const projectName =
  app.node.tryGetContext('projectName') ?? process.env.PROJECT_NAME ?? DEFAULT_PROJECT_NAME

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? DEFAULT_REGION,
}

const agentAuthMode = resolveAgentAuthMode(
  app.node.tryGetContext('agentAuthMode') ?? process.env.AGENT_AUTH_MODE,
)

const frontendAgentMode = resolveFrontendAgentMode(agentAuthMode)

const agentImagePlatform = resolveAgentImagePlatform(
  app.node.tryGetContext('agentImagePlatform') ?? process.env.AGENT_IMAGE_PLATFORM,
)

const publicSignUpEnabled = resolvePublicSignUpEnabled(
  app.node.tryGetContext('publicSignUpEnabled') ?? process.env.PUBLIC_SIGNUP_ENABLED,
)

// ── Pilot / production guardrails ──────────────────────────────────────
const retainData = resolveRetainData(process.env.RETAIN_DATA)
const alertEmail = resolveAlertEmail(process.env.ALERT_EMAIL)
const monthlyBudgetUsd = resolveMonthlyBudgetUsd(process.env.MONTHLY_BUDGET_USD)
const throttle = resolveApiThrottle(process.env.API_RATE_LIMIT, process.env.API_BURST_LIMIT)
const allowedOrigin = resolveAllowedOrigin(process.env.ALLOWED_ORIGIN)
const userRateLimit = resolveUserRateLimit(
  process.env.USER_RATE_LIMIT,
  process.env.USER_RATE_LIMIT_WINDOW_SECONDS,
)

const appUrl = process.env.APP_URL?.trim() || undefined

// ── Auth (Cognito User Pool + Identity Pool) ───────────────────────────
const authStack = new AuthStack(app, `${projectName}-auth`, {
  projectName,
  publicSignUpEnabled,
  retainData,
  appUrl,
  env,
})

// ── Agent Runtime (Bedrock AgentCore + container image) ───────────────
const agentStack = new AgentStack(app, `${projectName}-agent`, {
  projectName,
  agentAuthMode,
  imagePlatform: agentImagePlatform,
  cognitoDiscoveryUrl: cognitoDiscoveryUrl(env.region ?? DEFAULT_REGION, authStack.userPool.userPoolId),
  cognitoUserPoolClientId: authStack.userPoolClient.userPoolClientId,
  // Scoped grant to invoke this one runtime — see the note in auth-stack.ts.
  invokerRole: authStack.authenticatedRole,
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
  throttle,
  allowedOrigin,
  userRateLimit,
  alertEmail,
  monthlyBudgetUsd,
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
  cognitoRegion: env.region ?? DEFAULT_REGION,
  agentRuntimeArn: agentStack.runtimeArn,
  publicSignUpEnabled,
  retainData,
  env,
})
frontendStack.addDependency(bffStack)
