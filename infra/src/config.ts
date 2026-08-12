/**
 * Env/context → config resolvers, and other small pure helpers the stacks need.
 *
 * Split out of `app.ts` so these are unit-testable without synthesizing or deploying anything —
 * `app.ts` itself has side effects the moment it runs (`new cdk.App()`, stack instantiation), which
 * makes it a bad target for a fast, no-AWS-credentials-needed test.
 */
import * as ecrassets from 'aws-cdk-lib/aws-ecr-assets'

export const DEFAULT_PROJECT_NAME = 'demo-strands-agents-ts'
export const DEFAULT_REGION = 'us-east-1'

export type AgentAuthMode = 'cognito' | 'sigv4'

export function resolveAgentAuthMode(input?: string): AgentAuthMode {
  const normalized = input?.trim().toLowerCase()

  if (!normalized || normalized === 'jwt' || normalized === 'cognito') {
    return 'cognito'
  }

  if (normalized === 'sigv4') {
    return 'sigv4'
  }

  throw new Error(`Unsupported AGENT_AUTH_MODE: ${input}`)
}

/** Which transport the frontend uses to reach the agent. */
export function resolveFrontendAgentMode(agentAuthMode: AgentAuthMode) {
  return agentAuthMode === 'cognito' ? ('direct' as const) : ('bff' as const)
}

/**
 * Picks the subset of `env` (default `process.env`) whose keys are in `keys` and whose value is a
 * non-blank string — the shape `CfnRuntime.environmentVariables` and Lambda `environment` both want,
 * since neither tolerates `undefined` values.
 */
export function pickDefinedEnvironment(
  keys: string[],
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return Object.fromEntries(
    keys
      .map((key) => [key, env[key]])
      .filter(([, value]) => value && value.trim().length > 0),
  ) as Record<string, string>
}

/**
 * Whether visitors can create their own account. Defaults to `true` — a demo/template deployment
 * wants the lowest-friction path to trying it. Set `false` for an invite-only deployment.
 */
export function resolvePublicSignUpEnabled(input?: string): boolean {
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
export function resolveRetainData(input?: string): boolean {
  const normalized = input?.trim().toLowerCase()

  if (!normalized) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true

  throw new Error(`Unsupported RETAIN_DATA: ${input}`)
}

/** Address that receives alarm and budget notifications. Alarms still fire without it. */
export function resolveAlertEmail(input?: string): string | undefined {
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
export function resolveMonthlyBudgetUsd(input?: string): number | undefined {
  const trimmed = input?.trim()
  if (!trimmed) return undefined

  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`MONTHLY_BUDGET_USD must be a positive number: ${input}`)
  }

  return value
}

/** Requests/second allowed on the API stage, and the burst above it. */
export interface ApiThrottle {
  rateLimit: number
  burstLimit: number
}

export const DEFAULT_API_THROTTLE: ApiThrottle = { rateLimit: 10, burstLimit: 20 }

/**
 * Caps how fast the API can be hit. Without this the stage inherits the account default (10k rps),
 * which is not a limit so much as an invitation — every request that gets through costs Bedrock
 * tokens.
 */
export function resolveApiThrottle(rate?: string, burst?: string): ApiThrottle {
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

/**
 * Browser origin allowed to call the BFF, echoed on the CORS preflight and every response.
 *
 * Defaults to `*` — the same low-friction default as `PUBLIC_SIGNUP_ENABLED` — because the
 * frontend's own CloudFront URL isn't known at the BFF stack's synth time on a first
 * `cdk deploy --all` (`FrontendStack` depends on `BffStack`, not the other way around). Set this
 * once the app's real origin is known: a custom domain, or the CloudFront URL from a prior deploy.
 */
export function resolveAllowedOrigin(input?: string): string {
  const trimmed = input?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : '*'
}

/** Requests a single caller gets per window, and the window length in seconds. */
export interface UserRateLimit {
  limit: number
  windowSeconds: number
}

export const DEFAULT_USER_RATE_LIMIT: UserRateLimit = { limit: 20, windowSeconds: 60 }

/**
 * Caps how often *one signed-in caller* can invoke the agent — independent of `API_RATE_LIMIT`
 * (`resolveApiThrottle` above), which caps the whole account's request rate and doesn't stop a
 * single caller from consuming all of it. Enforced by the chat Lambda against a DynamoDB table (see
 * `BffStack`), not by API Gateway — there's no per-JWT-claim throttling primitive there to lean on.
 */
export function resolveUserRateLimit(limitInput?: string, windowInput?: string): UserRateLimit {
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
    limit: parse(limitInput, DEFAULT_USER_RATE_LIMIT.limit, 'USER_RATE_LIMIT'),
    windowSeconds: parse(windowInput, DEFAULT_USER_RATE_LIMIT.windowSeconds, 'USER_RATE_LIMIT_WINDOW_SECONDS'),
  }
}

export function resolveAgentImagePlatform(input?: string): ecrassets.Platform | undefined {
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

/** Cognito's OIDC discovery document — the AgentCore runtime uses it to validate JWTs. */
export function cognitoDiscoveryUrl(region: string, userPoolId: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/openid-configuration`
}
