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
  /** Per triangle, 1 where the slicer should put its layer seam (a seam
   * enforcer in the 3MF), in the mesh's triangle order. */
  seam?: Uint8Array
}

/** Marks the outward-facing wall triangles on one back corner of the
 * body (slicer coordinates: +y is the back), a strip `margin` mm wide,
 * as seam enforcers. */
/** Width of the seam strip on each face of the corner, mm: narrow, so
 * the seam cannot wander across the face inside it. */
const SEAM_STRIP = 2.6

function paintSeam(positions: Float32Array, indices: Uint32Array | undefined, hint: 'back-left' | 'back-right', margin = SEAM_STRIP): Uint8Array {
  const count = indices ? indices.length / 3 : positions.length / 9
  const out = new Uint8Array(count)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i])
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1])
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2])
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const v = (t: number, k: number, c: number) => positions[(indices ? indices[t * 3 + k] : t * 3 + k) * 3 + c]
  for (let t = 0; t < count; t++) {
    const ax = v(t, 0, 0), ay = v(t, 0, 1), az = v(t, 0, 2)
    const bx = v(t, 1, 0), by = v(t, 1, 1), bz = v(t, 1, 2)
    const qx = v(t, 2, 0), qy = v(t, 2, 1), qz = v(t, 2, 2)
    const mx = (ax + bx + qx) / 3, my = (ay + by + qy) / 3, mz = (az + bz + qz) / 3
    const inCorner = my > maxY - margin && (hint === 'back-left' ? mx < minX + margin : mx > maxX - margin)
    if (!inCorner) continue
    // Face normal from the winding; walls only, facing out of the body.
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const wx = qx - ax, wy = qy - ay, wz = qz - az
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz) || 1
    if (Math.abs(nz / len) > 0.6) continue
    if (nx * (mx - cx) + ny * (my - cy) <= 0) continue
    if (mz < minZ + 0.3 || mz > maxZ - 0.3) continue
    out[t] = 1
  }
  return out
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
    // Every body gets its layer seam steered to its back-left vertical
    // edge (a corner when it has one, the rearmost point otherwise).
    mesh.seam = paintSeam(mesh.positions, mesh.indices, layer.seamHint ?? 'back-left')
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
    // Walls are split into narrow columns so the seam strip on the
    // back-left edge has triangles of its own to paint.
    const plan = planCut(layer, holeLayers, 1, toWorld, { outerStep: SEAM_STRIP })

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
