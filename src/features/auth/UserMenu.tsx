import { useEffect, useRef, useState } from 'react'
import { LogOut, UserRound } from 'lucide-react'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuthStore } from './useAuthStore'
import { AuthDialog } from './AuthDialog'
import '../layers/LayerContextMenu.css'
import './AuthDialog.css'

interface UserMenuProps {
  /** Hide the email next to the avatar (tight spots like the top bar). */
  compact?: boolean
}

/** "Sign in" when logged out; avatar + popover with sign-out when logged in.
 * Renders nothing when the build has no Supabase credentials. */
export function UserMenu({ compact }: UserMenuProps) {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const signOut = useAuthStore((s) => s.signOut)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  if (!isSupabaseConfigured || loading) return null

  if (!user) {
    return (
      <>
        <button type="button" className="user-menu__signin" onClick={() => setDialogOpen(true)}>
          <UserRound size={14} />
          Sign in
        </button>
        {dialogOpen && <AuthDialog onClose={() => setDialogOpen(false)} />}
      </>
    )
  }

  const email = user.email ?? ''
  const meta = user.user_metadata as { avatar_url?: string; full_name?: string } | undefined
  const label = meta?.full_name || email
  const initial = (label || '?').slice(0, 1)

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="user-menu__avatar">{meta?.avatar_url ? <img src={meta.avatar_url} alt="" referrerPolicy="no-referrer" /> : initial}</span>
        {!compact && <span className="user-menu__email">{label}</span>}
      </button>
      {open && (
        <div className="layer-context-menu user-menu__popover" role="menu">
          <div className="user-menu__popover-header">{email}</div>
          <div className="layer-context-menu__divider" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
