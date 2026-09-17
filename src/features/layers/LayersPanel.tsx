import type { ReactNode } from 'react'
import { Circle, CircleDashed, Eye, EyeOff, Lock, Pentagon, Plus, Square, Star, Unlock } from 'lucide-react'
import { useDocumentStore } from '../../state/documentStore'
import type { ShapeKind, ShapeLayer } from '../../types/document'
import { contourBounds, regionsToSvgPath } from '../../lib/geometry/primitives'
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

export function LayersPanel() {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const toggleVisibility = useDocumentStore((s) => s.toggleVisibility)
  const toggleLocked = useDocumentStore((s) => s.toggleLocked)

  // Layers panel lists back-to-front draw order top-to-bottom in reverse,
  // so the most recently drawn (frontmost) shape appears at the top.
  const rows = [...order].reverse()

  return (
    <div className="layers-panel">
      <div className="layers-panel__header">
        <span className="layers-panel__title">Layers</span>
        <span className="layers-panel__count">{order.length}</span>
        <div className="layers-panel__header-actions">
          <button type="button" className="layers-panel__icon-btn" aria-label="Add layer" disabled>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="layers-panel__blend-row">
        <select className="layers-panel__select" defaultValue="normal" disabled>
          <option value="normal">Normal</option>
        </select>
        <div className="layers-panel__opacity">
          <span>Opac</span>
          <input type="text" defaultValue="100" disabled />
          <span>%</span>
        </div>
      </div>

      <div className="layers-panel__tree">
        {rows.length === 0 && <p className="layers-panel__empty">Draw a shape to get started.</p>}
        {rows.map((id) => {
          const layer = layers[id]
          if (!layer) return null
          const isSelected = selection.includes(id)
          return (
            <div
              key={id}
              className={`layer-row ${isSelected ? 'layer-row--selected' : ''} ${layer.visible ? '' : 'layer-row--hidden'}`}
              onClick={(e) => {
                if (e.shiftKey) {
                  setSelection(isSelected ? selection.filter((sid) => sid !== id) : [...selection, id])
                } else {
                  setSelection([id])
                }
              }}
            >
              <span className={`layer-row__icon ${layer.isHole ? 'layer-row__icon--hole' : ''}`}>{kindIcon[layer.kind]}</span>
              <LayerThumbnail layer={layer} />
              <span className="layer-row__name">{layer.name}</span>
              <div className="layer-row__actions">
                <button
                  type="button"
                  className="layer-row__toggle"
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
        })}
      </div>
    </div>
  )
}
