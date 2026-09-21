import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { type Plate, type ShapeGroup, layerPlateId, shapeWorldBounds } from '../../state/documentStore'
import { plateOrigin } from '../geometry/plateLayout'
import { planCut } from '../geometry/cutPlan'
import { cutHolesAsync } from '../geometry/csgClient'

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
  /** A compound object: these meshes are its parts, overlapping where
   * they join. Slicers union the parts of one object layer by layer,
   * which is far more robust than a mesh boolean; `positions` is then
   * empty. */
  components?: ExportMesh[]
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
  // its solids leave as the parts of one compound object, each cut on
  // its own, overlapping where they join. (A mesh boolean of the parts
  // left cracks along the seams that slicers "repaired" by filling.)
  const fuseParts = new Map<string, { parts: ExportMesh[]; layer: ShapeLayer; groupId: string }>()
  const place = (geo: THREE.BufferGeometry, name: string, layer: ShapeLayer): ExportMesh => {
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
    return mesh
  }
  for (const id of solidIds) {
    const layer = layers[id]
    onProgress?.({ done, total: solidIds.length, stage: layer.name })
    await breathe()

    const solidBounds = shapeWorldBounds(layer)
    // Only cutters on the same plate can cut a solid.
    const overlapping = holeIds.filter((hid) => plateIndex(layers[hid]) === plateIndex(layer) && (!layers[hid].shellOf || layers[hid].shellOf.solidId === id) && rectsOverlap(solidBounds, shapeWorldBounds(layers[hid])))
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
      const mesh = place(world, layer.name, layer)
      // A fused group split across plates is one body per plate.
      const fuseGroup = layer.groupId && groups[layer.groupId]?.recipe?.fuse ? `${layer.groupId}:${mesh.plate ?? 1}` : null
      if (fuseGroup) {
        const entry = fuseParts.get(fuseGroup) ?? { parts: [], layer, groupId: layer.groupId! }
        entry.parts.push(mesh)
        fuseParts.set(fuseGroup, entry)
      } else meshes.push(mesh)
    }
    done++
  }
  const bodiesOf = new Map<string, number>()
  for (const { groupId } of fuseParts.values()) bodiesOf.set(groupId, (bodiesOf.get(groupId) ?? 0) + 1)
  const numbered = new Map<string, number>()
  for (const { parts, layer, groupId } of fuseParts.values()) {
    const base = groups[groupId]?.name ?? layer.name
    const count = bodiesOf.get(groupId) ?? 1
    const n = (numbered.get(groupId) ?? 0) + 1
    numbered.set(groupId, n)
    meshes.push({ name: count > 1 ? `${base} ${n}/${count}` : base, color: layer.color, positions: new Float32Array(0), plate: parts[0]?.plate, components: parts })
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
