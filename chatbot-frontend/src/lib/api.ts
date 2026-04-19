const API_URL = import.meta.env.VITE_API_URL ?? '/api'

export type AgentResponse = {
  sessionId: string
  content: string
}

export async function sendMessage(
  message: string,
  sessionId?: string,
): Promise<AgentResponse> {
  const res = await fetch(`${API_URL}/chat`, {
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
