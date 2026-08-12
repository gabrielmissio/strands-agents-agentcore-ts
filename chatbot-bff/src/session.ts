import { createHash, randomUUID } from 'node:crypto'

/** AgentCore rejects runtime session ids shorter than this. */
export const MIN_SESSION_ID_LENGTH = 33

/** Length, in hex characters, of the caller namespace prefixed onto every session id. */
export const SESSION_NAMESPACE_LENGTH = 16

/**
 * Derives a short, stable namespace from the authenticated caller's identity (their Cognito `sub`).
 *
 * A session id is effectively a bearer token for AgentCore conversation history — whoever holds one
 * can resume that conversation. Prefixing every id with a hash of the caller's own identity means a
 * client can never construct or replay an id that resolves to someone else's session.
 */
export function sessionNamespace(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, SESSION_NAMESPACE_LENGTH)
}

/**
 * Resolves the session id to use for a request.
 *
 * A client-supplied id is only honored if it starts with the caller's own namespace *and* clears
 * AgentCore's own minimum length; otherwise (missing, malformed, too short, or carrying someone
 * else's namespace) a fresh one is minted silently. There is no way for the client to distinguish
 * "forged" from "just expired," so there is nothing useful to report back — a new session is the
 * only sound outcome either way.
 *
 * `generate` is injectable so a test can assert "a fresh id was minted" without depending on
 * `randomUUID()`'s actual output.
 */
export function resolveSessionId(
  candidate: unknown,
  userId: string,
  generate: () => string = randomUUID,
): string {
  const prefix = `${sessionNamespace(userId)}:`

  if (
    typeof candidate === 'string' &&
    candidate.startsWith(prefix) &&
    candidate.length >= MIN_SESSION_ID_LENGTH
  ) {
    return candidate
  }

  return `${prefix}${generate()}`
}
