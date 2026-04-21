import { Amplify } from 'aws-amplify'
import { readAppConfig } from './app-config'

/**
 * Initializes Amplify with Cognito config from environment variables.
 * Call once at app startup (main.tsx).
 */
export function configureAuth() {
  const userPoolId = readAppConfig('VITE_COGNITO_USER_POOL_ID')
  const userPoolClientId = readAppConfig('VITE_COGNITO_USER_POOL_CLIENT_ID')
  const identityPoolId = readAppConfig('VITE_COGNITO_IDENTITY_POOL_ID')

  if (!userPoolId || !userPoolClientId || !identityPoolId) {
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
