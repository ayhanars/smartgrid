import type { ShapeLayer } from '../../types/document'
import { regionsToSvgPath } from '../../lib/geometry/primitives'

interface ShapeElementProps {
  layer: ShapeLayer
  isSelected: boolean
  previewOffset?: { dx: number; dy: number }
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void
}

export function ShapeElement({ layer, isSelected, previewOffset, onPointerDown }: ShapeElementProps) {
  if (!layer.visible) return null

  const dx = previewOffset?.dx ?? 0
  const dy = previewOffset?.dy ?? 0
  const path = regionsToSvgPath(layer.regions)

  return (
    <g
      transform={`translate(${layer.transform.x + dx} ${layer.transform.y + dy})`}
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
