import { useState } from 'react'
import { confirmSignIn, confirmSignUp, signIn, signUp, type SignInOutput } from 'aws-amplify/auth'
import { isPublicSignUpEnabled } from '@/lib/auth.ts'

type AuthView = 'signIn' | 'signUp' | 'confirmSignUp' | 'newPassword'

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const publicSignUp = isPublicSignUpEnabled()
  const [view, setView] = useState<AuthView>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  /**
   * Routes a sign-in/challenge result to the next view.
   *
   * `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` is the challenge Cognito returns on an
   * admin-created user's first sign-in (their password is a temporary one) — it can happen whether
   * or not public sign-up is enabled, since an admin can always create a user directly.
   */
  const applyResult = (result: SignInOutput) => {
    if (result.isSignedIn) {
      onAuthenticated()
      return
    }

    if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
      setView('newPassword')
      return
    }

    setError(`Unsupported sign in step: ${result.nextStep.signInStep}. Contact an administrator.`)
  }

  const handleSignIn = async () => {
    setError('')
    setLoading(true)
    try {
      applyResult(await signIn({ username: email, password }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async () => {
    setError('')
    setLoading(true)
    try {
      await signUp({
        username: email,
        password,
        options: { userAttributes: { email } },
      })
      setView('confirmSignUp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    setError('')
    setLoading(true)
    try {
      await confirmSignUp({ username: email, confirmationCode: confirmCode })
      // Auto sign-in after confirmation
      const result = await signIn({ username: email, password })
      if (result.isSignedIn) {
        onAuthenticated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed')
    } finally {
      setLoading(false)
    }
  }

  const handleNewPassword = async () => {
    setError('')
    setLoading(true)
    try {
      applyResult(await confirmSignIn({ challengeResponse: newPassword }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the new password')
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (view === 'signIn') handleSignIn()
    else if (view === 'signUp') handleSignUp()
    else if (view === 'confirmSignUp') handleConfirm()
    else handleNewPassword()
  }

  return (
    <div className="flex h-[100dvh] items-center justify-center" style={{ background: 'var(--gradient-cave)' }}>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border-[3px] border-cave bg-card p-6 shadow-[var(--shadow-stone)]"
      >
        <h2 className="mb-4 text-center font-display text-xl uppercase text-cave">
          {view === 'signIn' && '🦴 Sign In'}
          {view === 'signUp' && '🪨 Sign Up'}
          {view === 'confirmSignUp' && '✨ Verify Email'}
          {view === 'newPassword' && '🔑 New Password'}
        </h2>

        {error && (
          <div className="mb-3 rounded-lg bg-fire/20 px-3 py-2 text-xs font-semibold text-cave">
            {error}
          </div>
        )}

        {(view === 'signIn' || view === 'signUp') && (
          <>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="stone-tablet mb-3 w-full px-3 py-2 text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none"
              placeholder="caveman@example.com"
              required
              autoFocus
            />

            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="stone-tablet mb-4 w-full px-3 py-2 text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none"
              placeholder="••••••••"
              required
            />
          </>
        )}

        {view === 'confirmSignUp' && (
          <>
            <p className="mb-3 text-center text-sm font-semibold text-cave/70">
              Check your email for a verification code
            </p>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              Confirmation Code
            </label>
            <input
              type="text"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              className="stone-tablet mb-4 w-full px-3 py-2 text-center text-lg font-bold tracking-widest text-cave placeholder:text-cave/50 focus:outline-none"
              placeholder="123456"
              required
              autoFocus
            />
          </>
        )}

        {view === 'newPassword' && (
          <>
            <p className="mb-3 text-center text-sm font-semibold text-cave/70">
              Choose a password to replace the temporary one
            </p>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="stone-tablet mb-4 w-full px-3 py-2 text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none"
              placeholder="••••••••"
              required
              autoFocus
            />
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl border-[3px] border-cave bg-fire py-2.5 font-display text-sm uppercase text-fire-foreground shadow-[var(--shadow-stone)] transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? 'Loading…'
            : view === 'signIn'
              ? 'Enter Cave'
              : view === 'signUp'
                ? 'Create Account'
                : view === 'confirmSignUp'
                  ? 'Verify'
                  : 'Set Password'}
        </button>

        {view === 'signIn' && publicSignUp && (
          <p className="mt-3 text-center text-xs font-semibold text-cave/60">
            No account?{' '}
            <button type="button" onClick={() => { setView('signUp'); setError('') }} className="text-moss underline">
              Sign Up
            </button>
          </p>
        )}
        {view === 'signIn' && !publicSignUp && (
          <p className="mt-3 text-center text-xs font-semibold text-cave/60">
            Accounts are created by an administrator — ask for an invite to get a temporary password.
          </p>
        )}
        {view === 'signUp' && (
          <p className="mt-3 text-center text-xs font-semibold text-cave/60">
            Already have account?{' '}
            <button type="button" onClick={() => { setView('signIn'); setError('') }} className="text-moss underline">
              Sign In
            </button>
          </p>
        )}
      </form>
    </div>
  )
}
