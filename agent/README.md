# Agent

Strands agent runtime packaged for Amazon Bedrock AgentCore Runtime.

This package owns the runtime HTTP surface, tool wiring, and local invoke helper. Repository-level architecture and deployment context live in the root [README.md](../README.md).

## Local setup

```bash
npm install
cp .env.example .env
```

Start the local HTTP MCP server:

```bash
npm run mcp:http
```

Start the agent runtime:

```bash
npm run dev
```

The local runtime listens on `http://localhost:8080` and exposes:

- `GET /ping`
- `POST /invocations`

## Useful scripts

| Script | Purpose |
|---|---|
| `npm run build` | Build the runtime bundle |
| `npm run dev` | Build and start the local runtime |
| `npm run mcp:http` | Start the local HTTP MCP server |
| `npm run invoke:bedrock` | Invoke a deployed AgentCore runtime |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test` | Run the test suite (vitest) |

## Environment variables

Use [agent/.env.example](.env.example) as the source of truth. The most important variables are:

| Variable | Required | Purpose |
|---|---|---|
| `MODEL_PROVIDER` | No | `bedrock` (default) or `ollama` — see [Running against a local Ollama model](#running-against-a-local-ollama-model) |
| `AWS_REGION` | Yes (bedrock) | AWS region for Bedrock and runtime behavior |
| `BEDROCK_MODEL_ID` | Yes (bedrock) | Model used by the Strands agent |
| `EXCHANGE_RATE_MCP_URL` | No | HTTP MCP server URL for exchange-rate tooling |
| `EVM_RPC_URL` | No | RPC endpoint used by EVM-related tools |
| `X402_APP_URL` | No | Remote x402 service endpoint |
| `EVM_PRIVATE_KEY` | No | Development-only key for x402 flows |
| `AGENT_RUNTIME_ARN` | For `invoke:bedrock` | Target deployed runtime ARN |
| `OLLAMA_BASE_URL` | Yes (ollama) | Ollama server's OpenAI-compatible endpoint, e.g. `http://localhost:11434/v1` |
| `OLLAMA_MODEL_ID` | Yes (ollama) | Ollama model tag, e.g. `qwen3:1.7b` |

### Running against a local Ollama model

Set `MODEL_PROVIDER=ollama` to swap the Bedrock model for a local Ollama server, talking to its
OpenAI-compatible endpoint (`/v1/chat/completions`) rather than Ollama's native `/api/chat`. In this
mode the agent only wires up `calculator` and `letterCounter` — no crypto/EVM tools, no MCP servers,
no AWS credentials needed. The model must support OpenAI-style tool/function calling for the agent's
tool-use loop to work; small models may not invoke tools reliably.

```bash
# if Ollama is listening on a non-default port, set OLLAMA_BASE_URL to match
OLLAMA_HOST=127.0.0.1:11435 ollama serve

# .env
MODEL_PROVIDER=ollama
OLLAMA_BASE_URL="http://localhost:11435/v1"
OLLAMA_MODEL_ID=qwen3:1.7b
```

```bash
npm run dev
curl --location 'http://localhost:8080/invocations' \
  --header 'Content-Type: application/octet-stream' \
  --data 'How many times does the letter s appear in satoshi?'
```

## Quick checks

Health check:

```bash
curl http://localhost:8080/ping
```

Invoke the local runtime:

```bash
curl --location 'http://localhost:8080/invocations' \
  --header 'Content-Type: application/octet-stream' \
  --data "How many times does the letter s appear in satoshi nakamoto's secret?"
```

## Docker

Multi-stage build (`node:22-slim`, pinned to match `tsup`'s `node22` target and the Lambda/AgentCore runtimes): a `build` stage runs `npm ci` and `npm run build`, then only `dist/` and production dependencies are copied into the `runtime` stage. `.dockerignore` excludes `node_modules`, `dist`, and tests from the build context — without it, any `npm install` would change the context hash and force a full image rebuild even when no source changed.

Build the image:

```bash
docker build -t poc-strands-agents-ts .
```

Run the container against the MCP server on the host:

```bash
docker run -p 8082:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e EXCHANGE_RATE_MCP_URL=http://host.docker.internal:8081/mcp \
  poc-strands-agents-ts
```

For cross-platform `linux/arm64` build troubleshooting, use the root [README.md](../README.md#troubleshooting).
