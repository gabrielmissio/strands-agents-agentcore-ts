# Chatbot BFF

Thin Backend-for-Frontend that accepts chat requests and invokes AgentCore with SigV4.

This package owns the streaming proxy layer used by the chatbot application. Repository-level architecture and deployment context live in the root [README.md](../README.md).

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

## Environment variables

Use [chatbot-bff/.env.example](.env.example) as the source of truth.

| Variable | Required | Purpose |
|---|---|---|
| `AWS_REGION` | No | AWS region for the AgentCore client |
| `ALLOWED_ORIGIN` | No | Allowed browser origin for CORS |
| `AGENT_RUNTIME_ARN` | Yes | Target Bedrock AgentCore runtime ARN |

## Behavior notes

- The BFF invokes AgentCore with SigV4 using AWS credentials available to the process or Lambda function
- In the deployed path, the `/chat` endpoint is protected by Cognito at API Gateway
- The local development server is intended to exercise the streaming proxy behavior; it does not perform Cognito token validation itself

## Lambda build output

```bash
npm run build
```

The Lambda handler entry point is `dist/handler.handler`.
