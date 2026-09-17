import { useMemo } from 'react'
import type * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ShapeLayer } from '../../types/document'
import { buildLayerGeometries } from '../../lib/geometry/layerGeometry'
import { SCENE_SCALE } from './sceneScale'

interface ExtrudedShapeMeshProps {
  layer: ShapeLayer
  isSelected: boolean
  wireframe: boolean
  onSelect: (id: string, additive: boolean) => void
  artboardWidth: number
  artboardHeight: number
  /** Precomputed geometry with every overlapping hole already subtracted
   * via real CSG (see Viewport3DPane) — bypasses the normal per-shape
   * build when this shape has any holes cutting into it. */
  cutGeometries?: THREE.BufferGeometry[]
  /** Support analysis result: outlines the shape red (floating) or amber
   * (partially supported) so the problem is visible in the scene itself. */
  warning?: 'critical' | 'partial'
}

export function ExtrudedShapeMesh({
  layer,
  isSelected,
  wireframe,
  onSelect,
  artboardWidth,
  artboardHeight,
  cutGeometries,
  warning,
}: ExtrudedShapeMeshProps) {
  const geometries = useMemo(
    (): THREE.BufferGeometry[] => cutGeometries ?? buildLayerGeometries(layer, SCENE_SCALE),
    [cutGeometries, layer],
  )

  if (!layer.visible) return null

  const position: [number, number, number] = [
    (layer.transform.x - artboardWidth / 2) * SCENE_SCALE,
    layer.transform.z * SCENE_SCALE,
    (layer.transform.y - artboardHeight / 2) * SCENE_SCALE,
  ]

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onSelect(layer.id, e.shiftKey)
  }

  return (
    <group position={position} onPointerDown={handlePointerDown}>
      {geometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial
            color={layer.isHole ? '#ff5c5c' : layer.color}
            wireframe={wireframe}
            transparent={layer.isHole}
            opacity={layer.isHole ? 0.35 : 1}
          />
          {warning ? (
            <Edges color={warning === 'critical' ? '#ff5c5c' : '#ffb648'} lineWidth={2} />
          ) : (
            isSelected && <Edges color="#4d8dff" lineWidth={2} />
          )}
        </mesh>
      ))}
    </group>
  )
}
