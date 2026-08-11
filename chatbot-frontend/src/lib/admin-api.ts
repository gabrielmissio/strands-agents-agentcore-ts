/**
 * Client for the BFF admin routes.
 *
 * Sends the **id token**, matching what `/chat` does and what the gateway's Cognito authorizer
 * expects — it is also the token carrying `cognito:groups`, which the admin function re-checks.
 * Nothing here is an authorization decision: a non-admin who calls these functions directly gets a
 * 403 from the server, which is the point.
 */
import { fetchAuthSession } from 'aws-amplify/auth'
import { readAppConfig } from './app-config'
import type { UserRole } from './session-roles'

const BFF_URL = readAppConfig('VITE_API_URL') ?? '/api'

export interface AdminUser {
  username: string
  email?: string
  status?: string
  enabled: boolean
  createdAt?: string
  role: UserRole
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await fetchAuthSession({ forceRefresh: false })
  const idToken = session.tokens?.idToken?.toString()

  if (!idToken) {
    throw new ApiError('No valid ID token. Please sign in.')
  }

  const response = await fetch(`${BFF_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: idToken, ...init?.headers },
  })

  // Our handler always answers JSON with `error`, but a gateway-level failure (e.g. a 403 straight
  // from the authorizer) may not be JSON at all — fall back to the status so callers never render
  // "undefined".
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T

  if (!response.ok) {
    throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status)
  }

  return payload
}

export async function listUsers(): Promise<AdminUser[]> {
  const { users } = await requestJson<{ users?: AdminUser[] }>('/admin/users')
  return users ?? []
}

export async function inviteUser(email: string, role: UserRole): Promise<AdminUser | undefined> {
  const { user } = await requestJson<{ user?: AdminUser }>('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
  return user
}
