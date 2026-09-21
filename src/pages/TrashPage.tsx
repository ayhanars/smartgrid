import { useCallback, useEffect, useMemo, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useAuthStore } from '../features/auth/useAuthStore'
import { listLocalTrash, TRASH_DAYS, type TrashedProjectMeta } from '../lib/persistence/localProjects'
import { loadLocalThumbnail } from '../lib/persistence/thumbnails'
import { purgeProjectEverywhere, restoreProjectEverywhere } from '../lib/persistence/cloudSync'
import { listTrashedCloudProjects, type CloudProjectMeta } from '../lib/supabase/projects'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { useSiteSettings } from '../lib/supabase/settings'
import { PageHeader } from './HomeLayout'
import './HomePage.css'

interface TrashEntry {
  id: string
  name: string
  deletedAt: number
  thumbnail: string | null
  where: 'browser' | 'cloud' | 'both'
}

const DAY = 86_400_000

/** `/trash`: deleted projects, restorable until their keep period runs
 * out (30 days by default, a site setting for cloud projects). */
export function TrashPage() {
  const user = useAuthStore((s) => s.user)
  const days = useSiteSettings((s) => s.settings.trashDays)
  const [local, setLocal] = useState<TrashedProjectMeta[]>([])
  const [cloud, setCloud] = useState<CloudProjectMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLocal(listLocalTrash(days))
    if (user && isSupabaseConfigured) {
      listTrashedCloudProjects()
        .then((list) => {
          setCloud(list)
          setError(null)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the cloud trash'))
    } else setCloud(null)
  }, [user, days])
  useEffect(refresh, [refresh])

  const entries = useMemo((): TrashEntry[] => {
    const byId = new Map<string, TrashEntry>()
    for (const p of local) byId.set(p.id, { id: p.id, name: p.name, deletedAt: p.deletedAt, thumbnail: loadLocalThumbnail(p.id), where: 'browser' })
    for (const c of cloud ?? []) {
      const existing = byId.get(c.id)
      if (existing) {
        existing.where = 'both'
        existing.thumbnail ??= c.thumbnail
        existing.deletedAt = Math.max(existing.deletedAt, c.deletedAt ?? 0)
      } else byId.set(c.id, { id: c.id, name: c.name, deletedAt: c.deletedAt ?? Date.now(), thumbnail: c.thumbnail, where: 'cloud' })
    }
    return [...byId.values()].sort((a, b) => b.deletedAt - a.deletedAt)
  }, [local, cloud])

  const restore = async (e: TrashEntry) => {
    setBusy(e.id)
    try {
      await restoreProjectEverywhere(e.id)
    } finally {
      setBusy(null)
      refresh()
    }
  }
  const purge = async (e: TrashEntry) => {
    if (!window.confirm(`Delete "${e.name}" forever? This cannot be undone.`)) return
    setBusy(e.id)
    try {
      await purgeProjectEverywhere(e.id)
    } finally {
      setBusy(null)
      refresh()
    }
  }
  const emptyAll = async () => {
    if (!window.confirm(`Delete all ${entries.length} projects in the trash forever?`)) return
    setBusy('all')
    try {
      for (const e of entries) await purgeProjectEverywhere(e.id)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const keep = user ? days : TRASH_DAYS
  const daysLeft = (e: TrashEntry) => Math.max(0, Math.ceil((e.deletedAt + keep * DAY - Date.now()) / DAY))

  return (
    <div>
      <PageHeader title="Trash" hint={`Deleted projects stay here for ${keep} days, then they are removed for good.${user && cloud === null && !error ? ' Checking the cloud…' : ''}`}>
        {entries.length > 0 && (
          <button type="button" className="page__button" disabled={busy !== null} onClick={() => void emptyAll()}>
            <Trash2 size={14} />
            Empty trash
          </button>
        )}
      </PageHeader>
      {error && <p className="account__error">{error}</p>}
      {entries.length === 0 ? (
        <div className="home__empty home__empty--static">
          <Trash2 size={18} />
          <strong>The trash is empty</strong>
          <span>Projects you delete land here first, so a slip is easy to undo.</span>
        </div>
      ) : (
        <div className="home__grid">
          {entries.map((e) => (
            <div key={e.id} className="home__card home__card--trash">
              <div className={`home__thumb ${e.thumbnail ? 'home__thumb--picture' : ''}`}>{e.thumbnail ? <img className="home__thumb-img" src={e.thumbnail} alt="" /> : null}</div>
              <div className="home__card-body">
                <span className="home__card-name">{e.name}</span>
                <span className="home__card-meta">
                  Deleted {new Date(e.deletedAt).toLocaleDateString()} · {daysLeft(e)} day{daysLeft(e) === 1 ? '' : 's'} left · {e.where === 'both' ? 'browser + cloud' : e.where}
                </span>
                <div className="home__card-actions">
                  <button type="button" className="page__button" disabled={busy !== null} onClick={() => void restore(e)}>
                    <RotateCcw size={13} />
                    Restore
                  </button>
                  <button type="button" className="page__button page__button--danger" disabled={busy !== null} onClick={() => void purge(e)}>
                    <Trash2 size={13} />
                    Delete forever
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
