import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { shapeWorldBounds } from '../../state/documentStore'
import { buildLayerGeometries } from '../geometry/layerGeometry'
import { cutHolesFromSolid } from '../geometry/holeCut'

export interface ExportMesh {
  name: string
  /** '#rrggbb' */
  color: string
  /** Flat, non-indexed triangle list in mm, Z-up (slicer convention). */
  positions: Float32Array
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
export function buildExportMeshes(layers: Record<string, ShapeLayer>, order: string[]): ExportMesh[] {
  const holeIds = order.filter((id) => layers[id]?.isHole && layers[id]?.visible)
  const toWorld = (layer: ShapeLayer) => ({ worldX: layer.transform.x, worldY: layer.transform.z, worldZ: layer.transform.y })

  const meshes: ExportMesh[] = []
  for (const id of order) {
    const layer = layers[id]
    if (!layer || layer.isHole || !layer.visible) continue

    const solidBounds = shapeWorldBounds(layer)
    const overlapping = holeIds.filter((hid) => rectsOverlap(solidBounds, shapeWorldBounds(layers[hid])))
    const holeGeoms = overlapping.flatMap((hid) => {
      const hole = layers[hid]
      const w = toWorld(hole)
      return buildLayerGeometries(hole, 1).map((geometry) => ({ geometry, ...w }))
    })
    const solidWorld = toWorld(layer)

    for (const geo of buildLayerGeometries(layer, 1)) {
      let finalGeo: THREE.BufferGeometry = geo
      try {
        finalGeo = cutHolesFromSolid({ geometry: geo, ...solidWorld }, holeGeoms)
      } catch (err) {
        console.error(`Hole cut failed for "${layer.name}" during export, exporting it uncut:`, err)
      }
      const placed = (finalGeo.index ? finalGeo.toNonIndexed() : finalGeo.clone())
        .translate(solidWorld.worldX, solidWorld.worldY, solidWorld.worldZ)
        .applyMatrix4(Y_UP_TO_Z_UP)
      meshes.push({ name: layer.name, color: layer.color, positions: placed.getAttribute('position').array as Float32Array })
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
