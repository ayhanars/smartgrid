import { useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { buildBeveledGeometry } from '../../lib/geometry/bevelExtrude'
import { buildSimpleRegionGeometry } from '../../lib/geometry/multiRegionExtrude'
import { SCENE_SCALE } from './sceneScale'

interface ExtrudedShapeMeshProps {
  layer: ShapeLayer
  isSelected: boolean
  wireframe: boolean
  onSelect: (id: string, additive: boolean) => void
  artboardWidth: number
  artboardHeight: number
}

export function ExtrudedShapeMesh({ layer, isSelected, wireframe, onSelect, artboardWidth, artboardHeight }: ExtrudedShapeMeshProps) {
  const geometries = useMemo((): THREE.BufferGeometry[] => {
    const depth = Math.max(0.2, layer.extrusionDepth)
    const isSimple = layer.regions.length === 1 && layer.regions[0].holes.length === 0

    if (isSimple) {
      const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
      const contour = smartPolishCorners(rounded, layer.smartPolish)
      const geo = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop)
      geo.scale(SCENE_SCALE, SCENE_SCALE, SCENE_SCALE)
      return [geo]
    }

    // Multi-region and/or real holes (a boolean-op result): bevel/corner
    // rounding aren't supported here yet, so render a plain sharp-edged
    // solid per region instead of silently misapplying them.
    return layer.regions.map((region) => buildSimpleRegionGeometry(region, depth, SCENE_SCALE))
  }, [layer.regions, layer.cornerRadius, layer.smartPolish, layer.extrusionDepth, layer.bevelBottom, layer.bevelTop])

  if (!layer.visible) return null

  const position: [number, number, number] = [
    (layer.transform.x - artboardWidth / 2) * SCENE_SCALE,
    0,
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
          {isSelected && <Edges color="#4d8dff" lineWidth={2} />}
        </mesh>
      ))}
    </group>
  )
}
