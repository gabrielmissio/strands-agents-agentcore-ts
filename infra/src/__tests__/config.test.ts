import { describe, expect, it } from 'vitest'
import * as ecrassets from 'aws-cdk-lib/aws-ecr-assets'
import {
  DEFAULT_API_THROTTLE,
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
  DEFAULT_USER_RATE_LIMIT,
} from '../config.js'

describe('resolveAgentAuthMode', () => {
  it('defaults to cognito when unset or blank', () => {
    expect(resolveAgentAuthMode(undefined)).toBe('cognito')
    expect(resolveAgentAuthMode('   ')).toBe('cognito')
  })

  it('accepts both spellings of the JWT mode, case-insensitively', () => {
    expect(resolveAgentAuthMode('JWT')).toBe('cognito')
    expect(resolveAgentAuthMode('Cognito')).toBe('cognito')
  })

  it('accepts sigv4', () => {
    expect(resolveAgentAuthMode('SIGV4')).toBe('sigv4')
  })

  it('fails loudly on an unknown mode instead of silently defaulting', () => {
    expect(() => resolveAgentAuthMode('iam')).toThrow(/Unsupported AGENT_AUTH_MODE/)
  })
})

describe('resolveFrontendAgentMode', () => {
  it('lets the browser call AgentCore directly only when the runtime validates JWTs', () => {
    expect(resolveFrontendAgentMode('cognito')).toBe('direct')
    expect(resolveFrontendAgentMode('sigv4')).toBe('bff')
  })
})

describe('resolveAgentImagePlatform', () => {
  it('defaults to arm64 — the AgentCore runtime target', () => {
    expect(resolveAgentImagePlatform(undefined)).toBe(ecrassets.Platform.LINUX_ARM64)
    expect(resolveAgentImagePlatform('linux/arm64')).toBe(ecrassets.Platform.LINUX_ARM64)
    expect(resolveAgentImagePlatform('arm64')).toBe(ecrassets.Platform.LINUX_ARM64)
  })

  it('supports amd64 for local troubleshooting', () => {
    expect(resolveAgentImagePlatform('AMD64')).toBe(ecrassets.Platform.LINUX_AMD64)
  })

  it('returns undefined for the host platform so CDK builds natively', () => {
    expect(resolveAgentImagePlatform('current')).toBeUndefined()
    expect(resolveAgentImagePlatform('local')).toBeUndefined()
    expect(resolveAgentImagePlatform('host')).toBeUndefined()
  })

  it('passes anything else through as a custom platform', () => {
    expect(resolveAgentImagePlatform('linux/riscv64')?.platform).toBe('linux/riscv64')
  })
})

describe('pickDefinedEnvironment', () => {
  it('keeps only the requested keys that carry a real value', () => {
    const picked = pickDefinedEnvironment(['A', 'B', 'C', 'D'], {
      A: 'value',
      B: '',
      C: '   ',
      D: undefined,
      E: 'ignored',
    })

    expect(picked).toEqual({ A: 'value' })
  })

  it('defaults to reading process.env when no env object is given', () => {
    process.env.CONFIG_TEST_KEY = 'from-process-env'
    try {
      expect(pickDefinedEnvironment(['CONFIG_TEST_KEY'])).toEqual({
        CONFIG_TEST_KEY: 'from-process-env',
      })
    } finally {
      delete process.env.CONFIG_TEST_KEY
    }
  })
})

describe('cognitoDiscoveryUrl', () => {
  it('builds the OIDC discovery document URL for the pool', () => {
    expect(cognitoDiscoveryUrl('us-east-1', 'us-east-1_abc123')).toBe(
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc123/.well-known/openid-configuration',
    )
  })
})

describe('resolvePublicSignUpEnabled', () => {
  it('defaults to enabled — lowest friction for trying the template', () => {
    expect(resolvePublicSignUpEnabled(undefined)).toBe(true)
    expect(resolvePublicSignUpEnabled('')).toBe(true)
  })

  it('accepts the usual spellings of both answers', () => {
    expect(resolvePublicSignUpEnabled('false')).toBe(false)
    expect(resolvePublicSignUpEnabled('NO')).toBe(false)
    expect(resolvePublicSignUpEnabled('true')).toBe(true)
  })

  it('refuses a value it cannot interpret rather than guessing', () => {
    expect(() => resolvePublicSignUpEnabled('maybe')).toThrow(/PUBLIC_SIGNUP_ENABLED/)
  })
})

