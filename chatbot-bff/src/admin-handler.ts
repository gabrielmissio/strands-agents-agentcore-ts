/**
 * Admin routes — list users and invite new ones.
 *
 * A separate Lambda from the chat handler on purpose: this function holds
 * `cognito-idp:AdminCreate*` permissions, and the chat function — the one relaying untrusted model
 * output — must not. Keeping user management off the chat function's role bounds what a compromise
 * there could reach.
 *
 *   GET  /admin/users  → { users: UserSummary[] }
 *   POST /admin/users  → { user: UserSummary }   body: { email, role?: 'admin' | 'user', locale? }
 */
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  InvalidParameterException,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import {
  ADMIN_GROUP,
  LOCALE_ATTRIBUTE,
  auditRecord,
  isAdminClaims,
  parseInviteRequest,
  resolveAdminRoute,
  toUserSummary,
  type Actor,
  type AuditRecord,
  type UserSummary,
} from './admin.js'
import { ADMIN_CORS_METHODS, jsonHeaders } from './http.js'
import { errorBody, type ErrorCode } from './errors.js'

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

const cognito = new CognitoIdentityProviderClient({})

/** One line per privileged action, structured so it can be queried rather than grepped. */
function audit(record: AuditRecord) {
  console.log(JSON.stringify(record))
}

/** Cognito paginates at 60 users per page; the panel is a demo surface, so one page is enough. */
const LIST_LIMIT = 60

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const origin = event.headers?.origin ?? event.headers?.Origin
  const headers = jsonHeaders(ALLOWED_ORIGIN, origin, ADMIN_CORS_METHODS)
  const respond = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
    statusCode,
    headers,
    body: JSON.stringify(body),
  })
  const fail = (statusCode: number, code: ErrorCode) => respond(statusCode, errorBody(code))

  const route = resolveAdminRoute(event.httpMethod, event.path)

  if (route === 'preflight') return { statusCode: 204, headers, body: '' }
  if (!route) return fail(404, 'notFound')

  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined
  const actor: Actor = {
    sub: typeof claims?.sub === 'string' ? claims.sub : undefined,
    email: typeof claims?.email === 'string' ? claims.email : undefined,
  }

  // The gateway's Cognito authorizer has already validated the token's signature, expiry and
  // issuer; these claims are the verified ones. The group check is the actual privilege boundary —
  // the admin badge in the UI is cosmetic and is not trusted here.
  if (!isAdminClaims(claims)) {
    // A denied attempt is the most interesting line in the log, not the least.
    audit(auditRecord(route, actor, 'denied'))
    return fail(403, 'forbidden')
  }

  try {
    if (route === 'listUsers') {
      const users = await listUsers()
      audit(auditRecord('listUsers', actor, 'success', { detail: { count: users.length } }))
      return respond(200, { users })
    }

    return await inviteUser(event.body, actor, respond, fail)
  } catch (err) {
    console.error('Admin handler error:', err)
    audit(auditRecord(route, actor, 'error'))
    return fail(500, 'internal')
  }
}

async function listUsers(): Promise<UserSummary[]> {
  const [all, admins] = await Promise.all([
    cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Limit: LIST_LIMIT })),
    cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID, GroupName: ADMIN_GROUP })),
  ])

  const adminUsernames = new Set(
    (admins.Users ?? []).map((user) => user.Username).filter((name): name is string => !!name),
  )

  return (all.Users ?? [])
    .map((user) => toUserSummary(user, adminUsernames))
    .sort((a, b) => (a.email ?? a.username).localeCompare(b.email ?? b.username))
}

async function inviteUser(
  body: string | null,
  actor: Actor,
  respond: (statusCode: number, body: unknown) => APIGatewayProxyResult,
  fail: (statusCode: number, code: ErrorCode) => APIGatewayProxyResult,
): Promise<APIGatewayProxyResult> {
  const parsed = parseInviteRequest(body ?? '{}')
  if (!parsed.ok) return fail(400, parsed.code)

  const { email, role, locale } = parsed.value

  // `email_verified` is set here so the invited user can later use the forgot-password flow.
  //
  // The locale attribute is what the CustomMessage trigger reads to pick the invite email's
  // language. It has to travel as a stored attribute rather than as `ClientMetadata`:
  // `AdminCreateUser` does invoke the trigger, but that trigger source is documented to receive no
  // client metadata. Storing it also means a resent invite keeps the original choice.
  const baseAttributes = [
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: 'true' },
  ]

  const create = (attributes: { Name: string; Value: string }[]) =>
    cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: attributes,
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    )

  try {
    let created

    try {
      created = await create([...baseAttributes, { Name: LOCALE_ATTRIBUTE, Value: locale }])
    } catch (err) {
      // The email's language is a nicety; being able to invite someone is not. A pool that predates
      // the attribute — or one where it was declared under a reserved name and therefore never
      // created — would otherwise fail the whole invite here. The user is created anyway and
      // Cognito sends the pool's default template, matching how the trigger already degrades to
      // English when it cannot resolve a locale.
      if (!(err instanceof InvalidParameterException) || !err.message.includes(LOCALE_ATTRIBUTE)) {
        throw err
      }

      audit(
        auditRecord('inviteUser', actor, 'success', {
          target: email,
          detail: { localeAttributeMissing: LOCALE_ATTRIBUTE, emailLanguage: 'pool default' },
        }),
      )
      created = await create(baseAttributes)
    }

    if (role === 'admin') {
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: created.User?.Username ?? email,
          GroupName: ADMIN_GROUP,
        }),
      )
    }

    const summary = toUserSummary(
      created.User ?? { Username: email },
      role === 'admin' ? new Set([created.User?.Username ?? email]) : new Set(),
    )

    // Granting admin is the single most consequential action this API offers, so the role is part
    // of the record rather than something to infer from a later group listing.
    audit(auditRecord('inviteUser', actor, 'success', { target: email, detail: { role, locale } }))

    return respond(201, { user: summary })
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      audit(auditRecord('inviteUser', actor, 'denied', { target: email }))
      return fail(409, 'emailAlreadyExists')
    }
    throw err
  }
}
