import { fetchAuthSession } from 'aws-amplify/auth'
import { parseAgentCoreStream, type StreamCallbacks } from './stream-parser'
import { readAppConfig } from './app-config'

// ── Mode selection ──────────────────────────────────────────────────────
// Set VITE_AGENT_MODE=direct  → calls AgentCore directly (needs Cognito)
// Set VITE_AGENT_MODE=bff     → calls BFF proxy (default, SSE streaming)
export type AgentMode = 'direct' | 'bff'
export const AGENT_MODE: AgentMode =
  (readAppConfig('VITE_AGENT_MODE') ?? 'bff') as AgentMode

// ── Config ──────────────────────────────────────────────────────────────
const BFF_URL = readAppConfig('VITE_API_URL') ?? '/api'
const AGENT_RUNTIME_ARN = readAppConfig('VITE_AGENT_RUNTIME_ARN') ?? ''
const AGENT_ENDPOINT_NAME = readAppConfig('VITE_AGENT_ENDPOINT_NAME') ?? 'DEFAULT'
const AWS_REGION = readAppConfig('VITE_AWS_REGION') ?? 'us-east-1'
const AGENTCORE_URL =
  readAppConfig('VITE_AGENTCORE_URL') ??
  `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com`

// ── Types ───────────────────────────────────────────────────────────────
export type AgentResponse = {
  sessionId: string
  content: string
}

// ── BFF mode (SSE streaming) ────────────────────────────────────────────

export interface BffStreamCallbacks extends StreamCallbacks {
  onSessionId?: (sessionId: string) => void
}

/**
 * Sends a message through the BFF and streams SSE events back.
 * The BFF wraps AgentCore's raw SSE inside its own event protocol:
 *   event: session → { sessionId }
 *   event: chunk   → { content: "<raw AgentCore SSE data>" }
 *   event: done    → { ok: true, sessionId }
 *   event: error   → { error: "..." }
 */
export async function sendMessageBff(
  message: string,
  sessionId: string,
  callbacks: BffStreamCallbacks,
): Promise<void> {
  const session = await fetchAuthSession({ forceRefresh: false })
  const idToken = session.tokens?.idToken?.toString()
  if (!idToken) {
    throw new Error('No valid ID token. Please sign in.')
  }

  const response = await fetch(`${BFF_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: idToken,
    },
    body: JSON.stringify({ message, sessionId }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`BFF HTTP ${response.status}: ${errorText}`)
  }

  if (!response.body) {
    throw new Error('No response body from BFF')
  }

  // The BFF sends its own SSE envelope. Each "chunk" event's content
  // contains raw AgentCore SSE data. We pipe those chunks into the
  // existing AgentCore stream parser.
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let eventType = ''

  // Push-based ReadableStream: reads the BFF SSE stream and forwards
  // only the inner AgentCore SSE content to the consumer.
  const agentCoreStream = new ReadableStream<Uint8Array>({
    start(controller) {
      ;(async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim()
              } else if (line.startsWith('data: ')) {
                const dataStr = line.substring(6)
                try {
                  const data = JSON.parse(dataStr)
                  if (eventType === 'session' && data.sessionId) {
                    callbacks.onSessionId?.(data.sessionId)
                  } else if (eventType === 'error' && data.error) {
                    callbacks.onError(new Error(data.error))
                  } else if (eventType === 'chunk' && data.content) {
                    controller.enqueue(encoder.encode(data.content))
                  }
                } catch {
                  // Not JSON, skip
                }
              }
            }
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      })()
    },
  })

  // Parse the forwarded AgentCore events using the existing parser
  const fakeResponse = new Response(agentCoreStream)
  await parseAgentCoreStream(fakeResponse, callbacks)
}

// ── Direct mode (streaming via AgentCore) ───────────────────────────────
export async function sendMessageDirect(
  message: string,
  sessionId: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  // Get fresh Cognito access token (reference: awsCalls.ts in shopping-concierge-agent)
  const session = await fetchAuthSession({ forceRefresh: true })
  const accessToken = session.tokens?.accessToken?.toString()

  if (!accessToken) {
    throw new Error('No valid access token. Please sign in.')
  }

  const escapedArn = encodeURIComponent(AGENT_RUNTIME_ARN)
  const url = `${AGENTCORE_URL}/runtimes/${escapedArn}/invocations?qualifier=${AGENT_ENDPOINT_NAME}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
    },
    body: message,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  await parseAgentCoreStream(response, callbacks)
}
