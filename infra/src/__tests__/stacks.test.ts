/**
 * Synthesized-template assertions for the security/correctness properties this template has
 * regressed on before — each one below names the bug it guards against.
 *
 * `AgentStack` is deliberately never constructed here: it creates a `DockerImageAsset`, which
 * triggers a real `docker build` at synth time. That's fine for `cdk synth`/`deploy`, but it would
 * make this suite slow, non-deterministic, and dependent on a Docker daemon being available —
 * exactly what a fast unit-test run should not require. `BffStack` and `FrontendStack` take
 * `agentRuntimeArn` as a plain string prop, so they're fully testable with a stubbed value and
 * never need `AgentStack` to exist.
 *
 * `FrontendStack` does still need `../chatbot-frontend/dist` to exist on disk — `s3deploy.Source
 * .asset()` reads real files at synth time, unlike `lambda.Code.fromAsset()`, which tolerates a
 * missing `dist/` at synth and only fails later, at deploy. `npm run pretest` builds it (and
 * `chatbot-bff`) first, same as `presynth`/`predeploy` already do for `cdk synth`/`deploy` — run
 * `npx vitest run` directly and this file's last suite fails with `CannotFindAsset`.
 */
import { describe, expect, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { AuthStack } from '../stacks/auth-stack.js'
import { BffStack } from '../stacks/bff-stack.js'
import { FrontendStack } from '../stacks/frontend-stack.js'

const env = { account: '123456789012', region: 'us-east-1' }
const FAKE_RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/fake-runtime-id'

function synthAuth(props: Partial<ConstructorParameters<typeof AuthStack>[2]> = {}) {
  const app = new cdk.App()
  const stack = new AuthStack(app, 'TestAuth', { projectName: 'test', env, ...props })
  return { stack, template: Template.fromStack(stack) }
}

describe('AuthStack — authenticated role IAM', () => {
  // Regression: this role used to carry bedrock-agentcore:InvokeAgentRuntime on '*' directly. It is
  // assumable by every signed-in browser via fetchAuthSession(), so any policy attached here is
  // granted to anyone who can sign in and open devtools. The scoped grant now lives in AgentStack,
  // attached to this role by reference — see the note in auth-stack.ts.
  it('attaches no policy to the role every signed-in browser can assume', () => {
    const { template } = synthAuth()

    // Identified by its trust policy — the one role in this stack federated to Cognito Identity —
    // rather than by CDK's generated logical id, which is an implementation detail.
    const roles = template.findResources('AWS::IAM::Role', {
      Properties: {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Federated: 'cognito-identity.amazonaws.com' },
            }),
          ]),
        },
      },
    })
    const roleLogicalIds = Object.keys(roles)
    expect(roleLogicalIds).toHaveLength(1)

    const [authenticatedRoleId] = roleLogicalIds
    expect(roles[authenticatedRoleId].Properties).not.toHaveProperty('Policies')

    // Not just "no inline Policies property" — also no free-standing AWS::IAM::Policy attached via
    // its Roles list, which is the shape role.addToPolicy()/addToRolePolicy() actually produces.
    const policiesReferencingIt = Object.values(
      template.findResources('AWS::IAM::Policy', {
        Properties: {
          Roles: Match.arrayWith([{ Ref: authenticatedRoleId }]),
        },
      }),
    )
    expect(policiesReferencingIt).toHaveLength(0)
  })
})

describe('AuthStack — Cognito schema', () => {
  // Regression: naming this attribute `locale` collides with a reserved standard attribute. CDK
  // renders a custom attribute as a bare { Name, AttributeDataType } schema entry with no `custom:`
  // prefix — Cognito is what adds that — so the entry becomes indistinguishable from declaring the
  // *standard* `locale` attribute. Cognito then never creates `custom:locale`, and any write to it
  // fails at runtime with "Type for attribute {custom:locale} could not be determined."
  it('names the locale attribute inviteLocale, not the reserved locale', () => {
    const { template } = synthAuth()
    const pool = template.findResources('AWS::Cognito::UserPool')
    const schema = Object.values(pool)[0].Properties.Schema as { Name: string }[]
    const names = schema.map((entry) => entry.Name)

    expect(names).toContain('inviteLocale')
    expect(names).not.toContain('locale')
  })
})

