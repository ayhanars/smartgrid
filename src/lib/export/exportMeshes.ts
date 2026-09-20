import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { type Plate, layerPlateId, shapeWorldBounds } from '../../state/documentStore'
import { plateOrigin } from '../geometry/plateLayout'
import { planCut } from '../geometry/cutPlan'
import { cutHolesAsync } from '../geometry/csgClient'

export interface ExportMesh {
  name: string
  /** '#rrggbb' */
  color: string
  /** Flat, non-indexed triangle list in mm, Z-up (slicer convention). */
  positions: Float32Array
  /** 1-based build plate the mesh sits on; absent for single-plate exports. */
  plate?: number
}

/** How the plates of a multi-plate export are laid out in slicer space. */
export interface PlateLayout {
  plates: Plate[]
  /** Bed size in mm; each plate is a copy of the same bed. */
  bedWidth: number
  bedDepth: number
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// The viewport builds Y-up (x, height, docY). Slicers want Z-up with the
// top view matching the 2D canvas, so map (x, h, d) -> (x, -d, h): a proper
// rotation (det = +1), no mirroring, so triangle winding stays outward.
const Y_UP_TO_Z_UP = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)

/** Builds the final printable meshes — every visible solid with every
 * overlapping hole already subtracted, exactly as the viewport shows them,
 * in mm at the shape's real plate position. Holes are cutters, so they
 * never appear as objects of their own. */
export async function buildExportMeshes(layers: Record<string, ShapeLayer>, order: string[], layout?: PlateLayout): Promise<ExportMesh[]> {
  const holeIds = order.filter((id) => layers[id]?.isHole && layers[id]?.visible)
  const toWorld = (layer: ShapeLayer) => ({ worldX: layer.transform.x, worldY: layer.transform.z, worldZ: layer.transform.y })
  const multi = layout && layout.plates.length > 1 ? layout : null
  const plateIndex = (layer: ShapeLayer) => (multi ? Math.max(0, multi.plates.findIndex((p) => p.id === layerPlateId(layer, multi.plates))) : 0)

  const meshes: ExportMesh[] = []
  for (const id of order) {
    const layer = layers[id]
    if (!layer || layer.isHole || !layer.visible) continue

    const solidBounds = shapeWorldBounds(layer)
    // Only cutters on the same plate can cut a solid.
    const overlapping = holeIds.filter((hid) => plateIndex(layers[hid]) === plateIndex(layer) && rectsOverlap(solidBounds, shapeWorldBounds(layers[hid])))
    const solidWorld = toWorld(layer)
    const holeLayers = overlapping.map((hid) => layers[hid])
    // Same plan as the viewport (see useCutGeometries).
    const plan = planCut(layer, holeLayers, 1, toWorld)

    for (const geo of plan.bodies) {
      let finalGeo: THREE.BufferGeometry = geo
      try {
        if (plan.needsCsg) finalGeo = await cutHolesAsync({ geometry: geo, ...solidWorld }, plan.holes()).promise
      } catch (err) {
        console.error(`Hole cut failed for "${layer.name}" during export, exporting it uncut:`, err)
      }
      const placed = (finalGeo.index ? finalGeo.toNonIndexed() : finalGeo.clone())
        .translate(solidWorld.worldX, solidWorld.worldY, solidWorld.worldZ)
        .applyMatrix4(Y_UP_TO_Z_UP)
      const mesh: ExportMesh = { name: layer.name, color: layer.color, positions: placed.getAttribute('position').array as Float32Array }
      if (multi) {
        const idx = plateIndex(layer)
        const origin = plateOrigin(idx, multi.plates.length, multi.bedWidth, multi.bedDepth)
        placed.translate(origin.x, origin.y, 0)
        mesh.plate = idx + 1
      }
      meshes.push(mesh)
    }
  }
  return meshes
}

export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
