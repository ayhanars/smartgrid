import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Cloud, CloudOff, CloudUpload, Copy, FolderOpen, Globe, MoreHorizontal, Pencil, Plus, Trash2, WifiOff } from 'lucide-react'
import {
  createLocalProject,
  duplicateLocalProject,
  listLocalProjects,
  loadLocalProject,
  renameLocalProject,
  type DocumentSnapshot,
  type LocalProjectMeta,
} from '../lib/persistence/localProjects'
import { deleteProjectEverywhere, isCloudSyncable, uploadProject } from '../lib/persistence/cloudSync'
import { listCloudProjects, type CloudProjectMeta } from '../lib/supabase/projects'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { useAuthStore } from '../features/auth/useAuthStore'
import { AuthDialog } from '../features/auth/AuthDialog'
import { isNetworkError, useConnectivity } from '../lib/connectivity'
import { UserMenu } from '../features/auth/UserMenu'
import { emptyDocument } from '../state/documentStore'
import { getBedPreset } from '../lib/geometry/bedPresets'
import { contourBounds, regionsToSvgPath } from '../lib/geometry/primitives'
import { ProjectPreview3D } from './ProjectPreview3D'
import { loadLocalThumbnail } from '../lib/persistence/thumbnails'
import { listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { CommunityCard } from '../features/community/CommunityCard'
import '../features/layers/LayerContextMenu.css'
import '../features/community/community.css'
import './HomePage.css'

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString()
}

/** One row of the home page: a project saved in this browser, in the cloud,
 * or both. */
interface ProjectEntry {
  id: string
  name: string
  updatedAt: number
  shapeCount: number | null
  /** Saved in this browser (opens instantly, can be renamed here). */
  local: LocalProjectMeta | null
  cloud: CloudProjectMeta | null
}

/** Landing page: one list of projects. Signed in, everything saved in this
 * browser is uploaded automatically and cloud copies from other devices
 * show up alongside; as a guest the same list is just this browser. */