describe('resolveRetainData', () => {
  // Asymmetric outcomes: retaining in a demo leaves an orphan, destroying in a pilot loses users.
  it('defaults to retaining', () => {
    expect(resolveRetainData(undefined)).toBe(true)
    expect(resolveRetainData('')).toBe(true)
  })

  it('accepts the usual spellings of both answers', () => {
    expect(resolveRetainData('false')).toBe(false)
    expect(resolveRetainData('NO')).toBe(false)
    expect(resolveRetainData(' 0 ')).toBe(false)
    expect(resolveRetainData('true')).toBe(true)
    expect(resolveRetainData('yes')).toBe(true)
  })

  it('refuses a value it cannot interpret rather than guessing', () => {
    expect(() => resolveRetainData('maybe')).toThrow(/RETAIN_DATA/)
  })
})

describe('resolveAlertEmail', () => {
  it('passes a valid address through and treats blank as unset', () => {
    expect(resolveAlertEmail(' ops@example.com ')).toBe('ops@example.com')
    expect(resolveAlertEmail(undefined)).toBeUndefined()
    expect(resolveAlertEmail('  ')).toBeUndefined()
  })

  it('fails at synth rather than silently never alerting', () => {
    expect(() => resolveAlertEmail('not-an-email')).toThrow(/ALERT_EMAIL/)
  })
})

describe('resolveMonthlyBudgetUsd', () => {
  it('parses a positive amount and treats blank as disabled', () => {
    expect(resolveMonthlyBudgetUsd('200')).toBe(200)
    expect(resolveMonthlyBudgetUsd(undefined)).toBeUndefined()
  })

  it('rejects zero, negatives and nonsense', () => {
    expect(() => resolveMonthlyBudgetUsd('0')).toThrow(/MONTHLY_BUDGET_USD/)
    expect(() => resolveMonthlyBudgetUsd('-5')).toThrow(/MONTHLY_BUDGET_USD/)
    expect(() => resolveMonthlyBudgetUsd('lots')).toThrow(/MONTHLY_BUDGET_USD/)
  })
})

describe('resolveAllowedOrigin', () => {
  it('defaults to the wildcard — the frontend origin does not exist yet on a first deploy', () => {
    expect(resolveAllowedOrigin(undefined)).toBe('*')
    expect(resolveAllowedOrigin('')).toBe('*')
    expect(resolveAllowedOrigin('   ')).toBe('*')
  })

  it('passes a configured origin through, trimmed', () => {
    expect(resolveAllowedOrigin(' https://app.example.com ')).toBe('https://app.example.com')
  })
})

describe('resolveUserRateLimit', () => {
  it('falls back to the defaults', () => {
    expect(resolveUserRateLimit(undefined, undefined)).toEqual(DEFAULT_USER_RATE_LIMIT)
  })

  it('overrides either side independently', () => {
    expect(resolveUserRateLimit('5', undefined)).toEqual({
      limit: 5,
      windowSeconds: DEFAULT_USER_RATE_LIMIT.windowSeconds,
    })
  })

  it('rejects a non-positive limit — an unbounded caller is the thing being prevented', () => {
    expect(() => resolveUserRateLimit('0', undefined)).toThrow(/USER_RATE_LIMIT/)
    expect(() => resolveUserRateLimit(undefined, 'none')).toThrow(/USER_RATE_LIMIT_WINDOW_SECONDS/)
  })
})

describe('resolveApiThrottle', () => {
  it('falls back to the defaults', () => {
    expect(resolveApiThrottle(undefined, undefined)).toEqual(DEFAULT_API_THROTTLE)
  })

  it('overrides either side independently', () => {
    expect(resolveApiThrottle('50', undefined)).toEqual({
      rateLimit: 50,
      burstLimit: DEFAULT_API_THROTTLE.burstLimit,
    })
  })

  it('rejects a non-positive limit — an unlimited stage is the thing being prevented', () => {
    expect(() => resolveApiThrottle('0', undefined)).toThrow(/API_RATE_LIMIT/)
    expect(() => resolveApiThrottle(undefined, 'none')).toThrow(/API_BURST_LIMIT/)
  })
})
