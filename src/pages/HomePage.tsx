import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, Copy, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createLocalProject,
  deleteLocalProject,
  duplicateLocalProject,
  listLocalProjects,
  loadLocalProject,
  renameLocalProject,
  type DocumentSnapshot,
  type LocalProjectMeta,
} from '../lib/persistence/localProjects'
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

/** Landing page: every project saved in this browser, plus where cloud
 * versions will live once sync ships. */
export function HomePage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<LocalProjectMeta[]>(() => listLocalProjects())
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const refresh = () => setProjects(listLocalProjects())

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
    if (!window.confirm(`Delete "${name}" from this browser? This can't be undone.`)) return
    deleteLocalProject(id)
    refresh()
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
        <button type="button" className="home__new" onClick={createProject}>
          <Plus size={15} />
          New project
        </button>
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

        <section className="home__section">
          <div className="home__section-header">
            <h2>Cloud versions</h2>
            <span className="home__hint">Coming soon</span>
          </div>
          <div className="home__cloud">
            <Cloud size={22} />
            <div>
              <strong>Sync your projects to the cloud</strong>
              <p>Sign in to keep a version history of every project and open it from any device. Available when we release — your local versions above will be ready to upload.</p>
            </div>
            <button type="button" className="home__cloud-btn" disabled>
              Sign in · soon
            </button>
          </div>
        </section>
      </main>

      {menu && (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={() => open(menu.id)}
          onRename={() => setRenamingId(menu.id)}
          onDuplicate={() => duplicate(menu.id)}
          onDelete={() => remove(menu.id, projects.find((p) => p.id === menu.id)?.name ?? 'project')}
        />
      )}
    </div>
  )
}

function ProjectCard({
  meta,
  renaming,
  onOpen,
  onMenu,
  onRename,
  onCancelRename,
}: {
  meta: LocalProjectMeta
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
  onDelete,
}: {
  x: number
  y: number
  onClose: () => void
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
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
      <div className="layer-context-menu__divider" />
      <button type="button" role="menuitem" className="layer-context-menu__danger" onClick={run(onDelete)}>
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  )
}
