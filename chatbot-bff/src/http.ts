/**
 * CORS helpers shared by the chat handler (SSE) and the admin handler (plain JSON).
 */

const CHAT_CORS_METHODS = 'POST, OPTIONS'
/** The admin routes add a listing endpoint, so they advertise GET on top of the chat methods. */
export const ADMIN_CORS_METHODS = 'GET, POST, OPTIONS'
const CORS_HEADERS = 'Content-Type, Authorization'

/**
 * With `allowedOrigin === '*'` the wildcard is echoed back; otherwise the caller's origin is
 * reflected so the response stays valid for credentialed requests, falling back to the configured
 * origin when none was sent.
 */
export function resolveOrigin(allowedOrigin: string, requestOrigin?: string): string {
  return allowedOrigin === '*' ? '*' : (requestOrigin ?? allowedOrigin)
}

export function sseHeaders(allowedOrigin: string, requestOrigin?: string): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': resolveOrigin(allowedOrigin, requestOrigin),
    'Access-Control-Allow-Methods': CHAT_CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'X-Content-Type-Options': 'nosniff',
  }
}

export function jsonHeaders(
  allowedOrigin: string,
  requestOrigin?: string,
  methods: string = CHAT_CORS_METHODS,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolveOrigin(allowedOrigin, requestOrigin),
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': CORS_HEADERS,
  }
}

/**
 * Serializes one SSE event. Multi-line payloads get one `data:` line each, per the SSE spec — a raw
 * newline inside a single `data:` line would end the event early.
 */
export function formatSseEvent(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const lines = payload.split('\n').map((line) => `data: ${line}\n`)

  return `event: ${event}\n${lines.join('')}\n`
}

/**
 * Ceiling on a single prompt, in characters.
 *
 * Rate limiting (see infra's `API_RATE_LIMIT`) caps how *often* the agent is called; this caps how
 * *much* each call costs. Without it, one authenticated client pasting a large document in a loop
 * runs up unbounded Bedrock spend with no other guardrail catching it. Generous enough for a long
 * question, small enough that abuse is bounded — raise it deliberately, not by accident.
 */
export const MAX_MESSAGE_LENGTH = 8000

/** Whether a prompt is present, a non-blank string, and within the cost ceiling. */
export function validateMessage(
  message: unknown,
  maxLength: number = MAX_MESSAGE_LENGTH,
): { ok: true; message: string } | { ok: false; error: string } {
  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'Missing "message" field' }
  }

  if (message.length > maxLength) {
    return { ok: false, error: `"message" exceeds ${maxLength} characters` }
  }

  return { ok: true, message }
}
