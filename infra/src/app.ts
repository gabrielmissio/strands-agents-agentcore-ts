#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import * as ecrassets from 'aws-cdk-lib/aws-ecr-assets'
import { AgentStack, type AgentAuthMode } from './stacks/agent-stack.js'
import { AuthStack } from './stacks/auth-stack.js'
import { BffStack } from './stacks/bff-stack.js'
import { FrontendStack } from './stacks/frontend-stack.js'

const app = new cdk.App()

const projectName = app.node.tryGetContext('projectName') ??  process.env.PROJECT_NAME ?? 'demo-strands-agents-ts'

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

function resolveFrontendAgentMode(agentAuthMode: AgentAuthMode) {
  return agentAuthMode === 'cognito' ? 'direct' as const : 'bff' as const
}

function pickDefinedEnvironment(keys: string[]) {
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]])
      .filter(([, value]) => value && value.trim().length > 0),
  ) as Record<string, string>
}

function resolvePublicSignUpEnabled(input?: string): boolean {
  const normalized = input?.trim().toLowerCase()

  if (!normalized) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true

  throw new Error(`Unsupported PUBLIC_SIGNUP_ENABLED: ${input}`)
}

/**
 * Whether stateful resources (the user pool, the frontend bucket) survive a stack deletion.
 *
 * Defaults to **retain**, because the two outcomes are not symmetric: retaining in a throwaway demo
 * leaves an orphaned user pool and bucket to delete by hand, while destroying in a real environment
 * deletes every user account irreversibly. Set `RETAIN_DATA=false` for a disposable environment.
 */
function resolveRetainData(input?: string): boolean {
  const normalized = input?.trim().toLowerCase()

  if (!normalized) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true

  throw new Error(`Unsupported RETAIN_DATA: ${input}`)
}

/** Address that receives alarm and budget notifications. Alarms still fire without it. */
function resolveAlertEmail(input?: string): string | undefined {
  const trimmed = input?.trim()
  if (!trimmed) return undefined

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error(`ALERT_EMAIL is not a valid address: ${input}`)
  }

  return trimmed
}

/**
 * Monthly spend ceiling, in USD, that triggers a budget notification. Undefined disables the budget.
 *
 * A budget alerts; it cannot stop spend. It exists so a runaway loop is noticed in hours rather than
 * on the invoice.
 */
function resolveMonthlyBudgetUsd(input?: string): number | undefined {
  const trimmed = input?.trim()
  if (!trimmed) return undefined

  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`MONTHLY_BUDGET_USD must be a positive number: ${input}`)
  }

  return value
}

const DEFAULT_API_THROTTLE = { rateLimit: 10, burstLimit: 20 }

/**
 * Caps how fast the API can be hit. Without this the stage inherits the account default (10k rps),
 * which is not a limit so much as an invitation — every request that gets through costs Bedrock
 * tokens.
 *
 * Returns a plain object rather than importing `ApiThrottle` from bff-stack.ts — this is the app
 * entrypoint that imports every stack, so stacks must never import back from it. Structural typing
 * lets this satisfy `BffStackProps.throttle` at the call site below without the import.
 */
function resolveApiThrottle(rate?: string, burst?: string) {
  const parse = (input: string | undefined, fallback: number, name: string) => {
    const trimmed = input?.trim()
    if (!trimmed) return fallback

    const value = Number(trimmed)
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number: ${input}`)
    }

    return value
  }

  return {
    rateLimit: parse(rate, DEFAULT_API_THROTTLE.rateLimit, 'API_RATE_LIMIT'),
    burstLimit: parse(burst, DEFAULT_API_THROTTLE.burstLimit, 'API_BURST_LIMIT'),
  }
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
  cognitoDiscoveryUrl: `https://cognito-idp.${env.region ?? 'us-east-1'}.amazonaws.com/${authStack.userPool.userPoolId}/.well-known/openid-configuration`,
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
  cognitoRegion: env.region ?? 'us-east-1',
  agentRuntimeArn: agentStack.runtimeArn,
  publicSignUpEnabled,
  retainData,
  env,
})
frontendStack.addDependency(bffStack)