describe('AuthStack — publicSignUpEnabled', () => {
  it('blocks the public SignUp API when invite-only', () => {
    const { template } = synthAuth({ publicSignUpEnabled: false })

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    })
  })

  it('allows self sign-up by default', () => {
    const { template } = synthAuth()

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    })
  })
})

describe('AuthStack — retainData', () => {
  // Losing every account is not recoverable; an orphaned pool is. The default has to be Retain.
  it('retains the user pool by default', () => {
    const { template } = synthAuth()
    const pool = Object.values(template.findResources('AWS::Cognito::UserPool'))[0]

    expect(pool.DeletionPolicy).toBe('Retain')
  })

  it('destroys the user pool when explicitly opted out', () => {
    const { template } = synthAuth({ retainData: false })
    const pool = Object.values(template.findResources('AWS::Cognito::UserPool'))[0]

    expect(pool.DeletionPolicy).toBe('Delete')
  })
})

function synthBff(
  overrides: { alertEmail?: string; monthlyBudgetUsd?: number; allowedOrigin?: string } = {},
) {
  const app = new cdk.App()
  const auth = new AuthStack(app, 'TestAuth', { projectName: 'test', env })
  const stack = new BffStack(app, 'TestBff', {
    projectName: 'test',
    userPool: auth.userPool,
    agentRuntimeArn: FAKE_RUNTIME_ARN,
    throttle: { rateLimit: 10, burstLimit: 20 },
    env,
    ...overrides,
  })
  return { stack, template: Template.fromStack(stack) }
}

describe('BffStack — Lambda timeouts vs the API Gateway integration ceiling', () => {
  // API Gateway's REST integration timeout is a hard, unconfigurable 29 seconds for a buffered
  // (non-streaming) response. A longer Lambda timeout on a buffered function isn't extra headroom —
  // it's a function that keeps running and billing after the gateway has already returned 504 to a
  // client that's gone.
  it('caps the buffered admin function at the 29s integration ceiling', () => {
    const { template } = synthBff()

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/admin-handler.handler',
      Timeout: 29,
    })
  })

  // The chat function streams (ResponseTransferMode.STREAM), so it isn't held to the same buffered
  // cap — API Gateway keeps the connection open as long as data keeps flowing.
  it('leaves the streaming chat function above the buffered ceiling', () => {
    const { template } = synthBff()

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/handler.handler',
      Timeout: 60,
    })
  })
})

describe('BffStack — admin IAM scope', () => {
  it('grants the admin function only the specific Cognito actions it needs, on this pool', () => {
    const { template } = synthBff()

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'cognito-idp:ListUsers',
              'cognito-idp:ListUsersInGroup',
              'cognito-idp:AdminCreateUser',
              'cognito-idp:AdminAddUserToGroup',
            ]),
          }),
        ]),
      },
    })
  })
})

describe('BffStack — allowedOrigin', () => {
  // Regression: both Lambdas' ALLOWED_ORIGIN env var and the API Gateway CORS config used to hardcode
  // '*' unconditionally, ignoring this prop entirely — see the note in bff-stack.ts.
  it('defaults both Lambdas and the CORS preflight to the wildcard', () => {
    const { template } = synthBff()

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/handler.handler',
      Environment: { Variables: Match.objectLike({ ALLOWED_ORIGIN: '*' }) },
    })
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/admin-handler.handler',
      Environment: { Variables: Match.objectLike({ ALLOWED_ORIGIN: '*' }) },
    })
  })

  it('propagates a configured origin to both Lambdas and locks the CORS preflight to it', () => {
    const { template } = synthBff({ allowedOrigin: 'https://app.example.com' })

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/handler.handler',
      Environment: {
        Variables: Match.objectLike({ ALLOWED_ORIGIN: 'https://app.example.com' }),
      },
    })
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/admin-handler.handler',
      Environment: {
        Variables: Match.objectLike({ ALLOWED_ORIGIN: 'https://app.example.com' }),
      },
    })

    // The OPTIONS mock integration response is where CDK's CORS helper renders the allowed origin.
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseParameters: Match.objectLike({
              'method.response.header.Access-Control-Allow-Origin': "'https://app.example.com'",
            }),
          }),
        ]),
      }),
    })
  })
})

