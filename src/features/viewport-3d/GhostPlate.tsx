import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import type { ShapeLayer } from '../../types/document'
import type { Plate } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { SCENE_SCALE } from './sceneScale'
import { PrinterPlate } from './PrinterPlate'
import { ExtrudedShapeMesh } from './ExtrudedShapeMesh'
import { activeHoleIds, useCutGeometries } from './useCutGeometries'

/** Gap between plates when they are shown side by side, in scene units. */
const PLATE_GAP_MM = 40

/** X offset of a plate `steps` plates to the right of the active one. */
export function plateOffset(steps: number, bedWidth: number): number {
  return steps * (bedWidth + PLATE_GAP_MM * SCENE_SCALE)
}

/**
 * Another plate drawn beside the active one: its own bed, its shapes
 * with their real cuts, no gizmo or selection. Clicking anything on it
 * makes it the active plate.
 */
export function GhostPlate({
  plate,
  offset,
  layers,
  order,
  artboardWidth,
  artboardHeight,
  bedWidth,
  bedDepth,
  onActivate,
}: {
  plate: Plate
  offset: number
  layers: Record<string, ShapeLayer>
  order: string[]
  artboardWidth: number
  artboardHeight: number
  bedWidth: number
  bedDepth: number
  onActivate: () => void
}) {
  const tileVersion = useViewStore((s) => s.tileVersion)
  const { cutGeometriesById, uncutGeometriesById } = useCutGeometries(layers, order, artboardWidth, artboardHeight, tileVersion)
  const active = useMemo(() => activeHoleIds(layers, order), [layers, order])
  return (
    <group position={[offset, 0, 0]} onPointerDown={(e) => { e.stopPropagation(); onActivate() }}>
      <PrinterPlate width={bedWidth} depth={bedDepth} widthMM={artboardWidth} depthMM={artboardHeight} />
      <Html position={[0, 0.002, bedDepth / 2 + 0.1]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <span className="ghost-plate__label">{plate.name}</span>
      </Html>
      {order.map((id) => {
        const layer = layers[id]
        if (!layer || !layer.visible || (layer.isHole && active.has(id))) return null
        return (
          <ExtrudedShapeMesh
            key={id}
            layer={layer}
            isSelected={false}
            wireframe={false}
            onSelect={() => onActivate()}
            artboardWidth={artboardWidth}
            artboardHeight={artboardHeight}
            cutGeometries={cutGeometriesById[id]}
            outlineGeometries={uncutGeometriesById[id]}
          />
        )
      })}
    </group>
  )
}
