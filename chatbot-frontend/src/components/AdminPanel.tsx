import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, LogOut, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import { ApiError, inviteUser, listUsers, type AdminUser } from '@/lib/admin-api.ts'
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  translateErrorCode,
  useI18n,
  type Locale,
  type Translate,
} from '@/lib/i18n/context.ts'
import { LanguageSwitcher } from './LanguageSwitcher.tsx'
import type { UserRole } from '@/lib/session-roles.ts'

export interface AdminPanelProps {
  userEmail?: string
  onSignOut: () => void | Promise<void>
  /** Returns to the chat view. There is no router here — the app just swaps components. */
  onBack: () => void
}

/** Cognito's status for someone who has been invited but has not completed the first sign-in. */
const PENDING_STATUS = 'FORCE_CHANGE_PASSWORD'

type UsersResult = { users?: AdminUser[]; errorCode?: string; errorMessage?: string }

/** Kept outside the component so the mount effect can call it without touching state first. */
async function fetchUsers(): Promise<UsersResult> {
  try {
    return { users: await listUsers() }
  } catch (err) {
    return {
      errorCode: err instanceof ApiError ? err.code : undefined,
      errorMessage: err instanceof Error ? err.message : undefined,
    }
  }
}

function statusLabel(t: Translate, user: AdminUser): string {
  if (!user.enabled) return t('admin.statusDisabled')
  if (user.status === PENDING_STATUS) return t('admin.statusPending')
  if (user.status === 'CONFIRMED') return t('admin.statusActive')
  // An unmapped Cognito status is shown raw rather than hidden — it is operational information.
  return user.status ?? t('admin.statusUnknown')
}

