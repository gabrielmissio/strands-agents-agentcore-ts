# Chatbot BFF

Thin Backend-for-Frontend that accepts chat requests and invokes AgentCore with SigV4, plus an admin API for user management.

This package owns the streaming proxy layer used by the chatbot application, and the server-side half of the admin panel. Repository-level architecture and deployment context live in the root [README.md](../README.md).

## Local setup

```bash
npm install
cp .env.example .env
```

Start the local development server:

```bash
npm run dev
```

The local server listens on `http://localhost:3001/chat` and re-streams AgentCore events as SSE.

## Useful scripts

| Script | Purpose |
|---|---|
| `npm run build` | Build the Lambda bundle |
| `npm run dev` | Start the local streaming proxy |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run the test suite (vitest) |

## Environment variables

Use [chatbot-bff/.env.example](.env.example) as the source of truth.

| Variable | Required | Purpose |
|---|---|---|
| `AWS_REGION` | No | AWS region for the AgentCore client |
| `ALLOWED_ORIGIN` | No | Allowed browser origin for CORS. Only read here for local dev (`local.ts`); in the deployed path it's set on both Lambdas by `infra/src/stacks/bff-stack.ts` from the infra-level `ALLOWED_ORIGIN` — see [infra/README.md](../infra/README.md#guardrails) |
| `AGENT_RUNTIME_ARN` | Yes | Target Bedrock AgentCore runtime ARN |

Two more, `COGNITO_USER_POOL_ID` and `ADMIN_GROUP_NAME`, are set on the deployed admin Lambda by `infra/src/stacks/bff-stack.ts` — they are not part of `.env.example` because the local dev server (`local.ts`) only exercises `/chat`, never the admin routes. See [Admin routes](#admin-routes) below.

Three more — `RATE_LIMIT_TABLE_NAME`, `USER_RATE_LIMIT`, `USER_RATE_LIMIT_WINDOW_SECONDS` — are also set on the deployed chat Lambda by `bff-stack.ts`, not part of `.env.example` for the same reason: `local.ts` has no DynamoDB table to point at, so the rate-limit check in `handler.ts` is skipped whenever `RATE_LIMIT_TABLE_NAME` is unset. See [Behavior notes](#behavior-notes) below.

## Behavior notes

- The BFF invokes AgentCore with SigV4 using AWS credentials available to the process or Lambda function
- In the deployed path, the `/chat` endpoint is protected by Cognito at API Gateway
- The local development server is intended to exercise the streaming proxy behavior; it does not perform Cognito token validation itself
- Every AgentCore session id is namespaced to the authenticated caller's Cognito `sub` (see `resolveSessionId`/`sessionNamespace` in [`src/session.ts`](src/session.ts)). A client-supplied id is only reused if it carries *that caller's* namespace; otherwise a fresh one is minted silently. Without this, a session id — effectively a bearer token for AgentCore conversation history — could be replayed by any other authenticated user
- `/chat` also caps how often *one caller* can invoke the agent (see `checkRateLimit` in [`src/rate-limit.ts`](src/rate-limit.ts)): a fixed-window quota, keyed by the caller's `sub`, backed by the DynamoDB table `bff-stack.ts` provisions. `API_RATE_LIMIT` (infra) bounds the whole account; this bounds one caller within it, so a single compromised or careless account can't consume every other caller's share. Exceeding it returns an `error` SSE event with a `retryAfterSeconds` hint rather than a hard failure — the caller can retry once the window rolls over

## Admin routes

A second, separate Lambda (`admin-handler.ts`) serves `GET`/`POST /admin/users`, so that the chat function — the one relaying model output — never holds `cognito-idp:AdminCreate*` permissions. The gateway's Cognito authorizer validates the token; the handler then re-checks the `cognito:groups` claim itself and returns `403` for anyone outside the admin group. Every call — allowed, denied, or errored — emits one structured JSON audit line (see `auditRecord` in `admin.ts`).

`POST /admin/users` accepts an optional `locale` (`en-US` | `pt-BR`, see `SUPPORTED_LOCALES` in `admin.ts`), written to the new user's `custom:inviteLocale` attribute — that's what the Cognito CustomMessage trigger reads to pick the invite email's language (see [infra/README.md](../infra/README.md#emails)). Every error response is `{ code, error }` — `code` is a stable `ErrorCode` (see `errors.ts`) the frontend maps onto a localized string; `error` is the English fallback for a client that never reached one, e.g. a 403 straight from the API Gateway authorizer.

## Lambda build output

```bash
npm run build
```

Two handler entry points are produced: `dist/handler.handler` (chat) and `dist/admin-handler.handler` (admin routes).
