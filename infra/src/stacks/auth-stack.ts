import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'
import { appUrlParameterName } from './frontend-stack.js'

export interface AuthStackProps extends cdk.StackProps {
  projectName: string
  /**
   * Whether visitors can create their own account. Defaults to `true` — a demo/template deployment
   * wants the lowest-friction path to trying it. Set `false` (via `PUBLIC_SIGNUP_ENABLED=false`) for
   * an invite-only deployment: self sign-up is disabled at the pool level (blocking the public
   * `SignUp` API, not just the UI), and an operator provisions every account with
   * `aws cognito-idp admin-create-user` (see `infra/README.md`). The user then signs in with the
   * temporary password Cognito emails them and is prompted to choose a new one.
   */
  publicSignUpEnabled?: boolean
  /**
   * Whether the user pool survives a stack deletion. Defaults to retaining it, because losing every
   * account is not recoverable and an orphaned pool is. Set `false` (via `RETAIN_DATA=false`) for a
   * disposable environment.
   */
  retainData?: boolean
  /**
   * Canonical URL of the app, put in the invite and sign-up-confirmation emails so the recipient
   * knows where to sign in.
   *
   * Optional because the frontend stack also publishes its CloudFront URL to SSM, which the
   * CustomMessage trigger reads when this is unset — that is what makes a fresh `cdk deploy --all`
   * produce working, linked emails with no manual step. Set this once there is a real domain: it
   * wins over the SSM value.
   */
  appUrl?: string
}

/**
 * Cognito group whose members the frontend and BFF treat as operators. Kept in one place because
 * both sides have to match it exactly: the frontend reads it out of the `cognito:groups` claim to
 * show an Admin badge, and the BFF's admin routes read the same claim to decide whether to allow the
 * call — see `chatbot-bff/src/admin.ts`.
 */
export const ADMIN_GROUP_NAME = 'admins'

