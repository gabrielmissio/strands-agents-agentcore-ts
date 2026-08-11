import type { APIGatewayProxyEvent } from 'aws-lambda'
import type { Writable } from 'node:stream'
import { invokeAgentStream } from './agent-client.js'
import { resolveSessionId } from './session.js'

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
      // The Cognito authorizer on the API Gateway route (see infra/src/stacks/bff-stack.ts) puts the
      // caller's verified claims here. Its absence means the route is misconfigured or being hit
      // some other way — either way, there is no caller identity to bind a session to, so this fails
      // closed rather than falling back to an unbound one.
      const userId = (event.requestContext.authorizer as { claims?: { sub?: string } } | undefined)
        ?.claims?.sub

      if (!userId) {
        writeSseEvent(responseStream, 'error', { error: 'Unauthenticated' })
        writeSseEvent(responseStream, 'done', { ok: false })
        responseStream.end()
        return
      }

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

      // Only a session id minted for this caller is honored — see session.ts. A session id is a
      // bearer token for AgentCore conversation history; without this, one signed-in user could read
      // or continue another user's conversation just by supplying their session id.
      const sessionId = resolveSessionId(parsedBody.sessionId, userId)

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