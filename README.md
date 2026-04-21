# poc-strands-agents-ts

Reference implementation for building and deploying Strands Agents in TypeScript on Amazon Bedrock AgentCore Runtime, with two application integration patterns:

- Frontend calls AgentCore directly
- Frontend calls a Backend-for-Frontend (BFF), which then invokes AgentCore

This repository is intentionally structured as a demo and architectural reference. It shows the agent runtime, a React chatbot, a Lambda-based BFF, and AWS CDK infrastructure in one place so teams can evaluate different integration models before hardening a production implementation.

## What this repository demonstrates

- A Strands-based agent packaged as a container and deployed to Amazon Bedrock AgentCore Runtime
- A React chatbot UI that can switch between direct AgentCore invocation and BFF-mediated invocation
- Cognito-based authentication for browser access
- AWS CDK stacks for the agent runtime, authentication, BFF, and static frontend hosting
- Local development entry points for the agent and BFF

## Architecture

### Option 1: Frontend calls AgentCore directly

Placeholder: add architecture diagram showing browser -> Cognito -> AgentCore Runtime.

Current behavior:

- The frontend authenticates users with Cognito
- The browser sends the prompt directly to AgentCore using a bearer token
- Streaming responses are parsed in the frontend

### Option 2: Frontend calls BFF, which calls AgentCore

Placeholder: add architecture diagram showing browser -> Cognito -> API Gateway/Lambda BFF -> AgentCore Runtime.

Current behavior:

- The frontend still authenticates users with Cognito
- The browser sends the prompt to the BFF
- The BFF invokes AgentCore with SigV4 using its Lambda execution role
- The BFF re-streams events back to the frontend over SSE

## Repository layout

- `agent/`: Strands agent runtime, MCP integrations, local invoke helper, container build context
- `chatbot-frontend/`: React + Vite chatbot UI with a feature flag for `direct` or `bff` mode
- `chatbot-bff/`: Lambda-friendly BFF that proxies chat requests to AgentCore
- `infra/`: AWS CDK application for Cognito, AgentCore Runtime, BFF, and frontend hosting

Package documentation:

- [agent/README.md](agent/README.md)
- [chatbot-bff/README.md](chatbot-bff/README.md)
- [chatbot-frontend/README.md](chatbot-frontend/README.md)
- [infra/README.md](infra/README.md)

## Prerequisites

- Node.js 22+
- npm 10+
- Docker with Buildx enabled
- AWS credentials configured for the target account
- Access to Amazon Bedrock AgentCore Runtime and the model configured by `BEDROCK_MODEL_ID`

## Configuration model

Each package is configured independently with its own `.env` file:

- `agent/.env`
- `chatbot-bff/.env`
- `chatbot-frontend/.env`
- `infra/.env`

Example environment files are already included in each package as `.env.example`.

Important switches:

- Frontend mode: `VITE_AGENT_MODE` in [chatbot-frontend/.env.example](chatbot-frontend/.env.example)
- Deployment mode: `FRONTEND_AGENT_MODE` and `AGENT_AUTH_MODE` in [infra/.env.example](infra/.env.example)

## Local development

This repository is not configured as an npm workspace. Install dependencies per package.

### 1. Install dependencies

```bash
npm install
npm --prefix agent install
npm --prefix chatbot-bff install
npm --prefix chatbot-frontend install
npm --prefix infra install
```

### 2. Configure environment files

```bash
cp agent/.env.example agent/.env
cp chatbot-bff/.env.example chatbot-bff/.env
cp chatbot-frontend/.env.example chatbot-frontend/.env
cp infra/.env.example infra/.env
```

Update the copied files with your AWS account details, Cognito values, runtime ARN, and any tool-specific settings you need.

### 3. Work on a specific package

Use the package-level READMEs for package-specific commands and environment details:

- [agent/README.md](agent/README.md)
- [chatbot-bff/README.md](chatbot-bff/README.md)
- [chatbot-frontend/README.md](chatbot-frontend/README.md)
- [infra/README.md](infra/README.md)

Typical local workflow:

- Run the local MCP server and agent runtime from `agent/`
- Run the local streaming proxy from `chatbot-bff/` when testing BFF mode
- Run the React app from `chatbot-frontend/`

## Deployment

The CDK application in `infra/` provisions the authentication, agent runtime, BFF, and static frontend hosting layers.

Use the infrastructure package for synth and deployment commands:

- [infra/README.md](infra/README.md)

Key deployment notes:

- `npm run deploy` builds the frontend and BFF first via the `predeploy` hook
- The agent image defaults to `linux/arm64`
- The deployed frontend receives runtime configuration through `config.js`, so stack outputs do not need to be baked into the Vite bundle

## Production-readiness assessment

This repository remains a demo/reference implementation. A concrete gap analysis is available in [assessment.md](assessment.md).

## Troubleshooting

### Docker ARM64 build fails with `exec format error`

If `cdk deploy` fails while publishing the agent asset and the Docker build stops at `RUN npm install` with `/bin/sh: exec format error`, the host Docker engine is not ready to run the `linux/arm64` image build configured for the agent runtime.

Typical failure summary:

```text
poc-strands-agents-agent: fail: docker build --platform linux/arm64 ...
#8 [4/5] RUN npm install
#8 0.140 exec /bin/sh: exec format error
ERROR: failed to build: process "/bin/sh -c npm install" did not complete successfully
```

Fix it in a separate terminal:

```bash
cd infra
npm run docker:setup-arm64
```

Then retry the deploy command.

## Current status

Use this repository as:

- A reference for AgentCore integration patterns
- A demo for stakeholder conversations and internal enablement
- A starting point for a hardened internal template

Do not treat it as production-ready without addressing the items in [assessment.md](assessment.md).
