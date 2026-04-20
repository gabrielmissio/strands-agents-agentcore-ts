import { Amplify } from 'aws-amplify'

/**
 * Initializes Amplify with Cognito config from environment variables.
 * Call once at app startup (main.tsx).
 */
export function configureAuth() {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
  const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID
//   const region = import.meta.env.VITE_COGNITO_REGION ?? import.meta.env.VITE_AWS_REGION ?? 'us-east-1'
  const identityPoolId = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID

  if (!userPoolId || !userPoolClientId) {
    console.warn('[auth] Cognito env vars missing — direct mode unavailable')
    return
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        identityPoolId,
        loginWith: { email: true },
      },
    },
  })
}
