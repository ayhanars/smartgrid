import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Circle, CircleDashed, Eye, EyeOff, Folder, Lock, Pentagon, Plus, Square, Star, Unlock } from 'lucide-react'
import { useDocumentStore } from '../../state/documentStore'
import type { ShapeKind, ShapeLayer } from '../../types/document'
import { contourBounds, regionsToSvgPath } from '../../lib/geometry/primitives'
import { LayerContextMenu, type ContextMenuState } from './LayerContextMenu'
import './LayersPanel.css'

const kindIcon: Record<ShapeKind, ReactNode> = {
  rect: <Square size={13} />,
  circle: <Circle size={13} />,
  polygon: <Pentagon size={13} />,
  star: <Star size={13} />,
  hole: <CircleDashed size={13} />,
}

/** A real scaled-to-fit render of the shape's own outline, not just a flat
 * kind icon — lets a glance at the layer list tell two stars or two pen
 * paths apart instead of showing the same generic glyph for both. */
function LayerThumbnail({ layer }: { layer: ShapeLayer }) {
  const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const bounds = contourBounds(allPoints)
  const pad = Math.max(bounds.width, bounds.height, 1) * 0.15
  const viewBox = `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`
  const path = regionsToSvgPath(layer.regions)

  return (
    <div className="layer-row__thumb">
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        <path
          d={path}
          fillRule="evenodd"
          fill={layer.isHole ? 'none' : layer.color}
          stroke={layer.isHole ? 'var(--danger)' : 'none'}
          strokeWidth={layer.isHole ? pad * 0.6 : 0}
        />
      </svg>
    </div>
  )
}

/** Where a dragged row would land: directly above or below `id` in the
 * panel, and whether that puts it inside a group. */
interface DropTarget {
  id: string
  position: 'above' | 'below'
  /** The group the target row belongs to (null: top level). */
  groupId: string | null
}

const DRAG_THRESHOLD_PX = 4

