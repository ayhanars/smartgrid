import { useMemo } from 'react'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from '../../lib/geometry/rounding'
import { buildBeveledGeometry } from '../../lib/geometry/bevelExtrude'
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
  const geometry = useMemo(() => {
    const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
    const contour = smartPolishCorners(rounded, layer.smartPolish)
    const depth = Math.max(0.2, layer.extrusionDepth)
    const geo = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop)
    geo.scale(SCENE_SCALE, SCENE_SCALE, SCENE_SCALE)
    return geo
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
    <mesh geometry={geometry} position={position} onPointerDown={handlePointerDown}>
      <meshStandardMaterial
        color={layer.isHole ? '#ff5c5c' : layer.color}
        wireframe={wireframe}
        transparent={layer.isHole}
        opacity={layer.isHole ? 0.35 : 1}
      />
      {isSelected && <Edges color="#4d8dff" lineWidth={2} />}
    </mesh>
  )
}
