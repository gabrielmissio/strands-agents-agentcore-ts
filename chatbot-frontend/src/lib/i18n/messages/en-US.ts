import type { Catalog } from '../core'

/**
 * The base catalog and the source of truth for the key type.
 *
 * `satisfies` rather than a type annotation on purpose: it validates the shape while keeping the
 * literal keys, which is what makes `t('auth.signInTitle')` a compile error when the key is wrong.
 *
 * Every other catalog is a `Partial` of this one, so this is the only file that may not have gaps.
 */
export const enUS = {
  // ── Common ──────────────────────────────────────────────────────────
  'common.loading': 'Loading…',
  'common.signOut': 'Sign out',
  'common.signOutLabel': 'Sign Out',
  'common.language': 'Language',

  // ── Auth ────────────────────────────────────────────────────────────
  'auth.signInTitle': '🦴 Sign In',
  'auth.signUpTitle': '🪨 Sign Up',
  'auth.verifyEmailTitle': '✨ Verify Email',
  'auth.newPasswordTitle': '🔑 New Password',
  'auth.email': 'Email',
  'auth.emailPlaceholder': 'caveman@example.com',
  'auth.password': 'Password',
  'auth.newPassword': 'New Password',
  'auth.newPasswordPrompt': 'Choose a password to replace the temporary one',
  'auth.checkEmailForCode': 'Check your email for a verification code',
  'auth.confirmationCode': 'Confirmation Code',
  'auth.submitSignIn': 'Enter Cave',
  'auth.submitSignUp': 'Create Account',
  'auth.submitVerify': 'Verify',
  'auth.submitNewPassword': 'Set Password',
  'auth.inviteOnlyHint':
    'Accounts are created by an administrator — ask for an invite to get a temporary password.',
  'auth.noAccountPrompt': 'No account?',
  'auth.signUpLink': 'Sign Up',
  'auth.alreadyHaveAccountPrompt': 'Already have account?',
  'auth.signInLink': 'Sign In',
  'auth.signInFailed': 'Sign in failed',
  'auth.signUpFailed': 'Sign up failed',
  'auth.confirmationFailed': 'Confirmation failed',
  'auth.newPasswordFailed': 'Could not set the new password',
  'auth.unsupportedStep': 'Unsupported sign in step: {step}. Contact an administrator.',

  // ── Chat ────────────────────────────────────────────────────────────
  'chat.title': 'Web3 Caveman',
  'chat.subtitle': 'Powered by Bedrock AgentCore',
  'chat.welcome': 'OOK OOK! Me CAVEMAN. Me help with shiny blockchain rocks. Ask me anything!',
  'chat.inputPlaceholder': 'Ask caveman about wallet, balance, address…',
  'chat.send': 'Send',
  'chat.footer': '🦴 Strands Agents + Amazon Bedrock AgentCore 🦴',
  'chat.thinkingBubble': 'Me think…',
  'chat.mascotAlt': 'Caveman',
  'chat.mascotHeaderAlt': 'Caveman mascot',
  'chat.mascotThinkingAlt': 'Caveman thinking',
  'chat.adminLink': 'Admin',
  'chat.adminPanelTitle': 'Admin panel',
  'chat.statusConnecting': 'Connecting...',
  'chat.statusStreaming': 'Streaming...',
  'chat.statusThinking': 'Thinking...',
  'chat.statusUsingTool': 'Using {tool}',
  'chat.errorGeneric': 'UGH! Rock fall on head. Me no can answer right now. Try again!',
  'chat.errorWithMessage': 'UGH! {message}',
  'chat.suggestionValidateLabel': 'Validate address',
  'chat.suggestionValidatePrompt': 'Validate 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  'chat.suggestionBalanceLabel': 'Get balance',
  'chat.suggestionBalancePrompt': "What's the balance of vitalik.eth?",
  'chat.suggestionRateLabel': 'Exchange rate',
  'chat.suggestionRatePrompt': 'ETH to USD rate?',
  'chat.suggestionLettersLabel': 'Count letters',
  'chat.suggestionLettersPrompt':
    'How many times does the letter "s" appear in "satoshi nakamoto\'s secret"?',

  // ── Admin panel ─────────────────────────────────────────────────────
  'admin.title': 'Admin',
  'admin.subtitle': 'Manage who can sign in',
  'admin.backToChat': 'Back to chat',
  'admin.inviteHeading': 'Invite a user',
  'admin.inviteEmail': 'Email',
  'admin.inviteEmailPlaceholder': 'new-user@example.com',
  'admin.inviteRole': 'Role',
  'admin.inviteLanguage': 'Invite language',
  'admin.inviteSubmit': 'Send Invite',
  'admin.inviteSending': 'Sending…',
  'admin.inviteHint':
    'Cognito emails a temporary password in the chosen language. They set their own on first sign-in.',
  'admin.inviteSent': 'Invite sent to {email}',
  'admin.inviteFailed': 'Could not send the invite',
  'admin.roleAdmin': 'Admin',
  'admin.roleUser': 'User',
  'admin.membersHeading': {
    one: '{count} member',
    other: '{count} members',
  },
  'admin.refresh': 'Refresh',
  'admin.loadingUsers': 'Loading users…',
  'admin.noUsers': 'No users yet.',
  'admin.loadFailed': 'Could not load users',
  'admin.columnUser': 'User',
  'admin.columnRole': 'Role',
  'admin.columnStatus': 'Status',
  'admin.statusActive': 'Active',
  'admin.statusPending': 'Invite pending',
  'admin.statusDisabled': 'Disabled',
  'admin.statusUnknown': 'Unknown',

  // ── Server error codes ──────────────────────────────────────────────
  // Keyed by the `code` the BFF returns (see chatbot-bff/src/errors.ts), so the server never ships
  // prose anyone must translate.
  'error.emailAlreadyExists': 'That email already has an account',
  'error.invalidEmail': 'Enter a valid email address',
  'error.invalidRole': 'Pick a valid role',
  'error.invalidLocale': 'Pick a supported language',
  'error.invalidBody': 'The request was malformed',
  'error.forbidden': 'You need admin access for this',
  'error.notFound': 'That endpoint does not exist',
  'error.internal': 'Something broke on our side. Try again.',
  'error.noSession': 'Your session expired. Please sign in again.',
} satisfies Catalog

export type MessageKey = keyof typeof enUS
