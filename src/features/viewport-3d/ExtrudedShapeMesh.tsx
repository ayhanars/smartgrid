import { useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { ShapeLayer } from '../../types/document'
import { buildLayerGeometries } from '../../lib/geometry/layerGeometry'
import { SCENE_SCALE } from './sceneScale'

// Only creases sharper than this get an outline segment. The default 15°
// also catches the ~25° cone tips where a polished corner collapses under a
// bevel (see collapseFolds in offset.ts), which showed up as stray dots
// floating at the corners; real corner edges of a box/hexagon/octagon are
// 45° or more, so they still outline.
const OUTLINE_CREASE_DEG = 35

interface ExtrudedShapeMeshProps {
  layer: ShapeLayer
  isSelected: boolean
  wireframe: boolean
  onSelect: (id: string, additive: boolean, single: boolean) => void
  artboardWidth: number
  artboardHeight: number
  /** Precomputed geometry with every overlapping hole already subtracted
   * via real CSG (see Viewport3DPane) — bypasses the normal per-shape
   * build when this shape has any holes cutting into it. */
  cutGeometries?: THREE.BufferGeometry[]
  /** Support analysis result: outlines the shape red (floating) or amber
   * (partially supported) so the problem is visible in the scene itself. */
  warning?: 'critical' | 'partial'
  /** Print-preview cut: everything above the plane is hidden and the
   * exposed cross-section is rendered double-sided so it reads as solid. */
  clippingPlanes?: THREE.Plane[]
  /** Receives the outer group (origin at the shape's center) so a viewport
   * gizmo can attach to it. */
  onGroupRef?: (group: THREE.Group | null) => void
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
  clippingPlanes,
  onGroupRef,
}: ExtrudedShapeMeshProps) {
  const geometries = useMemo(
    (): THREE.BufferGeometry[] => cutGeometries ?? buildLayerGeometries(layer, SCENE_SCALE),
    [cutGeometries, layer],
  )

  // The shape's local center — the outer group sits here so a gizmo's
  // handles (and its rotation pivot) are at the middle of the object, not
  // at the footprint's top-left origin where the geometry is built from.
  const center = useMemo(() => {
    const box = new THREE.Box3()
    for (const geo of geometries) {
      geo.computeBoundingBox()
      if (geo.boundingBox) box.union(geo.boundingBox)
    }
    return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3())
  }, [geometries])

  if (!layer.visible) return null

  const origin: [number, number, number] = [
    (layer.transform.x - artboardWidth / 2) * SCENE_SCALE,
    layer.transform.z * SCENE_SCALE,
    (layer.transform.y - artboardHeight / 2) * SCENE_SCALE,
  ]

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onSelect(layer.id, e.shiftKey, e.metaKey || e.ctrlKey)
  }

  const opacity = layer.isHole ? 0.35 : (layer.opacity ?? 100) / 100
  const preview = !!clippingPlanes?.length

  return (
    <group
      ref={onGroupRef}
      position={[origin[0] + center.x, origin[1] + center.y, origin[2] + center.z]}
      onPointerDown={handlePointerDown}
    >
      <group position={[-center.x, -center.y, -center.z]}>
        {geometries.map((geo, i) => (
          <mesh key={i} geometry={geo}>
            <meshStandardMaterial
              color={layer.isHole ? '#ff5c5c' : layer.color}
              wireframe={wireframe}
              transparent={opacity < 1}
              opacity={opacity}
              side={preview ? THREE.DoubleSide : THREE.FrontSide}
              clippingPlanes={clippingPlanes ?? null}
            />
            {warning ? (
              <Edges color={warning === 'critical' ? '#ff5c5c' : '#ffb648'} lineWidth={2} threshold={OUTLINE_CREASE_DEG} />
            ) : (
              isSelected && <Edges color="#4d8dff" lineWidth={2} threshold={OUTLINE_CREASE_DEG} />
            )}
          </mesh>
        ))}
      </group>
    </group>
  )
}
