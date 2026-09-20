import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Eye, EyeOff, ExternalLink, RefreshCw, Search, ShieldCheck, Star, Trash2, XCircle } from 'lucide-react'
import { isStaffRole, useAuthStore } from '../features/auth/useAuthStore'
import { Avatar } from '../features/community/CommunityCard'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { fetchAdminStats, fetchAdminUsers, setUserRole, type AdminStats, type AdminUser } from '../lib/supabase/admin'
import { deleteCommunityItem, listCommunityItems, moderateCommunityItem, reviewCommunityItem, type CommunityItem, type CommunityStatus } from '../lib/supabase/community'
import { listPendingCollections, reviewCollection, type Collection } from '../lib/supabase/collections'
import { useNotifications } from '../state/notificationsStore'
import type { UserRole } from '../lib/supabase/profiles'
import '../features/community/community.css'
import './HomePage.css'
import './AccountPage.css'
import './AdminPage.css'

type Tab = 'overview' | 'approvals' | 'community' | 'users'

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** `/admin`: staff-only dashboard. Moderators see everything and moderate
 * the community; admins also change roles and delete shared items. */
export function AdminPage() {
  const navigate = useNavigate()
  const loading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = tabParam === 'approvals' || tabParam === 'community' || tabParam === 'users' ? tabParam : 'overview'
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    if (t === 'overview') next.delete('tab')
    else next.set('tab', t)
    setParams(next, { replace: true })
  }

  const staff = isStaffRole(profile)
  const admin = profile?.role === 'admin'

  useEffect(() => {
    if (!isSupabaseConfigured || (!loading && !user)) navigate('/', { replace: true })
  }, [loading, user, navigate])

  if (!user || !profile) return null
  if (!staff) {
    return <div className="community-empty">This page is for moderators and admins.</div>
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'community', label: 'Community' },
    { id: 'users', label: 'Users' },
  ]

  return (
    <div>
      <div className="admin">
        <div className="admin__title">
          <ShieldCheck size={18} />
          <h1>Admin</h1>
          <span className="admin__role">{profile.role}</span>
        </div>
        <div className="admin__tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'overview' && <Overview />}
        {tab === 'approvals' && <Approvals navigate={navigate} />}
        {tab === 'community' && <CommunityAdmin admin={admin} navigate={navigate} />}
        {tab === 'users' && <UsersAdmin admin={admin} selfId={user.id} />}
      </div>
    </div>
  )
}

function useLoader<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(() => {
    setBusy(true)
    load()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false))
  }, [load])
  useEffect(run, [run])
  return { data, error, busy, reload: run, setData }
}

const fmt = (n: number) => n.toLocaleString()

