import { useState } from 'react'
import { confirmSignIn, confirmSignUp, signIn, signUp, type SignInOutput } from 'aws-amplify/auth'
import { isPublicSignUpEnabled } from '@/lib/auth.ts'
import { useI18n } from '@/lib/i18n/context.ts'
import { LanguageSwitcher } from './LanguageSwitcher.tsx'

type AuthView = 'signIn' | 'signUp' | 'confirmSignUp' | 'newPassword'

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t, locale } = useI18n()
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

    setError(t('auth.unsupportedStep', { step: result.nextStep.signInStep }))
  }

  const handleSignIn = async () => {
    setError('')
    setLoading(true)
    try {
      applyResult(await signIn({ username: email, password }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signInFailed'))
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
        // The current UI language, so the CustomMessage trigger can send the verification (and any
        // later invite) email in it — see LOCALE_ATTRIBUTE in chatbot-bff/src/admin.ts.
        options: { userAttributes: { email, 'custom:inviteLocale': locale } },
      })
      setView('confirmSignUp')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.signUpFailed'))
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
      setError(err instanceof Error ? err.message : t('auth.confirmationFailed'))
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
      setError(err instanceof Error ? err.message : t('auth.newPasswordFailed'))
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
    <div
      className="relative flex h-[100dvh] items-center justify-center"
      style={{ background: 'var(--gradient-cave)' }}
    >
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>

      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border-[3px] border-cave bg-card p-6 shadow-[var(--shadow-stone)]"
      >
        <h2 className="mb-4 text-center font-display text-xl uppercase text-cave">
          {view === 'signIn' && t('auth.signInTitle')}
          {view === 'signUp' && t('auth.signUpTitle')}
          {view === 'confirmSignUp' && t('auth.verifyEmailTitle')}
          {view === 'newPassword' && t('auth.newPasswordTitle')}
        </h2>

        {error && (
          <div className="mb-3 rounded-lg bg-fire/20 px-3 py-2 text-xs font-semibold text-cave">
            {error}
          </div>
        )}

        {(view === 'signIn' || view === 'signUp') && (
          <>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              {t('auth.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="stone-tablet mb-3 w-full px-3 py-2 text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none"
              placeholder={t('auth.emailPlaceholder')}
              required
              autoFocus
            />

            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              {t('auth.password')}
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
              {t('auth.checkEmailForCode')}
            </p>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              {t('auth.confirmationCode')}
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
              {t('auth.newPasswordPrompt')}
            </p>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70">
              {t('auth.newPassword')}
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
            ? t('common.loading')
            : view === 'signIn'
              ? t('auth.submitSignIn')
              : view === 'signUp'
                ? t('auth.submitSignUp')
                : view === 'confirmSignUp'
                  ? t('auth.submitVerify')
                  : t('auth.submitNewPassword')}
        </button>

        {view === 'signIn' && publicSignUp && (
          <p className="mt-3 text-center text-xs font-semibold text-cave/60">
            {t('auth.noAccountPrompt')}{' '}
            <button type="button" onClick={() => { setView('signUp'); setError('') }} className="text-moss underline">
              {t('auth.signUpLink')}
            </button>
          </p>
        )}
        {view === 'signIn' && !publicSignUp && (
          <p className="mt-3 text-center text-xs font-semibold text-cave/60">
            {t('auth.inviteOnlyHint')}
          </p>
        )}
        {view === 'signUp' && (
          <p className="mt-3 text-center text-xs font-semibold text-cave/60">
            {t('auth.alreadyHaveAccountPrompt')}{' '}
            <button type="button" onClick={() => { setView('signIn'); setError('') }} className="text-moss underline">
              {t('auth.signInLink')}
            </button>
          </p>
        )}
      </form>
    </div>
  )
}
