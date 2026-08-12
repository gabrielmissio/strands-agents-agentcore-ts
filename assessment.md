# Production Readiness Assessment

## Summary

This repository is a strong demo/reference implementation for Strands Agents + TypeScript + Amazon Bedrock AgentCore Runtime, but it is not yet production ready.

The main gap is not core functionality. The agent, frontend, BFF, and CDK stacks demonstrate the intended architecture well. The gap is production hardening across security, delivery, operability, testing, and documentation consistency.

A hardening pass since this assessment was first written closed several of the gaps below: a real over-broad IAM grant, a year-long CloudFront cache bug, a cross-user agent-conversation leak, an unbound BFF session id, destructive infra defaults, undocumented/placeholder module READMEs, and the absence of any test coverage. It also added an invite-only auth mode, an admin panel for user management, and English/Portuguese i18n. The sections below are marked accordingly — CI/CD, permissive CORS, and secret handling remain open.

## Overall verdict

- Architecture clarity: good for a demo/reference repository
- Implementation completeness: enough to demonstrate both integration paths
- Production readiness: partial
- Recommended positioning: demo, starter, or internal reference template

## Highest-priority gaps

### 1. Documentation and behavior are not fully aligned

Impact: high → largely addressed

Why it matters:

- The repository is explicitly intended as a reference implementation
- In a reference repo, inaccurate documentation creates architectural confusion faster than code defects

Evidence (current):

- The frontend always requires Cognito sign-in before showing the chat experience in [chatbot-frontend/src/App.tsx](chatbot-frontend/src/App.tsx)
- BFF requests still attach an ID token in [chatbot-frontend/src/lib/api.ts](chatbot-frontend/src/lib/api.ts)
- The API Gateway BFF endpoint is protected with a Cognito authorizer in [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts)
- `chatbot-bff/README.md`, `chatbot-frontend/README.md`, and `infra/README.md` now document the auth flow (including the invite-only mode and the admin panel), the two integration modes, and the guardrail env vars explicitly — see gap #11, now resolved

Remaining:

- No repository-wide doc that puts direct mode and BFF mode side by side (who authenticates, who invokes AgentCore, where streaming terminates and is re-emitted) — each package README covers its own side of that boundary, but there is no single comparison table

### 2. No CI/CD or automated quality gates

Impact: high

Why it matters:

- A production-ready repo should prove that builds, type checks, linting, and packaging succeed on every change
- This is especially important in a multi-package repo with frontend, backend, agent runtime, and CDK code

Evidence:

- There is no `.github/workflows` directory in the repository
- No automated pipeline is present for install, typecheck, lint, build, or synth verification

Recommendation:

- Add CI for per-package install, typecheck, build, lint, and CDK synth
- Add branch protection and required checks before merge
- Publish a simple delivery policy in the root README or contribution guide

### 3. No test coverage for critical paths

Impact: high → largely addressed

Evidence (current):

