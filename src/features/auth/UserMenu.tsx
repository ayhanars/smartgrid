import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, ShieldCheck, UserRound, UserRoundCog } from 'lucide-react'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { isStaffRole, useAuthStore } from './useAuthStore'
import { AuthDialog } from './AuthDialog'
import '../layers/LayerContextMenu.css'
import './AuthDialog.css'

interface UserMenuProps {
  /** Hide the name next to the avatar (tight spots like the top bar). */
  compact?: boolean
}

/** "Sign in" when logged out; avatar + popover (account, admin, sign out)
 * when logged in. Renders nothing when the build has no Supabase
 * credentials. */
export function UserMenu({ compact }: UserMenuProps) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
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
  const label = profile?.displayName || meta?.full_name || email
  const avatarUrl = profile?.avatarUrl ?? meta?.avatar_url
  const initial = (label || '?').slice(0, 1)
  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

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
        <span className="user-menu__avatar">{avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial}</span>
        {!compact && <span className="user-menu__email">{label}</span>}
      </button>
      {open && (
        <div className="layer-context-menu user-menu__popover" role="menu">
          <div className="user-menu__popover-header">
            <strong>{label}</strong>
            <span>{email}</span>
            {profile && profile.role !== 'user' && <span className="user-menu__role">{profile.role}</span>}
          </div>
          <div className="layer-context-menu__divider" />
          <button type="button" role="menuitem" onClick={() => go('/account')}>
            <UserRoundCog size={13} />
            Account
          </button>
          {isStaffRole(profile) && (
            <button type="button" role="menuitem" onClick={() => go('/admin')}>
              <ShieldCheck size={13} />
              Admin
            </button>
          )}
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
