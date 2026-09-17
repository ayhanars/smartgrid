import { useMemo } from 'react'
import * as THREE from 'three'
import type { PrintSettings } from '../../types/document'
import { EXTRUSION_WIDTH_MM, getInfillTexture } from '../../lib/print/infillTexture'
import { SCENE_SCALE } from './sceneScale'

export interface PreviewCapItem {
  id: string
  geometries: THREE.BufferGeometry[]
  /** Scene position of the shape's local origin. */
  origin: [number, number, number]
  color: string
  /** Real print-frame Z range of the built shape, mm. */
  bottomZ: number
  topZ: number
  /** Cut by holes — its cross-section has islands, so the wall band
   * (which is approximated by scaling) is skipped for it. */
  hasHoles: boolean
}

interface PreviewCapsProps {
  items: PreviewCapItem[]
  /** Cut height, mm. */
  height: number
  settings: PrintSettings
  clippingPlanes: THREE.Plane[]
  /** Plate size in scene units — the cap planes cover it with margin. */
  bedWidth: number
  bedDepth: number
}

/** How far the infill cap floats above the wall cap so the depth test
 * reliably lets it through — 0.15 mm, invisible at any zoom. */
const CAP_EPSILON = 0.15 * SCENE_SCALE

/**
 * Slicer-style cross-sections for the print preview. Each shape gets a
 * stencil pass (back faces +1, front faces −1, both clipped at the cut
 * height, so only the inside of the solid ends up non-zero) and a cap
 * plane drawn where the stencil is set — the classic clipping-stencil
 * technique. What the cap shows depends on where the cut is: within the
 * bottom/top shell layers it is solid; otherwise a solid wall band of
 * `wallLoops` lines around an infill pattern at the chosen density (the
 * band is the region between the full section and a copy shrunk by the
 * wall width about the shape's center).
 */
export function PreviewCaps({ items, height, settings, clippingPlanes, bedWidth, bedDepth }: PreviewCapsProps) {
  const infill = useMemo(() => getInfillTexture(settings.infillPattern, settings.infillDensity), [settings.infillPattern, settings.infillDensity])
  const planeW = bedWidth * 2
  const planeD = bedDepth * 2
  const infillMap = useMemo(() => {
    const map = infill.texture.clone()
    map.repeat.set(planeW / SCENE_SCALE / infill.periodMM[0], planeD / SCENE_SCALE / infill.periodMM[1])
    map.needsUpdate = true
    return map
  }, [infill, planeW, planeD])

  const y = height * SCENE_SCALE
  const lh = settings.layerHeight
  const wallMM = settings.wallLoops * EXTRUSION_WIDTH_MM

  return (
    <>
      {items.map((item, index) => {
        // At (or beyond) the shape's own top the mesh's real top face is the
        // cross-section — a cap there would only z-fight with it. Below its
        // bottom nothing of it is printed yet.
        if (height >= item.topZ - 1e-6 || height <= item.bottomZ + 1e-6) return null
        const inBottomShell = height <= item.bottomZ + settings.bottomLayers * lh + 1e-6
        const inTopShell = height >= item.topZ - settings.topLayers * lh - 1e-6
        const solid = inBottomShell || inTopShell || settings.infillDensity >= 100
        const showWalls = !solid && !item.hasHoles
        const base = 10 + index * 4

        // Shrink factor for the wall band, per axis, from the shape's
        // real footprint size.
        const box = new THREE.Box3()
        for (const geo of item.geometries) {
          geo.computeBoundingBox()
          if (geo.boundingBox) box.union(geo.boundingBox)
        }
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const widthMM = size.x / SCENE_SCALE
        const depthMM = size.z / SCENE_SCALE
        const sx = widthMM > 0 ? Math.max(0.2, 1 - (2 * wallMM) / widthMM) : 1
        const sz = depthMM > 0 ? Math.max(0.2, 1 - (2 * wallMM) / depthMM) : 1
        const pivot: [number, number, number] = [item.origin[0] + center.x, item.origin[1] + center.y, item.origin[2] + center.z]

        return (
          <group key={item.id}>
            <StencilVolume geometries={item.geometries} pivot={pivot} center={center} renderOrder={base} clippingPlanes={clippingPlanes} />
            {/* Keyed on textured-or-not: three.js compiles a material's
                shader once, so toggling `map` on a live material would
                leave the texture silently ignored. */}
            <CapPlane
              key={solid || showWalls ? 'solid' : 'infill'}
              y={y}
              width={planeW}
              depth={planeD}
              color={item.color}
              map={solid || showWalls ? null : infillMap}
              renderOrder={base + 1}
            />
            {showWalls && (
              <>
                <StencilVolume
                  geometries={item.geometries}
                  pivot={pivot}
                  center={center}
                  scale={[sx, 1, sz]}
                  renderOrder={base + 2}
                  clippingPlanes={clippingPlanes}
                />
                <CapPlane y={y + CAP_EPSILON} width={planeW} depth={planeD} color={item.color} map={infillMap} renderOrder={base + 3} />
              </>
            )}
          </group>
        )
      })}
    </>
  )
}

function StencilVolume({
  geometries,
  pivot,
  center,
  scale,
  renderOrder,
  clippingPlanes,
}: {
  geometries: THREE.BufferGeometry[]
  pivot: [number, number, number]
  center: THREE.Vector3
  scale?: [number, number, number]
  renderOrder: number
  clippingPlanes: THREE.Plane[]
}) {
  const stencil = (side: THREE.Side, op: THREE.StencilOp) => (
    <meshBasicMaterial
      side={side}
      depthWrite={false}
      colorWrite={false}
      clippingPlanes={clippingPlanes}
      stencilWrite
      stencilFunc={THREE.AlwaysStencilFunc}
      stencilFail={op}
      stencilZFail={op}
      stencilZPass={op}
    />
  )
  return (
    <group position={pivot} scale={scale ?? [1, 1, 1]}>
      <group position={[-center.x, -center.y, -center.z]}>
        {geometries.map((geo, i) => (
          <group key={i}>
            <mesh geometry={geo} renderOrder={renderOrder}>
              {stencil(THREE.BackSide, THREE.IncrementWrapStencilOp)}
            </mesh>
            <mesh geometry={geo} renderOrder={renderOrder}>
              {stencil(THREE.FrontSide, THREE.DecrementWrapStencilOp)}
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

function CapPlane({
  y,
  width,
  depth,
  color,
  map,
  renderOrder,
}: {
  y: number
  width: number
  depth: number
  color: string
  map: THREE.Texture | null
  renderOrder: number
}) {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={y} renderOrder={renderOrder}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial
        color={color}
        map={map}
        stencilWrite
        stencilRef={0}
        stencilFunc={THREE.NotEqualStencilFunc}
        stencilFail={THREE.ReplaceStencilOp}
        stencilZFail={THREE.ReplaceStencilOp}
        stencilZPass={THREE.ReplaceStencilOp}
      />
    </mesh>
  )
}