- All four packages run vitest (`npm test` at the root fans out to each) — see [Testing](README.md#testing) in the root README for exactly what's covered
- The frontend stream parser, the BFF's session binding and AgentCore stream normalization, `infra/src/config.ts`'s env resolvers, and CDK-synthesized-template assertions for the security properties this template has regressed on before (scoped IAM, Cognito schema, cache-control split, Lambda timeouts) are all covered
- `infra/src/config.ts` and `chatbot-bff/src/http.ts` exist specifically so this logic is testable without synthesizing/deploying or hitting AWS

Remaining:

- No tests for rendered React components (`AuthScreen`, `ChatExperience`, `AdminPanel`) — needs `@testing-library/react` + `jsdom`, a scoped follow-up
- `AgentStack` (the Docker-image-building stack) has no synthesized-template assertions, since exercising it would trigger a real `docker build` on every test run
- Still no CI to run any of this automatically — see gap #2

Recommendation:

- Add component tests once the jsdom/testing-library dependency is worth taking on
- Wire `npm run verify` (or at least `npm test`) into CI once gap #2 is addressed

### 4. Security posture is demo-grade, not production-grade

Impact: high

Why it matters:

- The current configuration is convenient for demo use but permissive for internet-facing deployment

Evidence:

- `ALLOWED_ORIGIN` defaults to `*` in the BFF examples and handler behavior, including [chatbot-bff/.env.example](chatbot-bff/.env.example) and [chatbot-bff/src/handler.ts](chatbot-bff/src/handler.ts) — this now applies to both the chat function and the new admin function
- API Gateway CORS is configured with all origins in [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts) (now covering `/chat` and `/admin/users` alike)
- The frontend S3 bucket intentionally leaves the explicit public-access-block setting commented out because of an SCP issue in [infra/src/stacks/frontend-stack.ts](infra/src/stacks/frontend-stack.ts)
- A private key is still described as an environment variable in [agent/.env.example](agent/.env.example)

Recommendation:

- Lock CORS to known origins per environment
- Resolve the S3 public access control posture cleanly rather than relying on a commented exception note
- Move secrets to AWS Secrets Manager or SSM Parameter Store and remove secret-style values from `.env` guidance
- Add WAF, throttling, and abuse protections for public endpoints where appropriate

### 5. Configuration validation is weak

Impact: high → partially addressed in `infra/`

Why it matters:

- A multi-package system with different runtime modes should fail fast with clear validation errors
- Missing or inconsistent configuration currently produces a mix of silent degradation and runtime failure

Evidence:

- `infra/src/app.ts` now validates every guardrail and mode env var it reads (`PUBLIC_SIGNUP_ENABLED`, `RETAIN_DATA`, `ALERT_EMAIL`, `MONTHLY_BUDGET_USD`, `API_RATE_LIMIT`/`API_BURST_LIMIT`, `AGENT_AUTH_MODE`, `AGENT_IMAGE_PLATFORM`) and throws a descriptive error on an unrecognized value, rather than silently falling back
- The frontend auth config still logs a warning and continues when Cognito values are missing in [chatbot-frontend/src/lib/auth.ts](chatbot-frontend/src/lib/auth.ts)
- Runtime configuration is still distributed across multiple `.env` files with no root orchestration or schema validation
- `agent/` and `chatbot-bff/` still depend directly on `process.env` without a shared validation layer

Recommendation:

- Extend the infra package's fail-fast validation pattern to `agent/` and `chatbot-bff/`
- Add a documented configuration matrix showing which variables are required in local direct mode, local BFF mode, and deployed environments

## Medium-priority gaps

### 6. Infrastructure defaults are not production-safe

Impact: medium → mostly addressed

Evidence (current):

- The user pool and the frontend bucket now default to `RemovalPolicy.RETAIN`, controlled by `RETAIN_DATA` (default `true`) — see [infra/src/stacks/auth-stack.ts](infra/src/stacks/auth-stack.ts) and [infra/src/stacks/frontend-stack.ts](infra/src/stacks/frontend-stack.ts). `RETAIN_DATA=false` opts back into `DESTROY` for disposable environments; documented in [infra/README.md](infra/README.md#guardrails)
- Lambda log retention is one month, not one week, in [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts)
- API Gateway access logs, CloudWatch alarms (chat/admin Lambda errors, API 5XX), and an optional monthly budget were added — see gap #8

Remaining:

- The AgentCore runtime is still configured for public network mode in [infra/src/stacks/agent-stack.ts](infra/src/stacks/agent-stack.ts)

Recommendation:

- Reassess whether public network mode is required for the runtime in target environments

### 7. Dependency management is not strict enough

Impact: medium

Evidence:

- Critical dependencies are declared as `latest`, including `@aws-sdk/client-bedrock-agentcore` and `@strands-agents/sdk` in [agent/package.json](agent/package.json)
- The BFF also uses `latest` for `@aws-sdk/client-bedrock-agentcore` and the newly-added `@aws-sdk/client-cognito-identity-provider` in [chatbot-bff/package.json](chatbot-bff/package.json)

Recommendation:

- Pin exact or bounded versions for runtime-critical dependencies
- Add a dependency update policy and lockfile review cadence

### 8. Operational observability is minimal

Impact: medium → partially addressed

Evidence (current):

- The BFF's admin routes now emit one structured JSON audit line per privileged action (actor, action, target, outcome) — see `auditRecord` in [chatbot-bff/src/admin.ts](chatbot-bff/src/admin.ts)
- API Gateway access logs are always on (identity and outcome, never the request body) in `/aws/apigateway/<project>-chat-api`
- Three CloudWatch alarms (chat Lambda errors, admin Lambda errors, API 5XX) publish to an SNS topic, optionally subscribed via `ALERT_EMAIL` — see [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts) and [infra/README.md](infra/README.md#guardrails)

Remaining:

- Chat-path and agent-runtime logging is still plain `console.log`/`console.error`, with no structured convention or request/session correlation ID propagation
- No latency, invocation-count, or downstream tool-failure metrics; no dashboard, only error-count alarms

Recommendation:

- Standardize structured logs with request/session correlation identifiers across the chat path and the agent runtime, matching the pattern already used for admin audit logs
- Define a baseline CloudWatch dashboard
- Add metrics around invocation count, latency, and downstream tool failures

### 9. Monorepo ergonomics are incomplete

Impact: medium

Evidence:

- The repo is multi-package but not configured as an npm workspace
- The root package only exposes lint scripts and does not orchestrate install, typecheck, or build for all packages

Recommendation:

- Introduce npm workspaces, pnpm, or Turbo/Nx-style orchestration
- Add root-level scripts for bootstrap, build, lint, typecheck, and test

### 10. Architecture decisions still have unresolved TODOs

Impact: medium → resolved

The TODO this pointed at — whether the Cognito identity pool's authenticated role should keep a blanket `bedrock-agentcore:InvokeAgentRuntime` grant — is gone. That role now carries no policy of its own; the agent stack grants the permission scoped to its one runtime ARN (see [infra/src/stacks/agent-stack.ts](infra/src/stacks/agent-stack.ts) and the note in [infra/src/stacks/auth-stack.ts](infra/src/stacks/auth-stack.ts)). This also closed a real gap: previously any signed-in user could invoke *any* agent runtime in the account, not just this deployment's.

No other unresolved architecture TODOs are currently present in `infra/src`.

## Lower-priority improvements

### 11. Module-level docs need expansion

Impact: low → resolved

[chatbot-frontend/README.md](chatbot-frontend/README.md), [chatbot-bff/README.md](chatbot-bff/README.md), and [infra/README.md](infra/README.md) now cover setup, environment variables, local run steps, deployment boundaries, and the auth/admin/guardrail behavior specific to each package. [agent/README.md](agent/README.md) was already substantive and remains so.

### 12. A production operating model is not documented

Impact: low

Recommendation:

- Add architecture decision records or a concise operations guide covering environments, rollback strategy, secrets management, SLOs, alarms, and incident ownership

## What is already strong

- The repo clearly separates agent runtime, frontend, BFF, and infrastructure concerns
- The two integration patterns are represented in real code rather than slideware
- Runtime config injection for the static frontend is a practical choice for a demo and a useful production pattern when hardened
- The BFF correctly centralizes AgentCore SigV4 invocation when that pattern is desired
- The agent package demonstrates local execution, local MCP tooling, and deployed invocation paths
- Auth supports both public self sign-up and an invite-only mode (`PUBLIC_SIGNUP_ENABLED`), with the pool-level enforcement and the frontend flow kept in sync
- The admin panel's authorization boundary is enforced server-side, not just hidden client-side: the BFF's admin routes re-check `cognito:groups` on every call, so a stale or forged client claim can under-grant access but never over-grant it
- IAM grants follow least privilege where recently touched: the Cognito authenticated role carries no policy of its own, and the admin Lambda's Cognito permissions are scoped to specific actions on one user pool ARN

## Recommended path to “production ready”

### Phase 1: reliability and correctness

- ~~Align all README files with the current auth and integration behavior~~ — done
- Add CI for install, lint, typecheck, build, and CDK synth
- ~~Add tests for the stream parser, BFF handler, and config mode selection~~ — done (`npm test` at the root; see [Testing](README.md#testing)) — CI to run it automatically is still open
- Pin runtime-critical dependencies

### Phase 2: security and operations

- Replace permissive CORS with environment-specific allowlists
- Move secret material to managed secret stores
- Extend structured logging and correlation IDs from the admin routes to the chat path and the agent runtime; add latency/invocation metrics and a dashboard
- ~~Rework destructive infrastructure defaults for long-lived environments~~ — done (`RETAIN_DATA`, longer log retention, alarms, budget)

### Phase 3: platform maturity

- Introduce workspace tooling and root build/test orchestration
- Add environment promotion guidance and rollback procedures
- Add threat modeling and cost-control guidance for public-facing agent traffic

## Final assessment

If the goal is a professional demo/reference repository, this codebase is close: the documentation is now aligned with behavior, module READMEs are substantive, and the auth/infra defaults no longer contradict what the docs claim.

If the goal is a production-ready template, the repo still needs meaningful work in CI/CD, test coverage, CORS/secrets hardening, and chat-path/agent-runtime observability before it should be used as a baseline for a real customer-facing deployment.