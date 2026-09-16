import { useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners } from '../../lib/geometry/rounding'
import { ARTBOARD_WIDTH, ARTBOARD_HEIGHT } from '../../lib/geometry/constants'
import { SCENE_SCALE } from './sceneScale'

interface ExtrudedShapeMeshProps {
  layer: ShapeLayer
  isSelected: boolean
  wireframe: boolean
  onSelect: (id: string, additive: boolean) => void
}

export function ExtrudedShapeMesh({ layer, isSelected, wireframe, onSelect }: ExtrudedShapeMeshProps) {
  const geometry = useMemo(() => {
    const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
    // Flip local y so the shape's screen-down 2D convention maps onto
    // world +Z ("forward") after the rotateX below, instead of mirroring it.
    const shapePoints = rounded.map((p) => new THREE.Vector2(p.x * SCENE_SCALE, -p.y * SCENE_SCALE))
    const shape = new THREE.Shape(shapePoints)
    const depth = Math.max(0.2, layer.extrusionDepth) * SCENE_SCALE
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
    // ExtrudeGeometry extrudes along +Z in the shape's own plane; rotating
    // -90 deg about X turns that into "up" (+Y) so the shape lies flat on
    // the bed and grows upward, like a real print.
    geo.rotateX(-Math.PI / 2)
    return geo
  }, [layer.regions, layer.cornerRadius, layer.extrusionDepth])

  if (!layer.visible) return null

  const position: [number, number, number] = [
    (layer.transform.x - ARTBOARD_WIDTH / 2) * SCENE_SCALE,
    0,
    (layer.transform.y - ARTBOARD_HEIGHT / 2) * SCENE_SCALE,
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
