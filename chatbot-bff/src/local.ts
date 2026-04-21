/**
 * Local dev server — simulates API Gateway REST API locally with SSE streaming.
 * Emits the same SSE event protocol as the Lambda handler:
 *   event: session  → { sessionId }
 *   event: chunk    → { content: "..." }
 *   event: done     → { ok: true, sessionId }
 *   event: error    → { error: "..." }
 *
 * Run with: npm run dev
 */
import { createServer, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { invokeAgentStream } from './agent-client.js'

const PORT = Number(process.env.PORT ?? 3001)
const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN ?? ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

function writeSseEvent(res: ServerResponse, event: string, data: unknown) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  res.write(`event: ${event}\n`)
  for (const line of payload.split('\n')) {
    res.write(`data: ${line}\n`)
  }
  res.write('\n')
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? ALLOWED_ORIGIN
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'POST') {
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  // Read request body
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const rawBody = Buffer.concat(chunks).toString()

  let message: string
  let sessionId: string
  try {
    const body = JSON.parse(rawBody)
    message = body.message
    const rawSessionId = body.sessionId
    sessionId = typeof rawSessionId === 'string' && rawSessionId.length >= 33 ? rawSessionId : randomUUID()
    if (!message || typeof message !== 'string') {
      for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing "message" field' }))
      return
    }
  } catch {
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  // Start SSE response
  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  })

  try {
    writeSseEvent(res, 'session', { sessionId })

    const stream = await invokeAgentStream({
      message,
      sessionId,
      agentRuntimeArn: AGENT_RUNTIME_ARN,
    })

    const decoder = new TextDecoder()

    for await (const value of stream) {
      const chunk = decoder.decode(value, { stream: true })
      if (chunk) {
        writeSseEvent(res, 'chunk', { content: chunk })
      }
    }

    const finalChunk = decoder.decode()
    if (finalChunk) {
      writeSseEvent(res, 'chunk', { content: finalChunk })
    }

    writeSseEvent(res, 'done', { ok: true, sessionId })
    res.end()
  } catch (err) {
    console.error('Stream error:', err)
    writeSseEvent(res, 'error', { error: 'Internal server error' })
    writeSseEvent(res, 'done', { ok: false })
    res.end()
  }
})

server.listen(PORT, () => {
  console.log(`🔥 BFF dev server running on http://localhost:${PORT} (streaming SSE)`)
  console.log(`   POST http://localhost:${PORT}/chat`)
})