function Overview() {
  const { data, error, busy, reload } = useLoader(fetchAdminStats)
  const tiles: { label: string; value: (s: AdminStats) => string; hint?: (s: AdminStats) => string }[] = [
    { label: 'Users', value: (s) => fmt(s.users), hint: (s) => `${fmt(s.users_7d)} joined in the last 7 days` },
    { label: 'Cloud projects', value: (s) => fmt(s.projects), hint: (s) => `${fmt(s.assets)} personal assets` },
    { label: 'Waiting for review', value: (s) => fmt(s.community_pending), hint: () => 'models and collections' },
    { label: 'Community models', value: (s) => fmt(s.community_published), hint: (s) => `${fmt(s.community_hidden)} hidden · ${fmt(s.community_removed)} removed` },
    { label: 'Copies opened', value: (s) => fmt(s.community_downloads), hint: (s) => `${fmt(s.community_likes)} likes · ${fmt(s.community_comments)} comments` },
    { label: 'Collections', value: (s) => fmt(s.collections) },
  ]
  return (
    <section>
      <Toolbar busy={busy} onReload={reload} />
      {error && <p className="account__error">{error}</p>}
      <div className="admin__tiles">
        {tiles.map((t) => (
          <div key={t.label} className="admin__tile">
            <span className="admin__tile-label">{t.label}</span>
            <strong>{data ? t.value(data) : '…'}</strong>
            {t.hint && data && <span className="admin__tile-hint">{t.hint(data)}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}

function Toolbar({ busy, onReload, children }: { busy: boolean; onReload: () => void; children?: React.ReactNode }) {
  return (
    <div className="admin__toolbar">
      {children}
      <button type="button" className="admin__icon-btn" title="Reload" aria-label="Reload" disabled={busy} onClick={onReload}>
        <RefreshCw size={14} className={busy ? 'admin__spin' : undefined} />
      </button>
    </div>
  )
}

function Approvals({ navigate }: { navigate: (to: string) => void }) {
  const loadItems = useCallback(() => listCommunityItems({ pendingOnly: true, includeUnpublished: true }), [])
  const items = useLoader(loadItems)
  const loadCollections = useCallback(() => listPendingCollections(), [])
  const collections = useLoader(loadCollections)
  const refreshNotifications = useNotifications((s) => s.refresh)
  const [actionError, setActionError] = useState<string | null>(null)
  const busy = items.busy || collections.busy

  const decideItem = async (item: CommunityItem, approval: 'approved' | 'rejected') => {
    const note = approval === 'rejected' ? window.prompt(`Why is "${item.title}" not approved? The author will see this.`, '') : ''
    if (note === null) return
    try {
      await reviewCommunityItem(item.id, approval, note)
      items.setData((list) => (list ? list.filter((i) => i.id !== item.id) : list))
      void refreshNotifications()
    } catch (err) {
      setActionError(errorText(err))
    }
  }
  const decideCollection = async (c: Collection, approval: 'approved' | 'rejected') => {
    const note = approval === 'rejected' ? window.prompt(`Why is "${c.name}" not approved? The owner will see this.`, '') : ''
    if (note === null) return
    try {
      await reviewCollection(c.id, approval, note)
      collections.setData((list) => (list ? list.filter((i) => i.id !== c.id) : list))
      void refreshNotifications()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  return (
    <section>
      <Toolbar
        busy={busy}
        onReload={() => {
          items.reload()
          collections.reload()
        }}
      >
        <span className="admin__count">
          {(items.data?.length ?? 0) + (collections.data?.length ?? 0)} waiting · approving makes it visible to everyone, rejecting sends the author your note
        </span>
      </Toolbar>
      {(items.error || collections.error || actionError) && <p className="account__error">{items.error ?? collections.error ?? actionError}</p>}
      <h3 className="admin__subtitle">Models</h3>
      <div className="admin__table-wrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Author</th>
              <th>Kind</th>
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).map((item) => (
              <tr key={item.id}>
                <td>
                  <button type="button" className="admin__link" onClick={() => navigate(`/c/${item.id}`)}>
                    {item.thumbnail ? <img className="admin__thumb" src={item.thumbnail} alt="" /> : <span className="admin__thumb" />}
                    <span>{item.title}</span>
                  </button>
                </td>
                <td>
                  <span className="admin__author">
                    <Avatar name={item.author.displayName} url={item.author.avatarUrl} />
                    {item.author.displayName}
                  </span>
                </td>
                <td>{item.parentId ? 'version' : 'new model'}</td>
                <td>{new Date(item.updatedAt).toLocaleString()}</td>
                <td className="admin__actions">
                  <button type="button" className="admin__approve" onClick={() => void decideItem(item, 'approved')}>
                    <Check size={13} />
                    Approve
                  </button>
                  <button type="button" className="admin__reject" onClick={() => void decideItem(item, 'rejected')}>
                    <XCircle size={13} />
                    Reject
                  </button>
                  <button type="button" className="admin__icon-btn" title="Open" aria-label="Open" onClick={() => navigate(`/c/${item.id}`)}>
                    <ExternalLink size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {items.data && items.data.length === 0 && (
              <tr>
                <td colSpan={5} className="admin__empty">
                  No models waiting.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h3 className="admin__subtitle">Collections</h3>
      <div className="admin__table-wrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th>Collection</th>
              <th>Owner</th>
              <th>Models</th>
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(collections.data ?? []).map((c) => (
              <tr key={c.id}>
                <td>
                  <button type="button" className="admin__link" onClick={() => navigate(`/collections/${c.id}`)}>
                    <span>{c.name}</span>
                  </button>
                  {c.description && <div className="admin__muted">{c.description}</div>}
                </td>
                <td>
                  <span className="admin__author">
                    <Avatar name={c.owner.displayName} url={c.owner.avatarUrl} />
                    {c.owner.displayName}
                  </span>
                </td>
                <td>{c.count}</td>
                <td>{new Date(c.createdAt).toLocaleString()}</td>
                <td className="admin__actions">
                  <button type="button" className="admin__approve" onClick={() => void decideCollection(c, 'approved')}>
                    <Check size={13} />
                    Approve
                  </button>
                  <button type="button" className="admin__reject" onClick={() => void decideCollection(c, 'rejected')}>
                    <XCircle size={13} />
                    Reject
                  </button>
                </td>
              </tr>
            ))}
            {collections.data && collections.data.length === 0 && (
              <tr>
                <td colSpan={5} className="admin__empty">
                  No collections waiting.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CommunityAdmin({ admin, navigate }: { admin: boolean; navigate: (to: string) => void }) {
  const [filter, setFilter] = useState<'all' | CommunityStatus>('all')
  const load = useCallback(() => listCommunityItems({ includeUnpublished: true }), [])
  const { data, error, busy, reload, setData } = useLoader(load)
  const [actionError, setActionError] = useState<string | null>(null)

  const patch = async (item: CommunityItem, change: { status?: CommunityStatus; featured?: boolean }) => {
    try {
      const next = await moderateCommunityItem(item.id, change)
      setData((list) => (list ? list.map((i) => (i.id === item.id ? next : i)) : list))
      setActionError(null)
    } catch (err) {
      setActionError(errorText(err))
    }
  }
  const remove = async (item: CommunityItem) => {
    if (!window.confirm(`Permanently delete "${item.title}" by ${item.author.displayName}? Prefer "Remove" (keeps a record) unless it must go.`)) return
    try {
      await deleteCommunityItem(item.id)
      setData((list) => (list ? list.filter((i) => i.id !== item.id) : list))
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const rows = (data ?? []).filter((i) => filter === 'all' || i.status === filter)
  return (
    <section>
      <Toolbar busy={busy} onReload={reload}>
        <div className="community-filter" role="group" aria-label="Status">
          {(['all', 'published', 'hidden', 'removed'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <span className="admin__count">{rows.length} items</span>
      </Toolbar>
      {(error || actionError) && <p className="account__error">{error ?? actionError}</p>}
      <div className="admin__table-wrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Author</th>
              <th>Status</th>
              <th>Copies</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <button type="button" className="admin__link" onClick={() => navigate(`/c/${item.id}`)}>
                    {item.thumbnail ? <img className="admin__thumb" src={item.thumbnail} alt="" /> : <span className="admin__thumb" />}
                    <span>
                      {item.featured && <Star size={11} className="admin__star" />}
                      {item.title}
                    </span>
                  </button>
                </td>
                <td>
                  <span className="admin__author">
                    <Avatar name={item.author.displayName} url={item.author.avatarUrl} />
                    {item.author.displayName}
                  </span>
                </td>
                <td>
                  <span className={`admin__status admin__status--${item.status}`}>{item.status}</span>
                  {item.approval !== 'approved' && <span className={`admin__status admin__status--${item.approval === 'pending' ? 'hidden' : 'removed'}`} style={{ marginLeft: 4 }}>{item.approval}</span>}
                </td>
                <td>{item.downloads}</td>
                <td>{new Date(item.updatedAt).toLocaleDateString()}</td>
                <td className="admin__actions">
                  <button type="button" className="admin__icon-btn" title={item.featured ? 'Unfeature' : 'Feature'} aria-label={item.featured ? 'Unfeature' : 'Feature'} onClick={() => void patch(item, { featured: !item.featured })}>
                    <Star size={13} fill={item.featured ? 'currentColor' : 'none'} />
                  </button>
                  {item.status === 'published' ? (
                    <button type="button" className="admin__icon-btn" title="Hide" aria-label="Hide" onClick={() => void patch(item, { status: 'hidden' })}>
                      <EyeOff size={13} />
                    </button>
                  ) : (
                    <button type="button" className="admin__icon-btn" title="Publish" aria-label="Publish" onClick={() => void patch(item, { status: 'published' })}>
                      <Eye size={13} />
                    </button>
                  )}
                  {item.status !== 'removed' && (
                    <button type="button" className="admin__icon-btn" title="Remove (kept for the record)" aria-label="Remove" onClick={() => void patch(item, { status: 'removed' })}>
                      <Trash2 size={13} />
                    </button>
                  )}
                  {admin && item.status === 'removed' && (
                    <button type="button" className="admin__icon-btn admin__icon-btn--danger" title="Delete permanently" aria-label="Delete permanently" onClick={() => void remove(item)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button type="button" className="admin__icon-btn" title="Open" aria-label="Open" onClick={() => navigate(`/c/${item.id}`)}>
                    <ExternalLink size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="admin__empty">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function UsersAdmin({ admin, selfId }: { admin: boolean; selfId: string }) {
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const load = useCallback(() => fetchAdminUsers(applied), [applied])
  const { data, error, busy, reload, setData } = useLoader(load)
  const [actionError, setActionError] = useState<string | null>(null)

  const changeRole = async (u: AdminUser, role: UserRole) => {
    if (u.id === selfId && role !== 'admin' && !window.confirm('Remove your own admin role? You will lose access to this page.')) return
    try {
      const saved = await setUserRole(u.id, role)
      setData((list) => (list ? list.map((x) => (x.id === u.id ? { ...x, role: saved } : x)) : list))
      setActionError(null)
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  return (
    <section>
      <Toolbar busy={busy} onReload={reload}>
        <form
          className="community-search"
          onSubmit={(e) => {
            e.preventDefault()
            setApplied(query.trim())
          }}
        >
          <Search size={14} />
          <input value={query} placeholder="Search by email or name" aria-label="Search users" onChange={(e) => setQuery(e.target.value)} />
        </form>
        <span className="admin__count">{data?.length ?? 0} users</span>
      </Toolbar>
      {(error || actionError) && <p className="account__error">{error ?? actionError}</p>}
      <div className="admin__table-wrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Level</th>
              <th>Projects</th>
              <th>Shared</th>
              <th>Joined</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="admin__author">
                    <Avatar name={u.displayName || u.email} url={u.avatarUrl} />
                    <span className="admin__user">
                      <strong>{u.displayName || '—'}</strong>
                      <span>{u.email}</span>
                    </span>
                  </span>
                </td>
                <td>
                  {admin ? (
                    <select className="admin__select" value={u.role} aria-label={`Role for ${u.email}`} onChange={(e) => void changeRole(u, e.target.value as UserRole)}>
                      <option value="user">user</option>
                      <option value="moderator">moderator</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span className={`admin__status admin__status--${u.role}`}>{u.role}</span>
                  )}
                </td>
                <td title={`${u.xp} XP`}>
                  <span className="level-badge">L{u.level}</span> <span className="admin__muted">{u.xp} XP</span>
                </td>
                <td>{u.projects}</td>
                <td>{u.communityItems}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>{u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!admin && <p className="community-item__hint">Only admins can change roles.</p>}
    </section>
  )
}
