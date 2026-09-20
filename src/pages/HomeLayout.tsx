import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bookmark, ChevronDown, Folder, Globe, House, LogOut, Plus, Search, ShieldCheck, UserRound, UserRoundCog } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { isStaffRole, useAuthStore } from '../features/auth/useAuthStore'
import { AuthDialog } from '../features/auth/AuthDialog'
import { requireAccount } from '../features/auth/authGate'
import { createAndOpenProject } from '../features/projects/ProjectCards'
import { NotificationBell } from '../features/notifications/NotificationBell'
import '../state/notificationsStore'
import '../features/layers/LayerContextMenu.css'
import '../features/auth/AuthDialog.css'
import './HomeLayout.css'

/**
 * Everything outside the editor: a Figma-style sidebar (account, search,
 * Recents, Community, then your Projects and Collections, Admin for
 * staff) with the current section on the right.
 */
export function HomeLayout() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const [query, setQuery] = useState('')

  const search = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
  }

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="shell__top">
          <AccountChip />
          {user && <NotificationBell />}
        </div>
        <form className="shell__search" onSubmit={search}>
          <Search size={15} />
          <input value={query} placeholder="Search projects, models, people" aria-label="Search" onChange={(e) => setQuery(e.target.value)} />
        </form>
        <nav className="shell__nav">
          <NavLink to="/" end className={({ isActive }) => `shell__link ${isActive ? 'shell__link--active' : ''}`}>
            <House size={16} />
            Home
          </NavLink>
          {isSupabaseConfigured && (
            <NavLink to="/community" className={({ isActive }) => `shell__link ${isActive ? 'shell__link--active' : ''}`}>
              <Globe size={16} />
              Community
            </NavLink>
          )}
        </nav>
        <div className="shell__divider" />
        <div className="shell__space">
          <span className="shell__space-name">{profile?.displayName || (user ? 'Your space' : 'This browser')}</span>
          {!user && isSupabaseConfigured && <span className="shell__badge">guest</span>}
          {profile && profile.role !== 'user' && <span className="shell__badge shell__badge--accent">{profile.role}</span>}
        </div>
        <nav className="shell__nav">
          <NavLink to="/projects" className={({ isActive }) => `shell__link ${isActive ? 'shell__link--active' : ''}`}>
            <Folder size={16} />
            Projects
          </NavLink>
          {isSupabaseConfigured && (
            <NavLink
              to="/collections"
              className={({ isActive }) => `shell__link ${isActive ? 'shell__link--active' : ''}`}
              onClick={(e) => {
                if (!requireAccount('collections')) e.preventDefault()
              }}
            >
              <Bookmark size={16} />
              Collections
            </NavLink>
          )}
          {isStaffRole(profile) && (
            <NavLink to="/admin" className={({ isActive }) => `shell__link ${isActive ? 'shell__link--active' : ''}`}>
              <ShieldCheck size={16} />
              Admin
            </NavLink>
          )}
        </nav>
        <div className="shell__sidebar-bottom">
          <button type="button" className="shell__new" onClick={() => createAndOpenProject(navigate)}>
            <Plus size={15} />
            New project
          </button>
        </div>
      </aside>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  )
}

/** Avatar + name at the top of the sidebar; opens the account popover. */
function AccountChip() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const loading = useAuthStore((s) => s.loading)
  const signOut = useAuthStore((s) => s.signOut)
  const [open, setOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)

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

  if (!isSupabaseConfigured) {
    return (
      <div className="shell__account">
        <span className="shell__logo">sg</span>
        <span className="shell__account-name">smartgrid</span>
      </div>
    )
  }
  if (loading) return <div className="shell__account" />
  if (!user) {
    return (
      <>
        <button type="button" className="shell__account shell__account--button" onClick={() => setAuthOpen(true)}>
          <span className="shell__avatar">
            <UserRound size={16} />
          </span>
          <span className="shell__account-name">Sign in</span>
        </button>
        {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
      </>
    )
  }
  const meta = user.user_metadata as { avatar_url?: string; full_name?: string } | undefined
  const name = profile?.displayName || meta?.full_name || user.email || ''
  const avatarUrl = profile?.avatarUrl ?? meta?.avatar_url
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  return (
    <div className="shell__account-wrap" ref={ref}>
      <button
        ref={chipRef}
        type="button"
        className="shell__account shell__account--button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = chipRef.current?.getBoundingClientRect()
          if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width })
          setOpen((o) => !o)
        }}
      >
        <span className="shell__avatar">{avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : name.slice(0, 1).toUpperCase()}</span>
        <span className="shell__account-name">{name}</span>
        {profile && (
          <span className="level-badge" title={`Level ${profile.level} · ${profile.xp} XP`}>
            L{profile.level}
          </span>
        )}
        <ChevronDown size={14} className="shell__account-chevron" />
      </button>
      {open && (
        <div className="layer-context-menu shell__account-menu" role="menu" style={pos ? { left: pos.left, top: pos.top, width: Math.max(220, pos.width) } : undefined}>
          <div className="user-menu__popover-header">
            <strong>{name}</strong>
            <span>{user.email}</span>
          </div>
          <div className="layer-context-menu__divider" />
          <button type="button" role="menuitem" onClick={() => go(`/u/${user.id}`)}>
            <UserRound size={13} />
            My profile
          </button>
          <button type="button" role="menuitem" onClick={() => go('/account')}>
            <UserRoundCog size={13} />
            Account settings
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
              void signOut().then(() => navigate('/'))
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

/** Section header used by the pages inside the layout. */
export function PageHeader({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="page__header">
      <div>
        <h1>{title}</h1>
        {hint && <p>{hint}</p>}
      </div>
      {children && <div className="page__header-actions">{children}</div>}
    </div>
  )
}
