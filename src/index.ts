import * as strands from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import express, { type Request, type Response } from 'express'
import { calculatorTool } from './tools/calculator'
import { evmBalanceTool } from './tools/evm-balance'
import { letterCounterTool } from './tools/letter-counter'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 8080

// MCP client connecting to our crypto-tools server via stdio
const cryptoMcp = new strands.McpClient({
  transport: new StdioClientTransport({
    command: 'node',
    args: [resolve(__dirname, 'mcp-server.js')],
  }),
})

const agent = new strands.Agent({
  systemPrompt: `speak like a caveman`,
  model: new strands.BedrockModel({
    region: process.env.AWS_REGION || 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-6',
  }),
  tools: [calculatorTool, letterCounterTool, evmBalanceTool, cryptoMcp],
})

// Health check endpoint (REQUIRED)
app.get('/ping', (_: Request, res: Response) =>
  res.json({
    status: 'Healthy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  })
)

// Agent invocation endpoint (REQUIRED)
// AWS sends binary payload, so we use express.raw middleware
app.post('/invocations', express.raw({ type: '*/*' }), async (req: Request, res: Response) => {
  try {
    // Decode binary payload from AWS SDK
    const prompt = new TextDecoder().decode(req.body)

    // Invoke the agent
    const response = await agent.invoke(prompt)

    // Return response
    return res.json({ response })
  } catch (err) {
    console.error('Error processing request:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AgentCore Runtime server listening on port ${PORT}`)
  console.log(`📍 Endpoints:`)
  console.log(`   POST http://0.0.0.0:${PORT}/invocations`)
  console.log(`   GET  http://0.0.0.0:${PORT}/ping`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await cryptoMcp.disconnect()
  process.exit(0)
})
