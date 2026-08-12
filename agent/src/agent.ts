import * as strands from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { calculatorTool } from './tools/calculator'
import { evmBalanceTool } from './tools/evm-balance'
import { letterCounterTool } from './tools/letter-counter'

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const cryptoToolsMcp = new strands.McpClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: [resolve(__dirname, './mcp-servers/stdio-mcp-server.js')],
  }),
})

const exchangeRateMcp = process.env.EXCHANGE_RATE_MCP_URL
  ? new strands.McpClient({
      transport: new StreamableHTTPClientTransport(
        new URL(process.env.EXCHANGE_RATE_MCP_URL)),
    })
  : null

const oraculoDoBichoMcp = new strands.McpClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: [resolve(__dirname, './mcp-servers/x402-mcp-server.js')],
    env: process.env as Record<string, string>,
  }),
})

/**
 * Shared across requests on purpose: `BedrockModel`'s constructor builds a `BedrockRuntimeClient`,
 * so a per-request model would mean a per-request connection pool and a TLS handshake on the
 * critical path of every call. The client itself is stateless between invocations — unlike the
 * `Agent` built around it below, which is why that part is not shared.
 */
const bedrockModel = new strands.BedrockModel({
  region: process.env.AWS_REGION || 'us-east-1',
  modelId: process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6',
})

/**
 * Builds a fresh agent for one request — never a shared one.
 *
 * A Strands `Agent` retains its own `messages` array across turns. A module-level agent reused
 * across requests in a warm container therefore accumulates conversation state *across callers*,
 * which is wrong in two ways: one user's conversation can leak into the next user's prompt, and two
 * concurrent invocations landing on the same warm container interleave their appends into one array.
 *
 * The agent object itself is cheap to allocate — a prompt, a tool list and an empty array — the
 * expensive part, the Bedrock client, is the module-level `bedrockModel` shared above.
 */
export function createAgent(): strands.Agent {
  return new strands.Agent({
    systemPrompt: `speak like a caveman`,
    model: bedrockModel,
    tools: [calculatorTool, letterCounterTool, evmBalanceTool, cryptoToolsMcp, oraculoDoBichoMcp, ...(exchangeRateMcp ? [exchangeRateMcp] : [])],
  })
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await cryptoToolsMcp.disconnect()
  await oraculoDoBichoMcp.disconnect()
  if (exchangeRateMcp) await exchangeRateMcp.disconnect()
  process.exit(0)
})