describe('BffStack — per-caller rate limit', () => {
  it('wires the default limit into the chat function and scopes IAM to UpdateItem only', () => {
    const { template } = synthBff()

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/handler.handler',
      Environment: {
        Variables: Match.objectLike({
          USER_RATE_LIMIT: '20',
          USER_RATE_LIMIT_WINDOW_SECONDS: '60',
        }),
      },
    })

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    })

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'dynamodb:UpdateItem' }),
        ]),
      },
    })
  })

  it('propagates a configured limit to the chat function', () => {
    const app = new cdk.App()
    const auth = new AuthStack(app, 'TestAuth', { projectName: 'test', env })
    const stack = new BffStack(app, 'TestBff', {
      projectName: 'test',
      userPool: auth.userPool,
      agentRuntimeArn: FAKE_RUNTIME_ARN,
      throttle: { rateLimit: 10, burstLimit: 20 },
      userRateLimit: { limit: 5, windowSeconds: 30 },
      env,
    })
    const template = Template.fromStack(stack)

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'dist/handler.handler',
      Environment: {
        Variables: Match.objectLike({
          USER_RATE_LIMIT: '5',
          USER_RATE_LIMIT_WINDOW_SECONDS: '30',
        }),
      },
    })
  })
})

describe('BffStack — budget', () => {
  it('creates no budget when the email or the ceiling is missing', () => {
    expect(Object.keys(synthBff().template.findResources('AWS::Budgets::Budget'))).toHaveLength(0)
    expect(
      Object.keys(
        synthBff({ alertEmail: 'ops@example.com' }).template.findResources(
          'AWS::Budgets::Budget',
        ),
      ),
    ).toHaveLength(0)
  })

  it('creates a budget once both are set', () => {
    const { template } = synthBff({ alertEmail: 'ops@example.com', monthlyBudgetUsd: 200 })

    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetLimit: { Amount: 200, Unit: 'USD' } },
    })
  })
})

function synthFrontend() {
  const app = new cdk.App()
  const auth = new AuthStack(app, 'TestAuth', { projectName: 'test', env })
  const bff = new BffStack(app, 'TestBff', {
    projectName: 'test',
    userPool: auth.userPool,
    agentRuntimeArn: FAKE_RUNTIME_ARN,
    throttle: { rateLimit: 10, burstLimit: 20 },
    env,
  })
  const frontend = new FrontendStack(app, 'TestFrontend', {
    projectName: 'test',
    bffUrl: bff.apiUrl,
    agentMode: 'bff',
    cognitoUserPoolId: auth.userPool.userPoolId,
    cognitoUserPoolClientId: auth.userPoolClient.userPoolClientId,
    cognitoIdentityPoolId: auth.identityPool.ref,
    cognitoRegion: env.region,
    agentRuntimeArn: FAKE_RUNTIME_ARN,
    publicSignUpEnabled: true,
    env,
  })
  return { stack: frontend, template: Template.fromStack(frontend) }
}

describe('FrontendStack — cache-control split', () => {
  // Regression: a single BucketDeployment stamped `immutable, max-age=31536000` on every object it
  // uploaded, index.html included. index.html is what names the content-hashed bundle files, so a
  // browser told to cache it for a year without revalidating goes on requesting bundle names from a
  // build that no longer exists.
  it('caches hashed assets forever but never the entrypoint', () => {
    const { template } = synthFrontend()

    const deployments = Object.values(
      template.findResources('Custom::CDKBucketDeployment'),
    ) as { Properties: { SystemMetadata?: { 'cache-control'?: string } } }[]
    const cacheControls = deployments
      .map((resource) => resource.Properties.SystemMetadata?.['cache-control'])
      .filter((value): value is string => Boolean(value))
      .sort()

    expect(cacheControls).toEqual(
      ['no-cache, must-revalidate', 'public, max-age=31536000, immutable'].sort(),
    )
  })
})

describe('FrontendStack — security response headers', () => {
  // Mitigating control for the SPA keeping Cognito tokens in localStorage (see the note in
  // frontend-stack.ts): a strict script-src is what stops an injected <script> from ever running
  // long enough to read them.
  it('sends a CSP that blocks inline/injected scripts, and attaches it to the distribution', () => {
    const { template } = synthFrontend()

    const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy', {
      Properties: {
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            ContentSecurityPolicy: Match.objectLike({
              ContentSecurityPolicy: Match.stringLikeRegexp("script-src 'self'"),
            }),
          }),
        }),
      },
    })
    const policyIds = Object.keys(policies)
    expect(policyIds).toHaveLength(1)

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: { Ref: policyIds[0] },
        }),
      }),
    })
  })
})
