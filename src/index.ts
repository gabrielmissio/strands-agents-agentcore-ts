import express, { type Request, type Response } from 'express'
import { agent } from './agent'

const app = express()
const PORT = process.env.PORT || 8080

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
