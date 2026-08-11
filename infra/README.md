# Infra

AWS CDK application for provisioning the demo infrastructure.

This package owns the cloud resources for authentication, the Bedrock AgentCore runtime, the BFF, and the static frontend. Repository-level architecture and positioning live in the root [README.md](../README.md).

## Local setup

```bash
npm install
cp .env.example .env
```

## Useful scripts

| Script | Purpose |
|---|---|
| `npm run synth` | Build required dependencies and synthesize the CDK app |
| `npm run deploy` | Build required dependencies and deploy all stacks |
| `npm run deploy:agent` | Deploy only the agent stack |
| `npm run deploy:bff` | Build the BFF and deploy only the BFF stack |
| `npm run destroy` | Destroy all stacks |
| `npm run docker:setup-arm64` | Enable local ARM64 emulation for Docker |

## Stacks

The CDK app provisions these layers:

- Authentication with Cognito
- Agent runtime on Amazon Bedrock AgentCore Runtime
- API Gateway + Lambda BFF
- S3 + CloudFront frontend hosting

## Environment variables

Use [infra/.env.example](.env.example) as the source of truth.

| Variable | Required | Purpose |
|---|---|---|
| `AWS_REGION` | Yes | Target deployment region |
| `PROJECT_NAME` | Yes | Prefix used for stack and resource naming |
| `AGENT_IMAGE_PLATFORM` | No | Docker platform for the agent image build |
| `AGENT_AUTH_MODE` | No | Agent runtime auth mode. Also derives the deployed frontend transport mode: `JWT` -> `direct`, `SIGV4` -> `bff` |
| `PUBLIC_SIGNUP_ENABLED` | No | `true` (default): visitors can self sign-up. `false`: invite-only — see below |

Additional runtime environment variables for the agent can also be passed through this package, including model and tool configuration.

## User provisioning (invite-only)

With `PUBLIC_SIGNUP_ENABLED=false`, self sign-up is disabled at the Cognito pool level — not just hidden in the UI, the public `SignUp` API rejects the client too. Every account is created by an operator:

```bash
COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name "${PROJECT_NAME}-auth" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

aws cognito-idp admin-create-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "new-user@example.com" \
  --user-attributes Name=email,Value="new-user@example.com" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Cognito emails the address a temporary password. On first sign-in the frontend's auth screen answers Cognito's `NEW_PASSWORD_REQUIRED` challenge, and the user picks their own password.

Signed-in admins can also invite users from the app itself — see [chatbot-frontend/README.md](../chatbot-frontend/README.md#admin-panel). This CLI path still matters as the way to create the *first* admin, and as a fallback if the app is unreachable.

## Admin group

Roles are Cognito **groups**, not a separate database. The `-auth` stack declares an `admins` group; everyone else is in no group. Cognito puts membership in the `cognito:groups` claim of both the id token and the access token, so it is readable by both the BFF (which sees the id token) and AgentCore (which sees the access token).

```bash
ADMIN_GROUP=$(aws cloudformation describe-stacks --stack-name "${PROJECT_NAME}-auth" \
  --query "Stacks[0].Outputs[?OutputKey=='AdminGroupName'].OutputValue" --output text)

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$COGNITO_USER_POOL_ID" --username "new-user@example.com" --group-name "$ADMIN_GROUP"

# Who is an admin today
aws cognito-idp list-users-in-group \
  --user-pool-id "$COGNITO_USER_POOL_ID" --group-name "$ADMIN_GROUP" --query 'Users[].Username' --output table
```

Group changes only reach the browser on the next token issuance — the user has to sign out and back in, or wait for the refresh token to mint a new access token. The admin badge in the UI is cosmetic; the BFF's admin routes re-check group membership server-side on every call (see `chatbot-bff/src/admin.ts`), so a stale client-side claim can under-grant but never over-grant access.

## Notes

- The frontend and BFF are built before synth or deploy through package scripts
- The agent image defaults to `linux/arm64`
- The deployed frontend transport is derived from `AGENT_AUTH_MODE`; there is no separate infra-level frontend mode switch
- If Docker cannot build the ARM64 image locally, use the troubleshooting guidance in the root [README.md](../README.md#troubleshooting)
- All scripts run through `dotenvx run -f .env --overload`. Without `--overload`, `dotenvx` does not override a variable already exported in the shell — a stale `export PROJECT_NAME=…` left in a terminal would silently win over `.env` and deploy against the wrong stacks with no warning.
