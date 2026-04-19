import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { randomUUID } from 'node:crypto'
import { invokeAgent } from './agent-client.js'

const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN ?? ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

function corsHeaders(origin?: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === '*' ? '*' : (origin ?? ALLOWED_ORIGIN),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const origin = event.headers?.['origin']

  // CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' }
  }

  // Only accept POST
  if (event.requestContext.http.method !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(origin),
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  try {
    const body = JSON.parse(event.body ?? '{}')
    const message = body.message

    if (!message || typeof message !== 'string') {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing "message" field' }),
      }
    }

    const sessionId = body.sessionId ?? randomUUID()

    const response = await invokeAgent({
      message,
      sessionId,
      agentRuntimeArn: AGENT_RUNTIME_ARN,
    })

    // Extract text from the AgentCore response envelope:
    // Raw shape: { response: { type, stopReason, lastMessage: { content: [{ text }] } } }
    let content = response
    try {
      const parsed = JSON.parse(response)
      const agentResult = parsed.response ?? parsed

      // Dig into lastMessage.content[].text
      const parts = agentResult?.lastMessage?.content
      if (Array.isArray(parts)) {
        content = parts
          .map((p: { text?: string }) => p.text ?? '')
          .join('')
      } else if (typeof agentResult === 'string') {
        content = agentResult
      } else {
        content = JSON.stringify(agentResult)
      }
    } catch {
      // plain text response — use as-is
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content }),
    }
  } catch (err) {
    console.error('Handler error:', err)
    return {
      statusCode: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}