export function LayersPanel() {
  const layers = useDocumentStore((s) => s.layers)
  const groups = useDocumentStore((s) => s.groups)
  const order = useDocumentStore((s) => s.order)
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const toggleVisibility = useDocumentStore((s) => s.toggleVisibility)
  const toggleLocked = useDocumentStore((s) => s.toggleLocked)
  const setVisible = useDocumentStore((s) => s.setVisible)
  const setLocked = useDocumentStore((s) => s.setLocked)
  const renameLayer = useDocumentStore((s) => s.renameLayer)
  const renameGroup = useDocumentStore((s) => s.renameGroup)
  // Double-click a name to edit it in place (Enter/blur commits, Esc cancels).
  const [editing, setEditing] = useState<{ kind: 'layer' | 'group'; id: string; draft: string } | null>(null)
  const commitRename = () => {
    if (!editing) return
    if (editing.kind === 'layer') renameLayer(editing.id, editing.draft)
    else renameGroup(editing.id, editing.draft)
    setEditing(null)
  }
  const renameInput = (
    <input
      className="layer-row__rename"
      autoFocus
      value={editing?.draft ?? ''}
      aria-label="Rename"
      onChange={(e) => setEditing((ed) => (ed ? { ...ed, draft: e.target.value } : ed))}
      onFocus={(e) => e.target.select()}
      onBlur={commitRename}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commitRename()
        if (e.key === 'Escape') setEditing(null)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  )
  const moveLayersTo = useDocumentStore((s) => s.moveLayersTo)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // Shift-click selects everything between the last plain click and this one.
  const anchorRef = useRef<string | null>(null)

  // Drag to reorder: a press on a row arms a drag; moving a few pixels
  // starts it; the row under the pointer (upper/lower half) is the target.
  const [drag, setDrag] = useState<{ ids: string[]; over: DropTarget | null } | null>(null)
  const dragArm = useRef<{ ids: string[]; x: number; y: number; active: boolean; over: DropTarget | null } | null>(null)
  const justDragged = useRef(false)

  // Layers panel lists back-to-front draw order top-to-bottom in reverse,
  // so the most recently drawn (frontmost) shape appears at the top.
  const rows = [...order].reverse()
  // Every layer row in the order it is listed (groups flattened), for
  // range selection.
  const visual: string[] = []

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const arm = dragArm.current
      if (!arm) return
      if (!arm.active) {
        if (Math.hypot(e.clientX - arm.x, e.clientY - arm.y) < DRAG_THRESHOLD_PX) return
        arm.active = true
        setDrag({ ids: arm.ids, over: null })
      }
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-layer-row]')
      const id = el?.dataset.layerRow
      let over: DropTarget | null = null
      if (el && id && !arm.ids.includes(id)) {
        const rect = el.getBoundingClientRect()
        over = { id, position: e.clientY < rect.top + rect.height / 2 ? 'above' : 'below', groupId: el.dataset.layerGroup || null }
      }
      arm.over = over
      setDrag({ ids: arm.ids, over })
    }
    const onUp = () => {
      const arm = dragArm.current
      dragArm.current = null
      if (!arm?.active) return
      justDragged.current = true
      setDrag(null)
      if (arm.over) {
        const { id, position, groupId } = arm.over
        // A whole group being dragged keeps its own grouping; a single
        // layer adopts the target's group (or leaves its old one).
        const wholeGroup = arm.ids.length > 1 && arm.ids.every((mid) => layers[mid]?.groupId && layers[mid]?.groupId === layers[arm.ids[0]]?.groupId)
        moveLayersTo(arm.ids, { id, position }, wholeGroup ? undefined : groupId)
      }
      window.setTimeout(() => (justDragged.current = false), 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [layers, moveLayersTo])

  const armDrag = (ids: string[], e: React.PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    dragArm.current = { ids, x: e.clientX, y: e.clientY, active: false, over: null }
  }

  const clickLayer = (id: string, e: React.MouseEvent) => {
    if (justDragged.current) return
    const isSelected = selection.includes(id)
    if (e.shiftKey && anchorRef.current && visual.includes(anchorRef.current)) {
      const a = visual.indexOf(anchorRef.current)
      const b = visual.indexOf(id)
      setSelection(visual.slice(Math.min(a, b), Math.max(a, b) + 1))
      return
    }
    if (e.metaKey || e.ctrlKey) {
      setSelection(isSelected ? selection.filter((sid) => sid !== id) : [...selection, id])
      anchorRef.current = id
      return
    }
    setSelection([id])
    anchorRef.current = id
  }

  const dropClass = (id: string) => {
    if (!drag?.over || drag.over.id !== id) return ''
    return drag.over.position === 'above' ? 'layer-row--drop-above' : 'layer-row--drop-below'
  }

  // A group is listed once, where its frontmost member sits, with every
  // member nested under it.
  const renderedGroups = new Set<string>()
  const tree: ReactNode[] = []

  const renderLayerRow = (id: string, nested: boolean) => {
    const layer = layers[id]
    if (!layer) return null
    visual.push(id)
    const isSelected = selection.includes(id)
    const dragging = drag?.ids.includes(id)
    return (
      <div
        key={id}
        data-layer-row={id}
        data-layer-group={nested ? layer.groupId : ''}
        className={`layer-row ${isSelected ? 'layer-row--selected' : ''} ${layer.visible ? '' : 'layer-row--hidden'} ${nested ? 'layer-row--nested' : ''} ${dragging ? 'layer-row--dragging' : ''} ${dropClass(id)}`}
        onPointerDown={(e) => armDrag(isSelected && selection.length > 1 ? selection : [id], e)}
        onClick={(e) => clickLayer(id, e)}
        onDoubleClick={() => setEditing({ kind: 'layer', id, draft: layer.name })}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, layerId: id })
        }}
      >
        <span className={`layer-row__icon ${layer.isHole ? 'layer-row__icon--hole' : ''}`}>{kindIcon[layer.kind]}</span>
        <LayerThumbnail layer={layer} />
        {editing?.kind === 'layer' && editing.id === id ? renameInput : <span className="layer-row__name">{layer.name}</span>}
        <div className="layer-row__actions">
          <button
            type="button"
            className="layer-row__toggle"
            aria-label={layer.locked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation()
              toggleLocked(id)
            }}
          >
            {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            type="button"
            className="layer-row__toggle"
            aria-label={layer.visible ? 'Hide' : 'Show'}
            onClick={(e) => {
              e.stopPropagation()
              toggleVisibility(id)
            }}
          >
            {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
      </div>
    )
  }

  for (const id of rows) {
    const layer = layers[id]
    if (!layer) continue
    const groupId = layer.groupId
    if (!groupId || !groups[groupId]) {
      tree.push(renderLayerRow(id, false))
      continue
    }
    if (renderedGroups.has(groupId)) continue
    renderedGroups.add(groupId)
    const members = rows.filter((mid) => layers[mid]?.groupId === groupId)
    const allSelected = members.every((mid) => selection.includes(mid))
    const anyHidden = members.some((mid) => !layers[mid]?.visible)
    const anyLocked = members.some((mid) => layers[mid]?.locked)
    const collapsed = !!collapsedGroups[groupId]
    // Dropping on the group header: above it = above the whole group,
    // below it = first inside the group.
    const headerDrop = drag?.over?.id === members[0] && drag.over.groupId === null && !drag.ids.includes(members[0])
    tree.push(
      <div
        key={`group-${groupId}`}
        data-layer-row={members[0]}
        data-layer-group=""
        className={`layer-group ${allSelected ? 'layer-group--selected' : ''} ${headerDrop ? (drag?.over?.position === 'above' ? 'layer-row--drop-above' : 'layer-row--drop-below') : ''}`}
        onPointerDown={(e) => armDrag(members, e)}
        onClick={() => {
          if (justDragged.current) return
          setSelection(members)
          anchorRef.current = members[0]
        }}
        onDoubleClick={() => setEditing({ kind: 'group', id: groupId, draft: groups[groupId].name })}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, layerId: members[0] })
        }}
      >
        <button
          type="button"
          className="layer-group__chevron"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          onClick={(e) => {
            e.stopPropagation()
            setCollapsedGroups((c) => ({ ...c, [groupId]: !collapsed }))
          }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <Folder size={13} />
        {editing?.kind === 'group' && editing.id === groupId ? renameInput : <span className="layer-group__name">{groups[groupId].name}</span>}
        <span className="layer-group__count">{members.length}</span>
        <div className={`layer-row__actions ${anyHidden || anyLocked ? 'layer-row__actions--pinned' : ''}`}>
          <button
            type="button"
            className="layer-row__toggle"
            aria-label={anyLocked ? 'Unlock group' : 'Lock group'}
            onClick={(e) => {
              e.stopPropagation()
              setLocked(members, !anyLocked)
            }}
          >
            {anyLocked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            type="button"
            className="layer-row__toggle"
            aria-label={anyHidden ? 'Show group' : 'Hide group'}
            onClick={(e) => {
              e.stopPropagation()
              setVisible(members, anyHidden)
            }}
          >
            {anyHidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>,
    )
    if (!collapsed) for (const mid of members) tree.push(renderLayerRow(mid, true))
  }

  return (
    <div className={`layers-panel ${drag ? 'layers-panel--dragging' : ''}`}>
      <div className="layers-panel__header">
        <span className="layers-panel__title">Layers</span>
        <span className="layers-panel__count">{order.length}</span>
        <div className="layers-panel__header-actions">
          <button type="button" className="layers-panel__icon-btn" aria-label="Add layer" disabled>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="layers-panel__tree">
        {rows.length === 0 && <p className="layers-panel__empty">Draw a shape to get started.</p>}
        {tree}
      </div>

      {contextMenu && <LayerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  )
}
