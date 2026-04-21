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

## Environment variables

Use [agent/.env.example](.env.example) as the source of truth. The most important variables are:

| Variable | Required | Purpose |
|---|---|---|
| `AWS_REGION` | Yes | AWS region for Bedrock and runtime behavior |
| `BEDROCK_MODEL_ID` | Yes | Model used by the Strands agent |
| `EXCHANGE_RATE_MCP_URL` | No | HTTP MCP server URL for exchange-rate tooling |
| `EVM_RPC_URL` | No | RPC endpoint used by EVM-related tools |
| `X402_APP_URL` | No | Remote x402 service endpoint |
| `EVM_PRIVATE_KEY` | No | Development-only key for x402 flows |
| `AGENT_RUNTIME_ARN` | For `invoke:bedrock` | Target deployed runtime ARN |

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
