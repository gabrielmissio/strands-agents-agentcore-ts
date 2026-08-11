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
