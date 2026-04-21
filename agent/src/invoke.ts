import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js'
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore'
import { randomUUID } from 'node:crypto'

// ── Config ──────────────────────────────────────────────────────────────
const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN
const region = process.env.AWS_REGION || 'us-east-1'
const authMode = (process.env.INVOKE_AUTH_MODE || 'jwt').toLowerCase() // 'jwt' | 'sigv4'

if (!agentRuntimeArn) {
  throw new Error('AGENT_RUNTIME_ARN environment variable is not set.')
}

const inputText = 'Tell me what tools/skills you have and can use to help me.'
const sessionId = randomUUID()

// ── Auth helpers ────────────────────────────────────────────────────────

/** Authenticate via Cognito SRP (password never leaves the client) */
function getCognitoAccessToken(): Promise<string> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  const clientId = process.env.COGNITO_CLIENT_ID
  const username = process.env.COGNITO_USERNAME
  const password = process.env.COGNITO_PASSWORD

  if (!userPoolId || !clientId || !username || !password) {
    console.error('Error: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_USERNAME, and COGNITO_PASSWORD must be set for JWT auth.')
    process.exit(1)
  }

  return new Promise((resolve, reject) => {
    const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId })
    const user = new CognitoUser({ Username: username, Pool: pool })
    const authDetails = new AuthenticationDetails({ Username: username, Password: password })

    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session.getAccessToken().getJwtToken()),
      onFailure: (err) => reject(err),
    })
  })
}

/** Invoke via JWT (Cognito SRP) — REST call with Bearer token */
async function invokeWithJwt(): Promise<Response> {
  const accessToken = await getCognitoAccessToken()
  console.log('✅ Got Cognito access token (SRP)')

  const escapedArn = encodeURIComponent(agentRuntimeArn as string)
  const url = `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${escapedArn}/invocations?qualifier=DEFAULT`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
    },
    body: inputText,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`HTTP ${response.status}: ${errorText}`)
    process.exit(1)
  }

  return response
}

/** Invoke via SigV4 — uses the AWS SDK with IAM credentials */
async function invokeWithSigV4(): Promise<ReadableStream<Uint8Array>> {
  const client = new BedrockAgentCoreClient({ region })
  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    qualifier: 'DEFAULT',
    runtimeSessionId: sessionId,
    payload: new TextEncoder().encode(inputText),
  })

  console.log('✅ Invoking agent via SigV4 (IAM credentials)')
  const result = await client.send(command)

  if (!result.response) {
    console.error('Error: No response body from agent.')
    process.exit(1)
  }

  return result.response as unknown as ReadableStream<Uint8Array>
}

// ── Invoke ──────────────────────────────────────────────────────────────
console.log(`Auth mode: ${authMode}`)

let stream: ReadableStream<Uint8Array>

if (authMode === 'sigv4') {
  stream = await invokeWithSigV4()
} else {
  const response = await invokeWithJwt()
  if (!response.body) {
    throw new Error('No response body from JWT invoke.')
  }
  stream = response.body
}

// ── Read SSE stream ─────────────────────────────────────────────────────
const reader = stream.getReader()
const decoder = new TextDecoder()
let fullText = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  const chunk = decoder.decode(value, { stream: true })
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.substring(6)
    if (data === '[DONE]') continue

    try {
      const event = JSON.parse(data)
      // Print each event type for debugging
      console.log(`[${event.type ?? 'unknown'}]`, JSON.stringify(event).substring(0, 200))

      // Extract text tokens
      if (event.type === 'modelStreamUpdateEvent') {
        const inner = event.event
        if (inner?.type === 'modelContentBlockDeltaEvent' && inner.delta?.type === 'textDelta') {
          process.stdout.write(inner.delta.text)
          fullText += inner.delta.text
        }
      }
    } catch {
      // not JSON, skip
    }
  }
}

console.log('\n\n--- Full response ---')
console.log(fullText)
