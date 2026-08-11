import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

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
}

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

    const { projectName, publicSignUpEnabled = true } = props

    // ── User Pool ──────────────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${projectName}-users`,
      selfSignUpEnabled: publicSignUpEnabled,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      // Only used when invite-only: the message Cognito sends an admin-created user along with
      // their temporary password. Ignored when self sign-up is enabled — nobody is invited.
      ...(publicSignUpEnabled
        ? {}
        : {
            userInvitation: {
              emailSubject: `Your ${projectName} access`,
              emailBody: [
                'Hello {username},',
                '',
                'An account was created for you. Sign in with this temporary password and choose a new one:',
                '',
                '{####}',
              ].join('<br/>'),
            },
          }),
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
