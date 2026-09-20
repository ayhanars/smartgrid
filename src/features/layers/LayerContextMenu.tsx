import { useEffect, useRef } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Copy, Eye, EyeOff, Group, Grid2x2, Lock, Scissors, Shapes, Trash2, Ungroup, Unlock } from 'lucide-react'
import { useDocumentStore, expandToGroup, artboardSize, shapeWorldBounds } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { useUserAssets } from '../../state/userAssetsStore'
import { captureAsset } from '../../lib/assets/userAssets'
import { isGuest } from '../auth/authGate'
import './LayerContextMenu.css'

export interface ContextMenuState {
  x: number
  y: number
  layerId: string
}

interface LayerContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
}

/** Right-click menu for a layer row — every action operates on the whole
 * current selection when the row is part of it, otherwise just on that row
 * (and its group), so it behaves like the selection had been clicked first. */
export function LayerContextMenu({ menu, onClose }: LayerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const toggleVisibility = useDocumentStore((s) => s.toggleVisibility)
  const toggleLocked = useDocumentStore((s) => s.toggleLocked)
  const duplicateShapes = useDocumentStore((s) => s.duplicateShapes)
  const removeShapes = useDocumentStore((s) => s.removeShapes)
  const groupShapes = useDocumentStore((s) => s.groupShapes)
  const ungroupShapes = useDocumentStore((s) => s.ungroupShapes)
  const reorderLayer = useDocumentStore((s) => s.reorderLayer)
  const groups = useDocumentStore((s) => s.groups)
  const plates = useDocumentStore((s) => s.plates)
  const activePlateId = useDocumentStore((s) => s.activePlateId)
  const moveShapesToPlate = useDocumentStore((s) => s.moveShapesToPlate)
  const splitForBed = useDocumentStore((s) => s.splitForBed)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const addUserAsset = useUserAssets((s) => s.add)
  const setNotice = useViewStore((s) => s.setNotice)

  const layer = layers[menu.layerId]
  const targets = selection.includes(menu.layerId) ? selection : expandToGroup(layers, order, menu.layerId)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  if (!layer) return null

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const allHidden = targets.every((id) => layers[id] && !layers[id].visible)
  const allLocked = targets.every((id) => layers[id]?.locked)
  const inGroup = targets.some((id) => layers[id]?.groupId)
  const bed = artboardSize({ bedPresetId, customBedWidth, customBedHeight })
  const bounds = shapeWorldBounds(layer)
  const tooBig = !layer.isHole && (bounds.width > bed.width + 1e-6 || bounds.height > bed.height + 1e-6)

  // Named after the group when the whole selection is one group, else the
  // clicked layer.
  const saveAsAsset = () => {
    const groupId = layer.groupId
    const wholeGroup = groupId && targets.every((id) => layers[id]?.groupId === groupId)
    const name = (wholeGroup ? groups[groupId]?.name : undefined) || layer.name
    const asset = captureAsset(name, layers, order, targets)
    if (!asset) return
    addUserAsset(asset)
    setNotice(isGuest() ? `Saved "${asset.name}" to My assets (this browser only until you sign in).` : `Saved "${asset.name}" to My assets. Find it in the Assets tab of any project.`)
  }

  // keep the menu on-screen near the pointer
  const style = {
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 320),
  }

  return (
    <div ref={ref} className="layer-context-menu" style={style} role="menu">
      <button type="button" role="menuitem" onClick={run(() => setSelection(targets))}>
        Select{targets.length > 1 ? ` ${targets.length} shapes` : ''}
      </button>
      <button type="button" role="menuitem" onClick={run(() => targets.forEach((id) => toggleVisibility(id)))}>
        {allHidden ? <Eye size={13} /> : <EyeOff size={13} />}
        {allHidden ? 'Show' : 'Hide'}
      </button>
      <button type="button" role="menuitem" onClick={run(() => targets.forEach((id) => toggleLocked(id)))}>
        {allLocked ? <Unlock size={13} /> : <Lock size={13} />}
        {allLocked ? 'Unlock' : 'Lock'}
      </button>
      <button type="button" role="menuitem" onClick={run(() => duplicateShapes(targets))}>
        <Copy size={13} />
        Duplicate
        <kbd>⌥ drag</kbd>
      </button>
      <div className="layer-context-menu__divider" />
      <button type="button" role="menuitem" onClick={run(() => groupShapes(targets))}>
        <Group size={13} />
        Group
        <kbd>⌘G</kbd>
      </button>
      <button type="button" role="menuitem" disabled={!inGroup} onClick={run(() => ungroupShapes(targets))}>
        <Ungroup size={13} />
        Ungroup
        <kbd>⌘⇧G</kbd>
      </button>
      <button type="button" role="menuitem" onClick={run(saveAsAsset)}>
        <Shapes size={13} />
        Save as asset
      </button>
      {plates.length > 1 && (
        <>
          <div className="layer-context-menu__divider" />
          <div className="layer-context-menu__heading">
            <Grid2x2 size={12} />
            Move to plate
          </div>
          {plates
            .filter((p) => p.id !== activePlateId)
            .map((p) => (
              <button key={p.id} type="button" role="menuitem" onClick={run(() => moveShapesToPlate(targets, p.id))}>
                {p.name}
              </button>
            ))}
        </>
      )}
      {tooBig && (
        <button
          type="button"
          role="menuitem"
          onClick={run(() => {
            const pieces = splitForBed(menu.layerId)
            setNotice(pieces ? `Split into ${pieces.length} pieces, one per plate.` : 'Could not split: not enough free plates (5 at most).')
          })}
        >
          <Scissors size={13} />
          Split across plates
        </button>
      )}
      <div className="layer-context-menu__divider" />
      <button type="button" role="menuitem" onClick={run(() => reorderLayer(menu.layerId, 'front'))}>
        <ArrowUpToLine size={13} />
        Bring to front
      </button>
      <button type="button" role="menuitem" onClick={run(() => reorderLayer(menu.layerId, 'back'))}>
        <ArrowDownToLine size={13} />
        Send to back
      </button>
      <div className="layer-context-menu__divider" />
      <button type="button" role="menuitem" className="layer-context-menu__danger" onClick={run(() => removeShapes(targets))}>
        <Trash2 size={13} />
        Delete
        <kbd>⌫</kbd>
      </button>
    </div>
  )
}
