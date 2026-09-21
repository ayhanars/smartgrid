import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { type Plate, type ShapeGroup, layerPlateId, shapeWorldBounds } from '../../state/documentStore'
import { plateOrigin } from '../geometry/plateLayout'
import { planCut } from '../geometry/cutPlan'
import { cutHolesAsync, fuseAsync } from '../geometry/csgClient'
import type { PositionedGeometry } from '../geometry/holeCut'

export interface ExportMesh {
  name: string
  /** '#rrggbb' */
  color: string
  /** Vertices in mm, Z-up (slicer convention): a flat triangle list when
   * `indices` is absent, a shared vertex table otherwise. */
  positions: Float32Array
  /** Triangle vertex indices into `positions`, when the mesh is indexed. */
  indices?: Uint32Array
  /** 1-based build plate the mesh sits on; absent for single-plate exports. */
  plate?: number
}

export interface ExportProgress {
  /** Shapes finished so far, out of `total`. */
  done: number
  total: number
  /** What is being worked on right now. */
  stage: string
}

/** Lets the page paint (a progress bar, the busy cursor) between shapes. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
export async function buildExportMeshes(
  layers: Record<string, ShapeLayer>,
  order: string[],
  layout?: PlateLayout,
  onProgress?: (p: ExportProgress) => void,
  groups: Record<string, ShapeGroup> = {},
): Promise<ExportMesh[]> {
  const holeIds = order.filter((id) => layers[id]?.isHole && layers[id]?.visible)
  const solidIds = order.filter((id) => layers[id] && !layers[id].isHole && layers[id].visible)
  let done = 0
  const toWorld = (layer: ShapeLayer) => ({ worldX: layer.transform.x, worldY: layer.transform.z, worldZ: layer.transform.y })
  const multi = layout && layout.plates.length > 1 ? layout : null
  // The 2D canvas measures y from the back of the bed forward; a slicer
  // measures it from the front, with the bed spanning 0..depth. So the
  // Y-up → Z-up rotation below (which maps canvas y to −Y) is followed by
  // a shift of one bed depth, and every object lands on its plate where
  // the canvas shows it.
  const bedDepth = layout?.bedDepth ?? 0
  const plateIndex = (layer: ShapeLayer) => (multi ? Math.max(0, multi.plates.findIndex((p) => p.id === layerPlateId(layer, multi.plates))) : 0)

  const meshes: ExportMesh[] = []
  // A generated product that prints as one body (a box with its hooks):
  // its solids are unioned after their own cuts.
  const fuseParts = new Map<string, { parts: PositionedGeometry[]; layer: ShapeLayer }>()
  const place = (geo: THREE.BufferGeometry, name: string, layer: ShapeLayer) => {
    // Kept indexed when it is: the 3MF writer wants a shared vertex
    // table anyway, and welding a flat list back is the slow part.
    const placed = geo.applyMatrix4(Y_UP_TO_Z_UP).translate(0, bedDepth, 0)
    const mesh: ExportMesh = { name, color: layer.color, positions: placed.getAttribute('position').array as Float32Array }
    if (placed.index) mesh.indices = Uint32Array.from(placed.index.array)
    if (multi) {
      const idx = plateIndex(layer)
      const origin = plateOrigin(idx, multi.plates.length, multi.bedWidth, multi.bedDepth)
      placed.translate(origin.x, origin.y, 0)
      mesh.plate = idx + 1
    }
    meshes.push(mesh)
  }
  for (const id of solidIds) {
    const layer = layers[id]
    onProgress?.({ done, total: solidIds.length, stage: layer.name })
    await breathe()

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
      const world = finalGeo.clone().translate(solidWorld.worldX, solidWorld.worldY, solidWorld.worldZ)
      const fuseGroup = layer.groupId && groups[layer.groupId]?.recipe?.fuse ? layer.groupId : null
      if (fuseGroup) {
        const entry = fuseParts.get(fuseGroup) ?? { parts: [], layer }
        entry.parts.push({ geometry: world, worldX: 0, worldY: 0, worldZ: 0 })
        fuseParts.set(fuseGroup, entry)
      } else place(world, layer.name, layer)
    }
    done++
  }
  for (const [groupId, { parts, layer }] of fuseParts) {
    const name = groups[groupId]?.name ?? layer.name
    onProgress?.({ done, total: solidIds.length, stage: `Fusing ${name}` })
    await breathe()
    let fused: THREE.BufferGeometry | null = null
    try {
      fused = await fuseAsync(parts).promise
    } catch (err) {
      console.error(`Fusing "${name}" failed during export, exporting its parts separately:`, err)
    }
    if (fused) place(fused, name, layer)
    else for (const part of parts) place(part.geometry, name, layer)
  }
  onProgress?.({ done, total: solidIds.length, stage: 'Writing the file' })
  await breathe()
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
