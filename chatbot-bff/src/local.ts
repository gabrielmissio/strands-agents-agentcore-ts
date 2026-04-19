/**
 * Local dev server — simulates API Gateway locally.
 * Run with: npm run dev
 */
import { createServer } from 'node:http'
import { handler } from './handler.js'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'

const PORT = Number(process.env.PORT ?? 3001)

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks).toString()

  const event = {
    requestContext: {
      http: { method: req.method ?? 'GET', path: req.url ?? '/' },
    },
    headers: req.headers as Record<string, string>,
    body,
  } as unknown as APIGatewayProxyEventV2

  const result = await handler(event)
  const statusCode = typeof result === 'object' && 'statusCode' in result ? result.statusCode : 200
  const headers = (typeof result === 'object' && 'headers' in result ? result.headers : {}) as Record<string, string>
  const responseBody = typeof result === 'object' && 'body' in result ? result.body : ''

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, String(value))
  }
  res.writeHead(statusCode ?? 200)
  res.end(responseBody)
})

server.listen(PORT, () => {
  console.log(`🔥 BFF dev server running on http://localhost:${PORT}`)
  console.log(`   POST http://localhost:${PORT}/chat`)
})