export function AdminPanel({ userEmail, onSignOut, onBack }: AdminPanelProps) {
  const { locale, t } = useI18n()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  // Defaults to the admin's own language: most invites go to people in the same place.
  const [inviteLocale, setInviteLocale] = useState<Locale>(locale)
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [invited, setInvited] = useState('')

  const applyResult = useCallback(
    (result: UsersResult) => {
      if (result.users) setUsers(result.users)
      setLoadError(
        result.users ? '' : translateErrorCode(t, result.errorCode, result.errorMessage),
      )
      setLoading(false)
    },
    [t],
  )

  // State is set from the promise callback rather than from the effect body: a synchronous setState
  // there cascades renders. `loading` already starts true, so the first fetch needs no flag flip.
  useEffect(() => {
    let active = true
    void fetchUsers().then((result) => {
      if (active) applyResult(result)
    })
    return () => {
      active = false
    }
  }, [applyResult])

  /** The explicit path — refresh button, post-invite — where the spinner should reappear. */
  const refresh = useCallback(async () => {
    setLoading(true)
    applyResult(await fetchUsers())
  }, [applyResult])

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inviting) return

    setInviting(true)
    setInviteError('')
    setInvited('')
    try {
      await inviteUser(email, role, inviteLocale)
      setInvited(t('admin.inviteSent', { email }))
      setEmail('')
      setRole('user')
      // Re-read rather than push the response into the table: the list is Cognito's answer, not
      // ours, and refetching keeps the two from drifting.
      await refresh()
    } catch (err) {
      setInviteError(
        err instanceof ApiError
          ? translateErrorCode(t, err.code, err.message)
          : t('admin.inviteFailed'),
      )
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="relative z-10 border-b-[3px] border-cave/80 bg-secondary/60 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('admin.backToChat')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border-[3px] border-cave bg-card text-cave shadow-[var(--shadow-stone)] transition hover:bg-secondary active:translate-y-0.5 active:shadow-none"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="leading-tight">
            <h1 className="font-display text-lg uppercase text-cave sm:text-xl">{t('admin.title')}</h1>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('admin.subtitle')}
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            {userEmail && (
              <span
                className="hidden max-w-[14rem] truncate text-xs font-semibold text-muted-foreground sm:block"
                title={userEmail}
              >
                {userEmail}
              </span>
            )}
            <button
              type="button"
              onClick={() => void onSignOut()}
              aria-label={t('common.signOut')}
              className="flex items-center gap-1.5 rounded-2xl border-[3px] border-cave bg-card px-3 py-2 font-display text-xs uppercase text-cave shadow-[var(--shadow-stone)] transition hover:bg-secondary active:translate-y-0.5 active:shadow-none"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.signOutLabel')}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="cave-texture relative flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          {/* ── Invite ── */}
          <section className="rounded-2xl border-[3px] border-cave bg-card p-4 shadow-[var(--shadow-stone)]">
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm uppercase text-cave">
              <UserPlus className="h-4 w-4" />
              {t('admin.inviteHeading')}
            </h2>

            {inviteError && (
              <div className="mb-3 rounded-lg bg-fire/20 px-3 py-2 text-xs font-semibold text-cave">
                {inviteError}
              </div>
            )}
            {invited && (
              <div className="mb-3 rounded-lg bg-moss/20 px-3 py-2 text-xs font-semibold text-cave">
                {invited}
              </div>
            )}

            <form onSubmit={submitInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label
                  htmlFor="invite-email"
                  className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70"
                >
                  {t('admin.inviteEmail')}
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('admin.inviteEmailPlaceholder')}
                  required
                  className="stone-tablet w-full px-3 py-2 text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="invite-role"
                  className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70"
                >
                  {t('admin.inviteRole')}
                </label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="stone-tablet w-full px-3 py-2 text-sm font-semibold text-cave focus:outline-none sm:w-36"
                >
                  <option value="user">{t('admin.roleUser')}</option>
                  <option value="admin">{t('admin.roleAdmin')}</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="invite-locale"
                  className="mb-1 block text-xs font-bold uppercase tracking-wider text-cave/70"
                >
                  {t('admin.inviteLanguage')}
                </label>
                <select
                  id="invite-locale"
                  value={inviteLocale}
                  onChange={(e) => setInviteLocale(e.target.value as Locale)}
                  className="stone-tablet w-full px-3 py-2 text-sm font-semibold text-cave focus:outline-none sm:w-40"
                >
                  {SUPPORTED_LOCALES.map((supported) => (
                    <option key={supported} value={supported}>
                      {LOCALE_LABELS[supported]}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={inviting || !email.trim()}
                className="rounded-2xl border-[3px] border-cave bg-fire px-4 py-2.5 font-display text-xs uppercase text-fire-foreground shadow-[var(--shadow-stone)] transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inviting ? t('admin.inviteSending') : t('admin.inviteSubmit')}
              </button>
            </form>

            <p className="mt-3 text-[11px] font-semibold text-muted-foreground">
              {t('admin.inviteHint')}
            </p>
          </section>

          {/* ── Users ── */}
          <section className="rounded-2xl border-[3px] border-cave bg-card p-4 shadow-[var(--shadow-stone)]">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-display text-sm uppercase text-cave">
                {t('admin.membersHeading', { count: users.length })}
              </h2>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                aria-label={t('admin.refresh')}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl border-[3px] border-cave bg-secondary text-cave transition hover:bg-card active:translate-y-0.5 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadError && (
              <div className="rounded-lg bg-fire/20 px-3 py-2 text-xs font-semibold text-cave">
                {loadError}
              </div>
            )}

            {!loadError && loading && (
              <p className="py-4 text-center text-sm font-semibold text-muted-foreground">
                {t('admin.loadingUsers')}
              </p>
            )}

            {!loadError && !loading && users.length === 0 && (
              <p className="py-4 text-center text-sm font-semibold text-muted-foreground">
                {t('admin.noUsers')}
              </p>
            )}

            {!loadError && !loading && users.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 font-bold">{t('admin.columnUser')}</th>
                      <th className="pb-2 font-bold">{t('admin.columnRole')}</th>
                      <th className="pb-2 font-bold">{t('admin.columnStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.username} className="border-t-2 border-cave/20">
                        <td className="py-2 font-semibold text-cave">
                          {user.email ?? user.username}
                        </td>
                        <td className="py-2">
                          {user.role === 'admin' ? (
                            <span className="inline-flex items-center gap-1 rounded-lg border-2 border-cave bg-fire px-1.5 py-0.5 font-display text-[10px] uppercase text-fire-foreground">
                              <ShieldCheck className="h-3 w-3" />
                              {t('admin.roleAdmin')}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-muted-foreground">
                              {t('admin.roleUser')}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-xs font-semibold text-muted-foreground">
                          {statusLabel(t, user)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
