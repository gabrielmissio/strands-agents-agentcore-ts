import { fetchAuthSession } from 'aws-amplify/auth'
import { parseAgentCoreStream, type StreamCallbacks } from './stream-parser'

// ── Mode selection ──────────────────────────────────────────────────────
// Set VITE_AGENT_MODE=direct  → calls AgentCore directly (needs Cognito)
// Set VITE_AGENT_MODE=bff     → calls BFF proxy (default, original behavior)
export type AgentMode = 'direct' | 'bff'
export const AGENT_MODE: AgentMode =
  (import.meta.env.VITE_AGENT_MODE ?? 'bff') as AgentMode

// ── Config ──────────────────────────────────────────────────────────────
const BFF_URL = import.meta.env.VITE_API_URL ?? '/api'
const AGENT_RUNTIME_ARN = import.meta.env.VITE_AGENT_RUNTIME_ARN ?? ''
const AGENT_ENDPOINT_NAME = import.meta.env.VITE_AGENT_ENDPOINT_NAME ?? 'DEFAULT'
const AWS_REGION = import.meta.env.VITE_AWS_REGION ?? 'us-east-1'
const AGENTCORE_URL =
  import.meta.env.VITE_AGENTCORE_URL ??
  `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com`

// ── Types ───────────────────────────────────────────────────────────────
export type AgentResponse = {
  sessionId: string
  content: string
}

// ── BFF mode (original, non-streaming) ──────────────────────────────────
export async function sendMessage(
  message: string,
  sessionId?: string,
): Promise<AgentResponse> {
  const res = await fetch(`${BFF_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  return res.json()
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
      'Content-Type': 'application/json',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
    },
    body: JSON.stringify({ prompt: message }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  await parseAgentCoreStream(response, callbacks)
}
