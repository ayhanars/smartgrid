import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, CloudUpload, Copy, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { UserMenu } from '../features/auth/UserMenu'
import { emptyDocument } from '../state/documentStore'
import { getBedPreset } from '../lib/geometry/bedPresets'
import { contourBounds, regionsToSvgPath } from '../lib/geometry/primitives'
import { ProjectPreview3D } from './ProjectPreview3D'
import '../features/layers/LayerContextMenu.css'
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

/** Landing page: every project saved in this browser, plus the signed-in
 * user's cloud copies. */
export function HomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [projects, setProjects] = useState<LocalProjectMeta[]>(() => listLocalProjects())
  const [cloudProjects, setCloudProjects] = useState<CloudProjectMeta[] | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const refresh = () => setProjects(listLocalProjects())

  const refreshCloud = useCallback(() => {
    if (!user) return
    listCloudProjects()
      .then((list) => {
        setCloudProjects(list)
        setCloudError(null)
      })
      .catch((err: unknown) => setCloudError(err instanceof Error ? err.message : 'Could not load cloud projects'))
  }, [user])
  useEffect(refreshCloud, [refreshCloud])

  const localIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects])
  const cloudIds = useMemo(() => new Set((user ? cloudProjects ?? [] : []).map((p) => p.id)), [user, cloudProjects])
  const cloudOnly = (user ? cloudProjects ?? [] : []).filter((p) => !localIds.has(p.id))

  const open = (id: string) => navigate(`/p/${id}`)
  const createProject = () => {
    const meta = createLocalProject(emptyDocument())
    navigate(`/p/${meta.id}`)
  }
  const duplicate = (id: string) => {
    duplicateLocalProject(id)
    refresh()
  }
  const remove = (id: string, name: string) => {
    const inCloud = user !== null && cloudIds.has(id)
    const where = inCloud ? 'from this browser and the cloud' : 'from this browser'
    if (!window.confirm(`Delete "${name}" ${where}? This can't be undone.`)) return
    void deleteProjectEverywhere(id).then(() => {
      refresh()
      refreshCloud()
    })
  }
  const upload = (id: string) => {
    uploadProject(id)
      .then((ok) => {
        if (ok) refreshCloud()
      })
      .catch((err: unknown) => setCloudError(err instanceof Error ? err.message : 'Upload failed'))
  }
  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) renameLocalProject(id, trimmed)
    setRenamingId(null)
    refresh()
  }

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
        <section className="home__section">
          <div className="home__section-header">
            <h2>Local versions</h2>
            <span className="home__hint">Saved in this browser as you work — {projects.length === 0 ? 'nothing yet' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}</span>
          </div>
          {projects.length === 0 ? (
            <button type="button" className="home__empty" onClick={createProject}>
              <Plus size={18} />
              <strong>Start your first project</strong>
              <span>Draw shapes, extrude them, and export for your printer. Everything autosaves here.</span>
            </button>
          ) : (
            <div className="home__grid">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  meta={p}
                  inCloud={user !== null && cloudIds.has(p.id)}
                  renaming={renamingId === p.id}
                  onOpen={() => open(p.id)}
                  onMenu={(x, y) => setMenu({ id: p.id, x, y })}
                  onRename={(name) => rename(p.id, name)}
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
              <h2>Cloud versions</h2>
              <span className="home__hint">
                {!user
                  ? 'Sign in to sync'
                  : cloudProjects === null
                    ? 'Loading…'
                    : `${cloudProjects.length} project${cloudProjects.length === 1 ? '' : 's'} in the cloud`}
              </span>
            </div>
            {!user ? (
              <div className="home__cloud">
                <Cloud size={22} />
                <div>
                  <strong>Sync your projects to the cloud</strong>
                  <p>Sign in to keep every project backed up, open it from any device, and use the design assistant. Projects you open while signed in sync automatically.</p>
                </div>
                <button type="button" className="home__cloud-btn" onClick={() => setAuthOpen(true)}>
                  Sign in
                </button>
              </div>
            ) : cloudError ? (
              <div className="home__cloud">
                <Cloud size={22} />
                <div>
                  <strong>Couldn't reach the cloud</strong>
                  <p>{cloudError}</p>
                </div>
                <button type="button" className="home__cloud-btn" onClick={refreshCloud}>
                  Retry
                </button>
              </div>
            ) : cloudOnly.length === 0 ? (
              <div className="home__cloud">
                <Cloud size={22} />
                <div>
                  <strong>{cloudIds.size === 0 ? 'Nothing in the cloud yet' : 'Everything is on this device'}</strong>
                  <p>
                    {cloudIds.size === 0
                      ? 'Open a project and it will sync as you work, or use “Upload to cloud” from a project’s menu.'
                      : 'All your cloud projects are also saved in this browser. Projects only in the cloud show up here.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="home__grid">
                {cloudOnly.map((p) => (
                  <div
                    key={p.id}
                    className="home__card home__card--cloud"
                    role="button"
                    tabIndex={0}
                    onClick={() => open(p.id)}
                    onKeyDown={(e) => e.key === 'Enter' && open(p.id)}
                  >
                    <div className="home__thumb home__thumb--cloud">
                      <Cloud size={26} />
                    </div>
                    <div className="home__card-body">
                      <span className="home__card-name">{p.name}</span>
                      <span className="home__card-meta">Edited {relativeTime(p.updatedAt)} · only in the cloud</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {menu && (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={() => open(menu.id)}
          onRename={() => setRenamingId(menu.id)}
          onDuplicate={() => duplicate(menu.id)}
          onUpload={user && isCloudSyncable(menu.id) && !cloudIds.has(menu.id) ? () => upload(menu.id) : undefined}
          onDelete={() => remove(menu.id, projects.find((p) => p.id === menu.id)?.name ?? 'project')}
        />
      )}
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
    </div>
  )
}

function ProjectCard({
  meta,
  inCloud,
  renaming,
  onOpen,
  onMenu,
  onRename,
  onCancelRename,
}: {
  meta: LocalProjectMeta
  inCloud: boolean
  renaming: boolean
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  onRename: (name: string) => void
  onCancelRename: () => void
}) {
  const [draft, setDraft] = useState(meta.name)
  const [hovered, setHovered] = useState(false)
  useEffect(() => setDraft(meta.name), [meta.name, renaming])
  const snapshot = useMemo(() => loadLocalProject(meta.id), [meta.id, meta.updatedAt])

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
      <div className="home__thumb">
        {snapshot && <Thumbnail snapshot={snapshot} />}
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
          Edited {relativeTime(meta.updatedAt)} · {meta.shapeCount} shape{meta.shapeCount === 1 ? '' : 's'}
          {inCloud && (
            <span className="home__card-cloud" title="Synced to the cloud">
              <Cloud size={11} />
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
  onRename: () => void
  onDuplicate: () => void
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
      <button type="button" role="menuitem" onClick={run(onRename)}>
        <Pencil size={13} />
        Rename
      </button>
      <button type="button" role="menuitem" onClick={run(onDuplicate)}>
        <Copy size={13} />
        Duplicate
      </button>
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
