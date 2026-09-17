import type { Bounds, ShapeLayer } from '../../types/document'
import { regionsToSvgPath } from '../../lib/geometry/primitives'

interface ShapeElementProps {
  layer: ShapeLayer
  isSelected: boolean
  previewOffset?: { dx: number; dy: number }
  /** While a resize drag is live, scales the rendered shape from its bounds
   * at drag-start to the in-progress preview bounds — purely visual (an SVG
   * transform, not a store write) so dragging a handle shows the shape
   * actually changing size in real time instead of only moving the
   * selection outline until pointer-up commits it. */
  previewResize?: { startBounds: Bounds; bounds: Bounds }
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void
}

export function ShapeElement({ layer, isSelected, previewOffset, previewResize, onPointerDown }: ShapeElementProps) {
  if (!layer.visible) return null

  const path = regionsToSvgPath(layer.regions)

  let transform: string
  if (previewResize) {
    const { startBounds, bounds } = previewResize
    const scaleX = startBounds.width > 0 ? bounds.width / startBounds.width : 1
    const scaleY = startBounds.height > 0 ? bounds.height / startBounds.height : 1
    const tx = bounds.x + (layer.transform.x - startBounds.x) * scaleX
    const ty = bounds.y + (layer.transform.y - startBounds.y) * scaleY
    transform = `translate(${tx} ${ty}) scale(${scaleX} ${scaleY})`
  } else {
    const dx = previewOffset?.dx ?? 0
    const dy = previewOffset?.dy ?? 0
    transform = `translate(${layer.transform.x + dx} ${layer.transform.y + dy})`
  }

  return (
    <g
      transform={transform}
      data-shape-id={layer.id}
      onPointerDown={onPointerDown}
      style={{ cursor: layer.locked ? 'default' : 'move' }}
    >
      <path
        d={path}
        fillRule="evenodd"
        fill={layer.isHole ? 'rgba(255, 92, 92, 0.22)' : layer.color}
        stroke={layer.isHole ? '#ff5c5c' : isSelected ? '#4d8dff' : 'transparent'}
        strokeDasharray={layer.isHole ? '4 3' : undefined}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
}
