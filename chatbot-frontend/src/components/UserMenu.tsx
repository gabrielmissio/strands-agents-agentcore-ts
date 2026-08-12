import { useEffect, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useI18n } from '@/lib/i18n/context.ts'

function getInitials(email?: string): string {
  if (!email) return '?'
  const local = email.split('@')[0]
  const parts = local.split(/[^a-zA-Z]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (parts[0]?.slice(0, 2) ?? '??').toUpperCase()
}

interface UserMenuProps {
  email?: string
  onSignOut: () => void | Promise<void>
  signingOut?: boolean
}

export function UserMenu({ email, onSignOut, signingOut }: UserMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('common.userMenu')}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-xl border-[3px] border-cave bg-card font-display text-xs font-bold uppercase text-cave shadow-[var(--shadow-stone)] transition hover:bg-secondary active:translate-y-0.5 active:shadow-none"
      >
        {getInitials(email)}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[13rem] rounded-2xl border-[3px] border-cave bg-card p-3 shadow-[var(--shadow-stone)]">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t('common.connectedAs')}
          </p>
          <p className="mb-3 break-all text-xs font-semibold text-cave">
            {email ?? '—'}
          </p>
          <button
            type="button"
            onClick={() => { setOpen(false); void onSignOut() }}
            disabled={signingOut}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border-[3px] border-cave bg-secondary px-3 py-2 text-xs font-semibold text-cave shadow-[var(--shadow-stone)] transition hover:bg-stone active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('common.signOutLabel')}
          </button>
        </div>
      )}
    </div>
  )
}
