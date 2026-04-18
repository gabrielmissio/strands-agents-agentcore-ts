import * as strands from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { calculatorTool } from './tools/calculator'
import { evmBalanceTool } from './tools/evm-balance'
import { letterCounterTool } from './tools/letter-counter'

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// MCP client connecting to our crypto-tools server via stdio
const cryptoToolsMcp = new strands.McpClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: [resolve(__dirname, './mcp-servers/stdio-mcp-server.js')],
  }),
})

const exchangeRateMcp = new strands.McpClient({
  transport: new StreamableHTTPClientTransport(
    new URL(process.env.EXCHANGE_RATE_MCP_URL || 'http://localhost:8081/mcp')),
})

export const agent = new strands.Agent({
  systemPrompt: `speak like a caveman`,
  model: new strands.BedrockModel({
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6',
  }),
  tools: [calculatorTool, letterCounterTool, evmBalanceTool, cryptoToolsMcp, exchangeRateMcp],
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await cryptoToolsMcp.disconnect()
  process.exit(0)
})
