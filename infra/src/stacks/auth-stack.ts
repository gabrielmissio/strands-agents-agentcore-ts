import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

export interface AuthStackProps extends cdk.StackProps {
  projectName: string
}

/**
 * Creates a Cognito User Pool + Identity Pool for frontend-to-AgentCore auth.
 *
 * Flow:
 *   1. User signs up / signs in via Cognito Hosted UI or API
 *   2. Frontend gets JWT id token + access token
 *   3. Frontend calls AgentCore `/runtimes/{arn}/invocations` with `Authorization: Bearer <accessToken>`
 *   4. AgentCore validates the JWT via the User Pool's OIDC discovery URL
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolClient: cognito.UserPoolClient
  public readonly identityPool: cognito.CfnIdentityPool

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    const { projectName } = props

    // ── User Pool ──────────────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${projectName}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
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
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
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

    // TODO: Revisit whether this policy should stay once the direct-mode auth
    // contract is finalized. The current frontend direct flow uses JWT bearer
    // tokens, but keeping invoke permission here preserves the option to switch
    // direct mode to Cognito-issued AWS credentials without another infra change.
    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: ['*'],
      }),
    )

    // Attach the role to the Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
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