/**
 * Creates a Cognito User Pool + Identity Pool for frontend-to-AgentCore auth.
 *
 * Flow (public sign-up):
 *   1. User signs up / signs in via the frontend's auth screen
 *   2. Frontend gets JWT id token + access token
 *   3. Frontend calls AgentCore `/runtimes/{arn}/invocations` with `Authorization: Bearer <accessToken>`
 *   4. AgentCore validates the JWT via the User Pool's OIDC discovery URL
 *
 * Flow (invite-only, `publicSignUpEnabled: false`):
 *   1. An admin creates the user; Cognito emails a temporary password
 *   2. User signs in, Cognito answers with the NEW_PASSWORD_REQUIRED challenge, user picks a password
 *   3-4. Same as above
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolClient: cognito.UserPoolClient
  public readonly identityPool: cognito.CfnIdentityPool
  /**
   * Assumed by every signed-in browser — the identity pool vends its credentials to the client via
   * `fetchAuthSession()`. No policy is attached to it here; grant permissions on it only scoped to a
   * specific resource, from the stack that owns that resource (see `AgentStackProps.invokerRole`).
   */
  public readonly authenticatedRole: iam.Role

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    const { projectName, publicSignUpEnabled = true, retainData = true, appUrl } = props

    // ── User Pool ──────────────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${projectName}-users`,
      selfSignUpEnabled: publicSignUpEnabled,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      // Set at invite/sign-up time and read by the CustomMessage trigger to pick the email's
      // language — see `LOCALE_ATTRIBUTE` in `chatbot-bff/src/admin.ts` and `lambdas/custom-message`.
      //
      // A *custom* attribute rather than the standard `locale`: standard attributes can only be
      // declared when the pool is created, so a pool that already has users can never gain one.
      //
      // The name must NOT be `locale`. CDK renders a custom attribute as a bare
      // `{ Name, AttributeDataType }` schema entry with no `custom:` prefix — Cognito is what adds
      // it — so naming it after a reserved standard attribute produces an entry indistinguishable
      // from declaring the standard one. Cognito then never creates `custom:locale`, and any write
      // to it fails at runtime with "Type for attribute {custom:locale} could not be determined".
      // Surfaces as `custom:inviteLocale` instead.
      //
      // Cognito cannot delete a custom attribute once added to a pool's schema — this is a one-way
      // door, unlike everything else in this stack that's gated behind an env var.
      customAttributes: {
        inviteLocale: new cognito.StringAttribute({ mutable: true }),
      },
      // Plain-text fallbacks for the two emails the CustomMessage trigger below rewrites as
      // designed HTML. They are what goes out if the trigger declines or fails — see the note on
      // `customMessageFn` — so they stay legible rather than duplicating the template in
      // `lambdas/custom-message/email-template.mjs`.
      //
      // Both apply regardless of `publicSignUpEnabled`: an admin can always invite a user via
      // `AdminCreateUser` — the CLI or the admin panel — whether or not public sign-up is also on,
      // and `userVerification` simply goes unused when self sign-up is off (`SignUp` is blocked
      // at the API, so its trigger source never fires).
      userInvitation: {
        emailSubject: `Your ${projectName} access`,
        emailBody: [
          'Hello {username},',
          '',
          'An administrator created an account for you. Use this temporary password to sign in:',
          '',
          '{####}',
          '',
          'You will be asked to choose your own password the first time you sign in.',
        ].join('<br/>'),
      },
      userVerification: {
        emailSubject: `Confirm your ${projectName} account`,
        emailBody: [
          'Confirm your email to finish creating your account.',
          '',
          'Verification code: {####}',
        ].join('<br/>'),
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // The pool holds every account in the environment. `cdk destroy`, or a property change that
      // forces replacement, would take them all with it.
      removalPolicy: retainData ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // ── HTML invite & verification emails ────────────────────────────────
    // Cognito calls this trigger before sending the two emails configured above; it rewrites both
    // as designed HTML and, when the app's URL is known, adds a link so the recipient can get there
    // in one click. It sits on the critical path of `AdminCreateUser` and `SignUp`, which is why the
    // function swallows its own failures and lets the plain-text templates above go out instead.
    const appUrlParameter = appUrlParameterName(projectName)

    const customMessageFn = new lambda.Function(this, 'CustomMessageFunction', {
      functionName: `${projectName}-custom-message`,
      code: lambda.Code.fromAsset('lambdas/custom-message'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      environment: {
        APP_NAME: projectName,
        // Empty unless configured; the trigger then falls back to the SSM parameter below.
        APP_URL: appUrl ?? '',
        APP_URL_PARAMETER: appUrlParameter,
      },
      logGroup: new logs.LogGroup(this, 'CustomMessageFunctionLogs', {
        logGroupName: `/aws/lambda/${projectName}-custom-message`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Granted by ARN rather than by importing the parameter construct: the parameter is created by
    // the frontend stack, and importing it would reintroduce the very dependency SSM exists to break.
    customMessageFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          cdk.Arn.format(
            { service: 'ssm', resource: 'parameter', resourceName: appUrlParameter.slice(1) },
            this,
          ),
        ],
      }),
    )

    this.userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn)

    // ── Groups (roles) ─────────────────────────────────────────────────
    // Cognito emits group membership as the `cognito:groups` claim in *both* the id token and the
    // access token, with no Lambda in the request path — unlike a pre-token-generation trigger,
    // which would bill and add latency on every token issuance just to answer "is this an operator".
    new cognito.CfnUserPoolGroup(this, 'AdminsGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: ADMIN_GROUP_NAME,
      description: 'Operators. Membership is granted via the admin panel or `admin-add-user-to-group`.',
      precedence: 0,
    })

    // ── User Pool Client (for frontend SPA) ────────────────────────────
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `${projectName}-web-client`,
      authFlows: {
        userSrp: true,        // Secure Remote Password (Amplify default)
        userPassword: false,   // Disallow plain-text password auth
      },
      generateSecret: false,   // SPAs cannot hold a secret
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // ── Identity Pool (for AWS credential vending) ─────────────────────
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${projectName}_identity_pool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    })

    // ── IAM role for authenticated Cognito users ───────────────────────
    this.authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      description: 'Role for authenticated Cognito users',
    })

    // No policy is attached here on purpose. This role is assumable by every signed-in user, so
    // anything granted here is granted to anyone who can sign in and open devtools. It used to carry
    // `bedrock-agentcore:InvokeAgentRuntime` on `*`, which let any signed-in user invoke *any* agent
    // runtime in the account. The permission is now attached by the agent stack, scoped to the one
    // runtime ARN it owns — see `AgentStackProps.invokerRole`. It has to be granted from there: a
    // policy declared here that referenced the runtime ARN would make this stack depend on the agent
    // stack, which already depends on this one for the Cognito discovery URL.

    // Attach the role to the Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: this.authenticatedRole.roleArn,
      },
    })

    // ── Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${projectName}-UserPoolId`,
    })

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${projectName}-UserPoolClientId`,
    })

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      exportName: `${projectName}-IdentityPoolId`,
    })

    new cdk.CfnOutput(this, 'AdminGroupName', {
      value: ADMIN_GROUP_NAME,
      exportName: `${projectName}-AdminGroupName`,
    })

    new cdk.CfnOutput(this, 'CognitoRegion', {
      value: this.region,
      exportName: `${projectName}-CognitoRegion`,
    })

    // Discovery URL — needed by AgentCore JWT authorizer
    new cdk.CfnOutput(this, 'OidcDiscoveryUrl', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/openid-configuration`,
      exportName: `${projectName}-OidcDiscoveryUrl`,
    })
  }
}
