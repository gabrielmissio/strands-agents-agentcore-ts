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
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm run test` | Build `chatbot-bff`/`chatbot-frontend`, then run the test suite (vitest) |
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
| `APP_URL` | No | Canonical app URL, linked from the invite/verification emails. Unset, falls back to the frontend stack's CloudFront URL — see [Emails](#emails) |
| `RETAIN_DATA` | No | `true` (default): the user pool and frontend bucket survive `cdk destroy`. `false`: disposable environment — see below |
| `ALERT_EMAIL` | No | Subscribed to the CloudWatch alarms and the budget notification |
| `MONTHLY_BUDGET_USD` | No | Monthly spend ceiling that triggers a budget notification at 80%/100%. Requires `ALERT_EMAIL` |
| `API_RATE_LIMIT` / `API_BURST_LIMIT` | No | Requests/second (and burst above it) allowed on the API stage. Default `10` / `20` |

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

## Emails

Cognito sends two emails this stack controls: the admin-invite (temporary password) message, and the self sign-up confirmation code. Both are configured twice, on purpose:

- **A plain-text template on the user pool itself** (`userInvitation` / `userVerification` in `auth-stack.ts`) — the fallback that goes out if the trigger below declines or fails.
- **A [CustomMessage Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-custom-message.html)** (`lambdas/custom-message/`) that rewrites both as designed HTML (table layout, inline styles, no images — deliverability rules documented in `email-template.mjs`) and, when the app's URL is known, adds a sign-in link. It only touches these two trigger sources; forgot-password and any other Cognito email keep using the pool's own defaults. It never throws — any failure falls back to the plain-text template above, so a broken template can degrade an email, not block sign-up or user creation.

The link needs the app's URL, which the auth stack cannot get as a synth-time reference — the frontend stack (which owns the CloudFront distribution) depends on the auth stack, not the other way around, so a direct reference would cycle. `APP_URL` breaks that: set it explicitly, or leave it unset and the trigger reads whatever URL the frontend stack last published to SSM (`/<project>/app-url`, written by `frontend-stack.ts`). On a fresh `cdk deploy --all` this resolves itself: the parameter exists by the time anyone actually signs up or gets invited. Before that — or if `frontend/` was never deployed — the trigger just omits the link rather than failing.

**Language.** Both emails go out in whichever language the recipient's `custom:inviteLocale` attribute names (`en-US` or `pt-BR`), falling back to English. That attribute is written at sign-up time by the frontend (the visitor's current UI language) and at invite time by the admin routes (the language the inviting admin picked — see [chatbot-bff/README.md](../chatbot-bff/README.md#admin-routes)). It's declared as a *custom* attribute on the pool (`customAttributes.inviteLocale` in `auth-stack.ts`) because Cognito only allows standard attributes to be added when a pool is created — this is a one-way door, since Cognito cannot delete a custom attribute afterward. It is deliberately not named `locale`: that collides with a reserved standard attribute name, and the resulting schema entry is indistinguishable from declaring the standard one, so `custom:locale` silently never gets created and any write to it fails.

**Why these emails land in spam, and it isn't the HTML.** By default the pool sends through Cognito's built-in mailer, whose `from` is hardcoded to `no-reply@verificationemail.com` — shared across every Cognito pool on the internet that hasn't configured its own sender. There's no SPF/DKIM/DMARC alignment with any domain a recipient's mail provider would recognize, the address has a well-earned reputation from being the default sender for pools that *do* send spam, and Cognito itself caps it at 50 emails/day, which is documentation-by-implication that it's not meant for production traffic. The HTML template already follows the practices that are actually within its control — table layout, inline styles, no images, one link whose visible text is its destination, no hidden text, states why the recipient got it, plain register, a full `<!doctype html>` document rather than a bare fragment — none of that moves a spam-filter decision that's fundamentally about sender identity, not content.

**The real fix is SES.** Configuring `email: cognito.UserPoolEmail.withSES({ fromEmail, fromName, sesVerifiedDomain })` on the `UserPool` in `auth-stack.ts` sends through a verified identity on a domain the recipient's filters can actually check DKIM against. This isn't wired into the stack, on purpose: it needs a domain you control, and the setup has a manual, out-of-band step that no amount of CDK can shortcut —

1. Verify an email address or domain identity in SES (domain is better: it covers every address at it, and is what DKIM alignment needs).
2. Add the DNS records SES gives you (DKIM CNAMEs, and a domain verification TXT record if verifying the whole domain).
3. A new SES account starts in the **sandbox**, which only sends to *verified* recipients — unworkable for an invite flow where the whole point is emailing someone who has never touched this AWS account. Request production access from SES (a support-case-driven review, not an API call — the actual long-lead item here).
4. Once production access is granted, add the `email:` property above and redeploy the auth stack.

Until that's done, expect invite and confirmation emails to be flaky about landing in an inbox — this is a known, documented limitation of Cognito's default sender, not a defect in this template.

## Guardrails

Four small settings, all opt-in, whose failure mode is silent until it is expensive or irreversible:

- **`RETAIN_DATA`** (default `true`) — controls the `RemovalPolicy` on the user pool and the frontend bucket. Retaining in a throwaway environment leaves a resource to delete by hand; destroying in a real one deletes every account irreversibly. The asymmetry is why the default is retain, not destroy.
- **`ALERT_EMAIL`** — subscribes an address to an SNS topic that three CloudWatch alarms publish to: chat Lambda errors, admin Lambda errors, and API Gateway 5XX. The alarms exist regardless of whether this is set; without it, nobody is notified when they fire.
- **`MONTHLY_BUDGET_USD`** (needs `ALERT_EMAIL`) — an AWS Budget that notifies at 80% and 100% of the ceiling. A budget alerts; it cannot stop spend. It exists so a runaway loop is noticed in hours rather than on the invoice.
- **`API_RATE_LIMIT`** / **`API_BURST_LIMIT`** (default `10` / `20`) — throttling on the API Gateway stage. Left unset, the stage inherits the account default of 10,000 requests/second, which is not a limit so much as an invitation — every request that gets through costs Bedrock tokens.

API Gateway access logs (identity and outcome — method, path, status, latency, caller `sub` — never the request body) are always on, in `/aws/apigateway/<project>-chat-api`, independent of `ALERT_EMAIL`.

## Notes

- The frontend and BFF are built before synth or deploy through package scripts
- The agent image defaults to `linux/arm64`
- The deployed frontend transport is derived from `AGENT_AUTH_MODE`; there is no separate infra-level frontend mode switch
- If Docker cannot build the ARM64 image locally, use the troubleshooting guidance in the root [README.md](../README.md#troubleshooting)
- All scripts run through `dotenvx run -f .env --overload`. Without `--overload`, `dotenvx` does not override a variable already exported in the shell — a stale `export PROJECT_NAME=…` left in a terminal would silently win over `.env` and deploy against the wrong stacks with no warning.
