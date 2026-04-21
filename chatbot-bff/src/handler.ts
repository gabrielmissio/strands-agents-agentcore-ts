import type { APIGatewayProxyEvent } from 'aws-lambda'
import type { Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { invokeAgentStream } from './agent-client.js'

const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN ?? ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

function resolveOrigin(origin?: string) {
  return ALLOWED_ORIGIN === '*' ? '*' : (origin ?? ALLOWED_ORIGIN)
}

function sseHeaders(origin?: string) {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': resolveOrigin(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
  }
}

function jsonHeaders(origin?: string) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolveOrigin(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function writeSseEvent(
  responseStream: Writable,
  event: string,
  data: unknown,
) {
  const payload =
    typeof data === 'string' ? data : JSON.stringify(data)

  responseStream.write(`event: ${event}\n`)
  for (const line of payload.split('\n')) {
    responseStream.write(`data: ${line}\n`)
  }
  responseStream.write('\n')
}

type RequestBody = {
  message?: string
  sessionId?: string
}

export const handler = awslambda.streamifyResponse(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (event: APIGatewayProxyEvent, responseStream: Writable, _context) => {
    const origin = event.headers?.origin ?? event.headers?.Origin
    const method = event.httpMethod

    const httpResponseMetadata = {
      statusCode: 200,
      headers: sseHeaders(origin),
    }

    // This is the AWS-recommended wrapper for HTTP metadata with response streaming.
    responseStream = awslambda.HttpResponseStream.from(
      responseStream,
      httpResponseMetadata,
    )

    if (method === 'OPTIONS') {
      responseStream.end()
      return
    }

    if (method !== 'POST') {
      responseStream.destroy(
        new Error(JSON.stringify({
          statusCode: 405,
          headers: jsonHeaders(origin),
          body: JSON.stringify({ error: 'Method not allowed' }),
        })),
      )
      return
    }

    try {
      const parsedBody: RequestBody = JSON.parse(event.body ?? '{}')
      const message = parsedBody.message

      if (!message || typeof message !== 'string') {
        writeSseEvent(responseStream, 'error', {
          error: 'Missing "message" field',
        })
        writeSseEvent(responseStream, 'done', { ok: false })
        responseStream.end()
        return
      }

      const sessionId =
        typeof parsedBody.sessionId === 'string' && parsedBody.sessionId.length >= 33
          ? parsedBody.sessionId
          : randomUUID()

      writeSseEvent(responseStream, 'session', { sessionId })

      const stream = await invokeAgentStream({
        message,
        sessionId,
        agentRuntimeArn: AGENT_RUNTIME_ARN,
      })

      const decoder = new TextDecoder()

      for await (const value of stream) {
        const chunk = decoder.decode(value, { stream: true })
        if (chunk) {
          writeSseEvent(responseStream, 'chunk', { content: chunk })
        }
      }

      const finalChunk = decoder.decode()
      if (finalChunk) {
        writeSseEvent(responseStream, 'chunk', { content: finalChunk })
      }

      writeSseEvent(responseStream, 'done', { ok: true, sessionId })
      responseStream.end()
    } catch (err) {
      console.error('Handler error:', err)

      writeSseEvent(responseStream, 'error', {
        error: 'Internal server error',
      })
      writeSseEvent(responseStream, 'done', { ok: false })
      responseStream.end()
    }
  },
)