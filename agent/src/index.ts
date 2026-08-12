import express, { type NextFunction, type Request, type Response } from 'express'
import { createAgent } from './agent'
import { MAX_BODY_BYTES, MAX_BODY_LENGTH } from './limits'

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
app.post(
  '/invocations',
  express.raw({ type: '*/*', limit: MAX_BODY_BYTES }),
  async (req: Request, res: Response) => {
    try {
      // Decode binary payload from AWS SDK
      const prompt = new TextDecoder().decode(req.body)

      if (prompt.length > MAX_BODY_LENGTH) {
        return res.status(413).json({ error: `Body exceeds ${MAX_BODY_LENGTH} characters` })
      }

      // Stream SSE events from the agent
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()

      // A fresh agent per request — see the comment on createAgent() for why one must not be shared.
      const stream = createAgent().stream(prompt)

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
  },
)

// express.raw() rejects an oversized body itself, before the route handler above ever runs, by
// calling next(err) — without this, Express's default error handler would turn that into an HTML
// error page, not the JSON this endpoint's callers expect.
app.use((err: (Error & { status?: number; type?: string }) | null, _req: Request, res: Response, next: NextFunction) => {
  if (!err) return next()

  if (err.status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Body exceeds ${MAX_BODY_LENGTH} characters` })
  }

  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AgentCore Runtime server listening on port ${PORT}`)
  console.log(`📍 Endpoints:`)
  console.log(`   POST http://0.0.0.0:${PORT}/invocations`)
  console.log(`   GET  http://0.0.0.0:${PORT}/ping`)
})