export function HomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const authLoading = useAuthStore((s) => s.loading)
  const online = useConnectivity((s) => s.online)
  const [projects, setProjects] = useState<LocalProjectMeta[]>(() => listLocalProjects())
  const [cloudProjects, setCloudProjects] = useState<CloudProjectMeta[] | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Set<string>>(() => new Set())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [community, setCommunity] = useState<CommunityItem[] | null>(null)
  const refresh = () => setProjects(listLocalProjects())

  useEffect(() => {
    if (!isSupabaseConfigured || !online) return
    let cancelled = false
    listCommunityItems({ limit: 8 })
      .then((list) => !cancelled && setCommunity(list))
      .catch(() => !cancelled && setCommunity([]))
    return () => {
      cancelled = true
    }
  }, [online])

  const refreshCloud = useCallback(() => {
    if (!user) {
      setCloudProjects(null)
      return
    }
    listCloudProjects()
      .then((list) => {
        setCloudProjects(list)
        setCloudError(null)
      })
      .catch((err: unknown) => setCloudError(isNetworkError(err) ? 'No connection: showing what is saved in this browser. Cloud copies appear when you are back online.' : err instanceof Error ? err.message : 'Could not load cloud projects'))
  }, [user])
  useEffect(refreshCloud, [refreshCloud])
  // Back online: reload the cloud list (and clear the offline notice).
  useEffect(() => {
    if (online) refreshCloud()
  }, [online, refreshCloud])

  const guest = isSupabaseConfigured && !authLoading && user === null
  const cloudKnown = user !== null && cloudProjects !== null && !cloudError
  const cloudIds = useMemo(() => new Set((cloudProjects ?? []).map((p) => p.id)), [cloudProjects])

  // Signed in with the cloud list in hand: anything only in this browser
  // goes up now, so there is one set of projects wherever you sign in.
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (!cloudKnown || !online) return
    const missing = projects.filter((p) => isCloudSyncable(p.id) && !cloudIds.has(p.id) && !attempted.current.has(p.id))
    if (missing.length === 0) return
    for (const p of missing) attempted.current.add(p.id)
    setUploading((set) => new Set([...set, ...missing.map((p) => p.id)]))
    let done = 0
    for (const p of missing) {
      uploadProject(p.id)
        .then((ok) => {
          if (!ok) attempted.current.delete(p.id)
        })
        .catch((err: unknown) => {
          console.warn('Upload failed', err)
          attempted.current.delete(p.id)
          setFailed((set) => new Set([...set, p.id]))
        })
        .finally(() => {
          setUploading((set) => {
            const next = new Set(set)
            next.delete(p.id)
            return next
          })
          if (++done === missing.length) refreshCloud()
        })
    }
  }, [cloudKnown, online, projects, cloudIds, refreshCloud])
  // A user signing out (or a new one signing in) starts the bookkeeping over.
  useEffect(() => {
    attempted.current.clear()
    setFailed(new Set())
  }, [user?.id])

  const entries = useMemo((): ProjectEntry[] => {
    const byId = new Map<string, ProjectEntry>()
    for (const p of projects) byId.set(p.id, { id: p.id, name: p.name, updatedAt: p.updatedAt, shapeCount: p.shapeCount, local: p, cloud: null })
    for (const c of user ? cloudProjects ?? [] : []) {
      const existing = byId.get(c.id)
      if (existing) existing.cloud = c
      else byId.set(c.id, { id: c.id, name: c.name, updatedAt: c.updatedAt, shapeCount: null, local: null, cloud: c })
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projects, cloudProjects, user])

  const cloudStateFor = (e: ProjectEntry): CardCloudState => {
    if (!isSupabaseConfigured) return 'none'
    if (guest) return 'guest'
    if (e.cloud) return 'cloud'
    if (!e.local || !isCloudSyncable(e.id)) return 'none'
    if (uploading.has(e.id)) return 'uploading'
    if (failed.has(e.id) || !online) return 'missing'
    return cloudKnown ? 'uploading' : 'unknown'
  }

  const open = (id: string) => navigate(`/p/${id}`)
  const createProject = () => {
    const meta = createLocalProject(emptyDocument())
    navigate(`/p/${meta.id}`)
  }
  const duplicate = (id: string) => {
    duplicateLocalProject(id)
    refresh()
  }
  const remove = (entry: ProjectEntry) => {
    const where = entry.cloud && entry.local ? 'from this browser and the cloud' : entry.cloud ? 'from the cloud' : 'from this browser'
    if (!window.confirm(`Delete "${entry.name}" ${where}? This can't be undone.`)) return
    void deleteProjectEverywhere(entry.id).then(() => {
      refresh()
      refreshCloud()
    })
  }
  const upload = (id: string) => {
    setFailed((set) => {
      const next = new Set(set)
      next.delete(id)
      return next
    })
    setUploading((set) => new Set([...set, id]))
    uploadProject(id)
      .then((ok) => {
        if (ok) refreshCloud()
      })
      .catch((err: unknown) => {
        setFailed((set) => new Set([...set, id]))
        setCloudError(isNetworkError(err) ? 'No connection: the project was not uploaded. It will be retried when you are back online.' : err instanceof Error ? err.message : 'Upload failed')
      })
      .finally(() =>
        setUploading((set) => {
          const next = new Set(set)
          next.delete(id)
          return next
        }),
      )
  }
  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) renameLocalProject(id, trimmed)
    setRenamingId(null)
    refresh()
  }

  const menuEntry = menu ? entries.find((e) => e.id === menu.id) : undefined
  const notUploaded = entries.filter((e) => cloudStateFor(e) === 'missing').length

  return (
    <div className="home">
      <header className="home__header">
        <div className="home__brand">
          <span className="home__logo">sg</span>
          <span>smartgrid</span>
        </div>
        <div className="home__header-actions">
          <UserMenu />
          <button type="button" className="home__new" onClick={createProject}>
            <Plus size={15} />
            New project
          </button>
        </div>
      </header>

      <main className="home__main">
        {!online && (
          <div className="home__banner home__banner--warn" role="status">
            <WifiOff size={16} />
            <span>
              <strong>You are offline.</strong> Projects still save in this browser
              {notUploaded > 0 ? ` (${notUploaded} not uploaded yet)` : ''}; cloud sync and sharing resume when the connection is back.
            </span>
          </div>
        )}
        {online && guest && (
          <div className="home__banner" role="status">
            <CloudOff size={16} />
            <span>
              <strong>Guest mode.</strong> Your projects are saved only in this browser and are lost if its data is cleared. Sign in and they upload automatically.
            </span>
            <button type="button" className="home__cloud-btn" onClick={() => setAuthOpen(true)}>
              Sign in
            </button>
          </div>
        )}
        {online && user && cloudError && (
          <div className="home__banner home__banner--warn" role="status">
            <CloudOff size={16} />
            <span>
              <strong>Cloud unavailable.</strong> {cloudError}
            </span>
            <button type="button" className="home__cloud-btn" onClick={refreshCloud}>
              Retry
            </button>
          </div>
        )}
        {online && user && !cloudError && notUploaded > 0 && (
          <div className="home__banner home__banner--warn" role="status">
            <CloudOff size={16} />
            <span>
              <strong>{notUploaded} project{notUploaded === 1 ? '' : 's'} not uploaded.</strong> The cloud could not be reached for them; use “Upload to cloud” from a project’s menu to retry.
            </span>
          </div>
        )}
        <section className="home__section">
          <div className="home__section-header">
            <h2>Projects</h2>
            <span className="home__hint">
              {entries.length === 0
                ? 'Nothing yet'
                : `${entries.length} project${entries.length === 1 ? '' : 's'}`}
              {user && !cloudError && cloudProjects === null ? ' · checking the cloud…' : ''}
            </span>
          </div>
          {entries.length === 0 ? (
            <button type="button" className="home__empty" onClick={createProject}>
              <Plus size={18} />
              <strong>Start your first project</strong>
              <span>Draw shapes, extrude them, and export for your printer. Everything autosaves{user ? ' to the cloud' : ' in this browser'}.</span>
            </button>
          ) : (
            <div className="home__grid">
              {entries.map((e) => (
                <ProjectCard
                  key={e.id}
                  entry={e}
                  cloudState={cloudStateFor(e)}
                  renaming={renamingId === e.id}
                  onOpen={() => open(e.id)}
                  onMenu={(x, y) => setMenu({ id: e.id, x, y })}
                  onRename={(name) => rename(e.id, name)}
                  onCancelRename={() => setRenamingId(null)}
                />
              ))}
              <button type="button" className="home__card home__card--new" onClick={createProject}>
                <Plus size={20} />
                <span>New project</span>
              </button>
            </div>
          )}
        </section>

        {isSupabaseConfigured && (
          <section className="home__section">
            <div className="home__section-header">
              <h2>Community</h2>
              <span className="home__hint">Models people shared. Open a copy and make it yours.</span>
              <button type="button" className="home__see-all" onClick={() => navigate('/community')}>
                Browse all
                <ArrowRight size={13} />
              </button>
            </div>
            {!online ? (
              <div className="community-empty">The community needs a connection.</div>
            ) : community === null ? (
              <div className="community-empty">Loading…</div>
            ) : community.length === 0 ? (
              <div className="home__cloud">
                <Globe size={22} />
                <div>
                  <strong>Nothing shared yet</strong>
                  <p>Open a project and choose “Publish to community” from its menu to share a copy with everyone.</p>
                </div>
              </div>
            ) : (
              <div className="home__grid">
                {community.map((item) => (
                  <CommunityCard key={item.id} item={item} onOpen={() => navigate(`/c/${item.id}`)} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {menu && menuEntry && (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={() => open(menu.id)}
          onRename={menuEntry.local ? () => setRenamingId(menu.id) : undefined}
          onDuplicate={menuEntry.local ? () => duplicate(menu.id) : undefined}
          onUpload={user && menuEntry.local && !menuEntry.cloud && isCloudSyncable(menu.id) ? () => upload(menu.id) : undefined}
          onDelete={() => remove(menuEntry)}
        />
      )}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

type CardCloudState = 'none' | 'guest' | 'unknown' | 'uploading' | 'cloud' | 'missing'

function ProjectCard({
  entry,
  cloudState,
  renaming,
  onOpen,
  onMenu,
  onRename,
  onCancelRename,
}: {
  entry: ProjectEntry
  cloudState: CardCloudState
  renaming: boolean
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  onRename: (name: string) => void
  onCancelRename: () => void
}) {
  const meta = { id: entry.id, name: entry.name, updatedAt: entry.updatedAt }
  const [draft, setDraft] = useState(meta.name)
  const [hovered, setHovered] = useState(false)
  useEffect(() => setDraft(meta.name), [meta.name, renaming])
  const snapshot = useMemo(() => (entry.local ? loadLocalProject(meta.id) : null), [entry.local, meta.id, meta.updatedAt])
  const picture = useMemo(() => loadLocalThumbnail(meta.id) ?? entry.cloud?.thumbnail ?? null, [entry.cloud, meta.id, meta.updatedAt])

  return (
    <div
      className="home__card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className={`home__thumb ${picture ? 'home__thumb--picture' : ''} ${!picture && !snapshot ? 'home__thumb--cloud' : ''}`}>
        {picture ? <img className="home__thumb-img" src={picture} alt="" /> : snapshot ? <Thumbnail snapshot={snapshot} /> : <Cloud size={26} />}
        {/* Hover: the same project as a live 3D turntable, over the 2D thumbnail. */}
        {snapshot && hovered && (
          <div className="home__thumb-3d" aria-hidden>
            <ProjectPreview3D snapshot={snapshot} />
          </div>
        )}
      </div>
      <div className="home__card-body">
        {renaming ? (
          <input
            className="home__rename"
            value={draft}
            autoFocus
            aria-label="Project name"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onRename(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(draft)
              else if (e.key === 'Escape') onCancelRename()
            }}
          />
        ) : (
          <span className="home__card-name">{meta.name}</span>
        )}
        <span className="home__card-meta">
          Edited {relativeTime(meta.updatedAt)}
          {entry.shapeCount !== null ? ` · ${entry.shapeCount} shape${entry.shapeCount === 1 ? '' : 's'}` : ' · from the cloud'}
          {cloudState === 'uploading' && (
            <span className="home__card-cloud home__card-cloud--muted" title="Uploading to the cloud">
              <CloudUpload size={11} />
              uploading…
            </span>
          )}
          {cloudState === 'cloud' && (
            <span className="home__card-cloud" title="Synced to the cloud">
              <Cloud size={11} />
            </span>
          )}
          {cloudState === 'missing' && (
            <span className="home__card-cloud home__card-cloud--missing" title="Not uploaded to the cloud: it could not be reached. Use “Upload to cloud” from the menu to retry.">
              <CloudOff size={11} />
              not in cloud
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        className="home__card-menu"
        aria-label={`More actions for ${meta.name}`}
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onMenu(r.left, r.bottom + 4)
        }}
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  )
}

function Thumbnail({ snapshot }: { snapshot: DocumentSnapshot }) {
  const bed = getBedPreset(snapshot.bedPresetId)
  const w = bed?.width ?? snapshot.customBedWidth
  const h = bed?.height ?? snapshot.customBedHeight
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="home__thumb-svg" aria-hidden>
      <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
      {snapshot.order.map((id) => {
        const layer = snapshot.layers[id]
        if (!layer || !layer.visible) return null
        const pts = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((c) => c.points)])
        const local = contourBounds(pts)
        const spin = layer.transform.rotation ? ` rotate(${layer.transform.rotation} ${local.x + local.width / 2} ${local.y + local.height / 2})` : ''
        return (
          <path
            key={id}
            d={regionsToSvgPath(layer.regions)}
            transform={`translate(${layer.transform.x} ${layer.transform.y})${spin}`}
            fillRule="evenodd"
            fill={layer.isHole ? 'rgba(255,92,92,0.35)' : layer.color}
            fillOpacity={layer.isHole ? 1 : (layer.opacity ?? 100) / 100}
          />
        )
      })}
    </svg>
  )
}

function ProjectMenu({
  x,
  y,
  onClose,
  onOpen,
  onRename,
  onDuplicate,
  onUpload,
  onDelete,
}: {
  x: number
  y: number
  onClose: () => void
  onOpen: () => void
  onRename?: () => void
  onDuplicate?: () => void
  onUpload?: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  return (
    <div ref={ref} className="layer-context-menu" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 200) }} role="menu">
      <button type="button" role="menuitem" onClick={run(onOpen)}>
        <FolderOpen size={13} />
        Open
      </button>
      {onRename && (
        <button type="button" role="menuitem" onClick={run(onRename)}>
          <Pencil size={13} />
          Rename
        </button>
      )}
      {onDuplicate && (
        <button type="button" role="menuitem" onClick={run(onDuplicate)}>
          <Copy size={13} />
          Duplicate
        </button>
      )}
      {onUpload && (
        <button type="button" role="menuitem" onClick={run(onUpload)}>
          <CloudUpload size={13} />
          Upload to cloud
        </button>
      )}
      <div className="layer-context-menu__divider" />
      <button type="button" role="menuitem" className="layer-context-menu__danger" onClick={run(onDelete)}>
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  )
}
