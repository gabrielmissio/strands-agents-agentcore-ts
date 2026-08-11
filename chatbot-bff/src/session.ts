import { createHash, randomUUID } from 'node:crypto'

/** Length, in hex characters, of the caller namespace prefixed onto every session id. */
const NAMESPACE_LENGTH = 16

/**
 * Derives a short, stable namespace from the authenticated caller's identity (their Cognito `sub`).
 *
 * A session id is effectively a bearer token for AgentCore conversation history — whoever holds one
 * can resume that conversation. Prefixing every id with a hash of the caller's own identity means a
 * client can never construct or replay an id that resolves to someone else's session.
 */
export function sessionNamespace(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, NAMESPACE_LENGTH)
}

/**
 * Resolves the session id to use for a request.
 *
 * A client-supplied id is only honored if it starts with the caller's own namespace; otherwise
 * (missing, malformed, or carrying someone else's namespace) a fresh one is minted silently. There
 * is no way for the client to distinguish "forged" from "just expired," so there is nothing useful
 * to report back — a new session is the only sound outcome either way.
 */
export function resolveSessionId(candidate: unknown, userId: string): string {
  const namespace = sessionNamespace(userId)

  if (typeof candidate === 'string' && candidate.startsWith(`${namespace}:`)) {
    return candidate
  }

  return `${namespace}:${randomUUID()}`
}
