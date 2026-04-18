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

export const agent = new strands.Agent({
  systemPrompt: `speak like a caveman`,
  model: new strands.BedrockModel({
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6',
  }),
  tools: [calculatorTool, letterCounterTool, evmBalanceTool, cryptoToolsMcp, oraculoDoBichoMcp, ...(exchangeRateMcp ? [exchangeRateMcp] : [])],
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await cryptoToolsMcp.disconnect()
  await oraculoDoBichoMcp.disconnect()
  if (exchangeRateMcp) await exchangeRateMcp.disconnect()
  process.exit(0)
})
