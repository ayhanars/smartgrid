import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cloud, CloudOff, CloudUpload, Copy, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2, WifiOff } from 'lucide-react'
import { createLocalProject, loadLocalProject, type DocumentSnapshot } from '../../lib/persistence/localProjects'
import { loadLocalThumbnail } from '../../lib/persistence/thumbnails'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { contourBounds, regionsToSvgPath } from '../../lib/geometry/primitives'
import { emptyDocument } from '../../state/documentStore'
import { AuthDialog } from '../auth/AuthDialog'
import { useProjects, type CardCloudState, type ProjectEntry } from './useProjects'
import '../layers/LayerContextMenu.css'
import '../../pages/HomePage.css'

export function relativeTime(ts: number): string {
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

export function createAndOpenProject(navigate: (to: string) => void) {
  const meta = createLocalProject(emptyDocument())
  navigate(`/p/${meta.id}`)
}

/** Offline / guest / cloud-trouble notices for pages that list projects. */
export function ProjectBanners({ projects }: { projects: ReturnType<typeof useProjects> }) {
  const { online, guest, user, cloudError, notUploaded, refreshCloud } = projects
  const [authOpen, setAuthOpen] = useState(false)
  return (
    <>
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
      {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
    </>
  )
}

/** The project cards with their menu. `limit` shows only the newest few. */
export function ProjectGrid({ projects, limit, showNew = true }: { projects: ReturnType<typeof useProjects>; limit?: number; showNew?: boolean }) {
  const navigate = useNavigate()
  const { entries, cloudStateFor, menu, setMenu, menuEntry, renamingId, setRenamingId, rename, duplicate, remove, upload, user } = projects
  const shown = limit ? entries.slice(0, limit) : entries
  const open = (id: string) => navigate(`/p/${id}`)

  if (entries.length === 0) {
    return (
      <button type="button" className="home__empty" onClick={() => createAndOpenProject(navigate)}>
        <Plus size={18} />
        <strong>Start your first project</strong>
        <span>Draw shapes, extrude them, and export for your printer. Everything autosaves{user ? ' to the cloud' : ' in this browser'}.</span>
      </button>
    )
  }
  return (
    <>
      <div className="home__grid">
        {shown.map((e) => (
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
        {showNew && (
          <button type="button" className="home__card home__card--new" onClick={() => createAndOpenProject(navigate)}>
            <Plus size={20} />
            <span>New project</span>
          </button>
        )}
      </div>
      {menu && menuEntry && (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={() => open(menu.id)}
          onRename={menuEntry.local ? () => setRenamingId(menu.id) : undefined}
          onDuplicate={menuEntry.local ? () => duplicate(menu.id) : undefined}
          onUpload={user && menuEntry.local && !menuEntry.cloud ? () => upload(menu.id) : undefined}
          onDelete={() => remove(menuEntry)}
        />
      )}
    </>
  )
}

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
    >
      <div className={`home__thumb ${picture ? 'home__thumb--picture' : ''} ${!picture && !snapshot ? 'home__thumb--cloud' : ''}`}>
        {picture ? <img className="home__thumb-img" src={picture} alt="" /> : snapshot ? <Thumbnail snapshot={snapshot} /> : <Cloud size={26} />}
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
