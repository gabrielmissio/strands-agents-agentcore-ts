import { z } from 'zod'
import * as strands from '@strands-agents/sdk'
import express, { type Request, type Response } from 'express'

const PORT = process.env.PORT || 8080

// Define a custom tool
const calculatorTool = strands.tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  callback: (input): number => {
    switch (input.operation) {
      case 'add':
        return input.a + input.b
      case 'subtract':
        return input.a - input.b
      case 'multiply':
        return input.a * input.b
      case 'divide':
        return input.a / input.b
    }
  },
})

const letterCounterTool = strands.tool({
  name: 'letterCounter',
  description: 'Counts the number of letters in a given string',
  inputSchema: z.object({
    text: z.string(),
  }),
  callback: (input): number => {
    return input.text.replace(/[^a-zA-Z]/g, '').length
  },
})

// Configure the agent with Amazon Bedrock
const agent = new strands.Agent({
  systemPrompt: `speak like a pirate`,
  model: new strands.BedrockModel({
    region: 'us-east-1', // Change to your preferred region
    modelId: 'global.anthropic.claude-sonnet-4-20250514-v1:0', // Change to your preferred Bedrock model
  }),
  tools: [calculatorTool, letterCounterTool],
})

const app = express()

// Health check endpoint (REQUIRED)
app.get('/ping', (_, res) =>
  res.json({
    status: 'Healthy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  })
)

// Agent invocation endpoint (REQUIRED)
// AWS sends binary payload, so we use express.raw middleware
app.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
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