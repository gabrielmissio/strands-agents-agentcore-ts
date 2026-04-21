# chatbot-bff

Thin Backend-for-Frontend (BFF) that proxies chat messages to the Caveman Web3 Agent deployed on **Amazon Bedrock AgentCore Runtime**.

## How it works

```
Frontend (React) → POST /chat → BFF (Lambda) → InvokeAgentRuntimeCommand → AgentCore
```

The BFF is SigV4-only. It uses the Lambda execution role to call AgentCore and:
- Invokes the agent via the AWS SDK (`@aws-sdk/client-bedrock-agentcore`)
- Parses the AgentCore response envelope
- Extracts `<thinking>` blocks and tool usage into separate fields
- Returns a clean JSON response to the frontend

## Setup

```bash
npm install
cp .env.example .env   # set AGENT_RUNTIME_ARN
```

## Local development

```bash
npm run dev   # starts local HTTP server on :3001
```

## Build for Lambda

```bash
npm run build   # outputs dist/handler.js
```

Deploy `dist/handler.js` as an ESM Lambda handler (`handler.handler`).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `AGENT_RUNTIME_ARN` | Yes | ARN of the Bedrock AgentCore Runtime |
| `AWS_REGION` | No | Defaults to `us-east-1` |
| `ALLOWED_ORIGIN` | No | CORS origin. Defaults to `*` |

There is no JWT invocation mode in the BFF. Browser JWT auth is handled by the frontend direct mode; the BFF always invokes AgentCore with SigV4.

## Lambda + API Gateway caveats

**No response streaming.** API Gateway (both REST and HTTP API) buffers the entire Lambda response before sending it to the client. This means the frontend receives the full agent answer at once — there is no token-by-token streaming like ChatGPT.

**Alternatives for real-time streaming:**

| Option | Streaming support | Notes |
|---|---|---|
| **Lambda Function URL** (`RESPONSE_STREAM`) | Yes — native SSE | Minimal change: swap API GW for a Function URL with `InvokeMode: RESPONSE_STREAM`. The handler writes chunks via `awslambda.streamifyResponse()`. |
| **ECS Fargate / App Runner** | Yes — full SSE | Long-running Express server, maximum flexibility. |
| **CloudFront + Lambda@Edge** | No | Same buffering limitation. |

**Timeout.** Lambda has a 15-minute max timeout, but API Gateway HTTP API has a **30-second** integration timeout. If the agent takes longer (e.g. complex multi-tool chains), the request will timeout. Solutions: increase timeout via API GW settings, or switch to Lambda Function URL (no gateway timeout).

**Cold starts.** The first invocation after idle may add 1-2s latency. Use provisioned concurrency if this matters for your UX.
