# Production Readiness Assessment

## Summary

This repository is a strong demo/reference implementation for Strands Agents + TypeScript + Amazon Bedrock AgentCore Runtime, but it is not yet production ready.

The main gap is not core functionality. The agent, frontend, BFF, and CDK stacks demonstrate the intended architecture well. The gap is production hardening across security, delivery, operability, testing, and documentation consistency.

## Overall verdict

- Architecture clarity: good for a demo/reference repository
- Implementation completeness: enough to demonstrate both integration paths
- Production readiness: partial
- Recommended positioning: demo, starter, or internal reference template

## Highest-priority gaps

### 1. Documentation and behavior are not fully aligned

Impact: high

Why it matters:

- The repository is explicitly intended as a reference implementation
- In a reference repo, inaccurate documentation creates architectural confusion faster than code defects

Evidence:

- The frontend always requires Cognito sign-in before showing the chat experience in [chatbot-frontend/src/App.tsx](chatbot-frontend/src/App.tsx#L5)
- BFF requests still attach an ID token in [chatbot-frontend/src/lib/api.ts](chatbot-frontend/src/lib/api.ts#L38)
- The API Gateway BFF endpoint is protected with a Cognito authorizer in [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts#L73)
- The existing BFF README states that BFF mode is the default and requires no auth, which is no longer true in the current implementation

Recommendation:

- Keep all docs explicit that both current modes depend on Cognito for browser access
- Document the exact difference between direct mode and BFF mode: who authenticates, who invokes AgentCore, and where streaming is terminated and re-emitted

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

Impact: high

Why it matters:

- The repository demonstrates streaming behavior, auth setup, environment-driven mode switching, and AWS integrations
- These are all regression-prone areas that benefit from executable coverage

Evidence:

- No test or spec files are present in the workspace
- Critical components such as the stream parser, BFF handler, config resolution, and CDK synthesis behavior have no visible automated coverage

Recommendation:

- Add unit tests for the frontend stream parser and config resolution
- Add unit/integration tests for the BFF handler and AgentCore stream handling
- Add snapshot or assertion-based CDK tests for major infrastructure invariants

### 4. Security posture is demo-grade, not production-grade

Impact: high

Why it matters:

- The current configuration is convenient for demo use but permissive for internet-facing deployment

Evidence:

- `ALLOWED_ORIGIN` defaults to `*` in the BFF examples and handler behavior, including [chatbot-bff/.env.example](chatbot-bff/.env.example) and [chatbot-bff/src/handler.ts](chatbot-bff/src/handler.ts#L7)
- API Gateway CORS is configured with all origins in [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts#L49)
- The frontend S3 bucket intentionally leaves the explicit public-access-block setting commented out because of an SCP issue in [infra/src/stacks/frontend-stack.ts](infra/src/stacks/frontend-stack.ts#L33)
- A private key is still described as an environment variable in [agent/.env.example](agent/.env.example#L13)

Recommendation:

- Lock CORS to known origins per environment
- Resolve the S3 public access control posture cleanly rather than relying on a commented exception note
- Move secrets to AWS Secrets Manager or SSM Parameter Store and remove secret-style values from `.env` guidance
- Add WAF, throttling, and abuse protections for public endpoints where appropriate

### 5. Configuration validation is weak

Impact: high

Why it matters:

- A multi-package system with different runtime modes should fail fast with clear validation errors
- Missing or inconsistent configuration currently produces a mix of silent degradation and runtime failure

Evidence:

- The frontend auth config logs a warning and continues when Cognito values are missing in [chatbot-frontend/src/lib/auth.ts](chatbot-frontend/src/lib/auth.ts#L13)
- Runtime configuration is distributed across multiple `.env` files with no root orchestration or schema validation
- Several packages depend directly on `process.env` without a shared validation layer

Recommendation:

- Introduce schema validation for environment variables in each package, preferably at startup
- Fail fast with actionable error messages for required config by mode
- Add a documented configuration matrix showing which variables are required in local direct mode, local BFF mode, and deployed environments

## Medium-priority gaps

### 6. Infrastructure defaults are not production-safe

Impact: medium

Evidence:

- Multiple stacks use `RemovalPolicy.DESTROY`, including Cognito and frontend storage, in [infra/src/stacks/auth-stack.ts](infra/src/stacks/auth-stack.ts#L35) and [infra/src/stacks/frontend-stack.ts](infra/src/stacks/frontend-stack.ts#L37)
- Lambda logs are retained for only one week in [infra/src/stacks/bff-stack.ts](infra/src/stacks/bff-stack.ts#L35)
- The AgentCore runtime is configured for public network mode in [infra/src/stacks/agent-stack.ts](infra/src/stacks/agent-stack.ts#L157)

Recommendation:

- Use environment-specific removal policies
- Extend retention and centralize logs/metrics for production environments
- Reassess whether public network mode is required for the runtime in target environments

### 7. Dependency management is not strict enough

Impact: medium

Evidence:

- Critical dependencies are declared as `latest`, including `@aws-sdk/client-bedrock-agentcore` and `@strands-agents/sdk` in [agent/package.json](agent/package.json#L12)
- The BFF also uses `latest` for AgentCore SDK in [chatbot-bff/package.json](chatbot-bff/package.json#L10)

Recommendation:

- Pin exact or bounded versions for runtime-critical dependencies
- Add a dependency update policy and lockfile review cadence

### 8. Operational observability is minimal

Impact: medium

Why it matters:

- Production agents need traceability around latency, failures, tool calls, auth failures, and downstream dependency issues

Evidence:

- Logging is mostly console-based in the BFF and agent runtime
- There is no structured logging convention, correlation ID propagation, or dashboard/alarm definition in the repo

Recommendation:

- Standardize structured logs with request/session correlation identifiers
- Define baseline CloudWatch dashboards and alarms
- Add metrics around invocation count, latency, error rate, and downstream tool failures

### 9. Monorepo ergonomics are incomplete

Impact: medium

Evidence:

- The repo is multi-package but not configured as an npm workspace
- The root package only exposes lint scripts and does not orchestrate install, typecheck, or build for all packages

Recommendation:

- Introduce npm workspaces, pnpm, or Turbo/Nx-style orchestration
- Add root-level scripts for bootstrap, build, lint, typecheck, and test

### 10. Architecture decisions still have unresolved TODOs

Impact: medium

Evidence:

- There is an explicit TODO about the direct-mode IAM policy in [infra/src/stacks/auth-stack.ts](infra/src/stacks/auth-stack.ts#L93)

Recommendation:

- Finalize the direct-mode contract
- Remove permissions and configuration paths that are not part of the supported design

## Lower-priority improvements

### 11. Module-level docs need expansion

Impact: low

Evidence:

- [chatbot-frontend/README.md](chatbot-frontend/README.md) and [infra/README.md](infra/README.md) are placeholders

Recommendation:

- Expand each module README with setup, environment variables, local run steps, and deployment boundaries

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

## Recommended path to “production ready”

### Phase 1: reliability and correctness

- Align all README files with the current auth and integration behavior
- Add CI for install, lint, typecheck, build, and CDK synth
- Add tests for the stream parser, BFF handler, and config mode selection
- Pin runtime-critical dependencies

### Phase 2: security and operations

- Replace permissive CORS with environment-specific allowlists
- Move secret material to managed secret stores
- Add structured logging, metrics, alarms, and trace correlation
- Rework destructive infrastructure defaults for long-lived environments

### Phase 3: platform maturity

- Introduce workspace tooling and root build/test orchestration
- Add environment promotion guidance and rollback procedures
- Add threat modeling and cost-control guidance for public-facing agent traffic

## Final assessment

If the goal is a professional demo/reference repository, this codebase is close once the documentation is corrected and the positioning is explicit.

If the goal is a production-ready template, the repo still needs meaningful work in CI/CD, test coverage, security hardening, observability, and environment validation before it should be used as a baseline for a real customer-facing deployment.