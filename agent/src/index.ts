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

    // Stream SSE events from the agent
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const stream = agent.stream(prompt)

    for await (const event of stream) {
      const json = JSON.stringify(event)
      res.write(`data: ${json}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('Error processing request:', err)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' })
    }
    res.end()
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AgentCore Runtime server listening on port ${PORT}`)
  console.log(`📍 Endpoints:`)
  console.log(`   POST http://0.0.0.0:${PORT}/invocations`)
  console.log(`   GET  http://0.0.0.0:${PORT}/ping`)
})
