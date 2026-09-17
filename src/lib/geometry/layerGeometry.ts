import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from './rounding'
import { buildBeveledGeometry } from './bevelExtrude'
import { buildSimpleRegionGeometry } from './multiRegionExtrude'

// Print frame (X/Y along the plate, Z up) -> three.js scene frame (Y up,
// doc Y along +Z). A proper rotation, so orientation math done in the
// print frame (where the stored Euler angles live) transfers exactly.
const PRINT_TO_THREE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1),
)
const THREE_TO_PRINT = PRINT_TO_THREE.clone().invert()

const DEG = Math.PI / 180

/** The shape's orientation as a quaternion in the PRINT frame, from its
 * stored Euler angles in the one fixed XYZ order used everywhere. */
export function layerPrintQuaternion(layer: ShapeLayer): THREE.Quaternion {
  const t = layer.transform
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotationX * DEG, t.rotationY * DEG, t.rotation * DEG, 'XYZ'))
}

/** Re-expresses a rotation measured in the three.js scene frame (e.g. what
 * a viewport gizmo reports) in the print frame the stored angles live in. */
export function sceneRotationToPrint(q: THREE.Quaternion): THREE.Quaternion {
  return THREE_TO_PRINT.clone().multiply(q).multiply(PRINT_TO_THREE)
}

/** Back from a print-frame quaternion to the stored Euler angles (degrees,
 * XYZ order). */
export function printQuaternionToEuler(q: THREE.Quaternion): { x: number; y: number; z: number } {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return { x: e.x / DEG, y: e.y / DEG, z: e.z / DEG }
}

/** Bakes the layer's orientation into scene-frame geometry: rotate about
 * the footprint center (keeping the footprint centered where it was), then
 * re-anchor so the object's lowest point is at Y=0 — `transform.z` stays
 * "the height of this object's own bottom" no matter how it's tilted, so a
 * tilt can never sink it under the plate. */
function bakeRotation(geometry: THREE.BufferGeometry, layer: ShapeLayer): THREE.BufferGeometry {
  const { rotationX, rotationY, rotation } = layer.transform
  if (!rotationX && !rotationY && !rotation) return geometry
  geometry.computeBoundingBox()
  const pivot = geometry.boundingBox!.getCenter(new THREE.Vector3())
  const q = PRINT_TO_THREE.clone().multiply(layerPrintQuaternion(layer)).multiply(THREE_TO_PRINT)
  geometry.translate(-pivot.x, -pivot.y, -pivot.z)
  geometry.applyQuaternion(q)
  geometry.computeBoundingBox()
  geometry.translate(pivot.x, -geometry.boundingBox!.min.y, pivot.z)
  return geometry
}

/** Builds the same extruded (and, for a single-region shape, beveled)
 * geometry used for normal rendering — shared with the CSG hole-cut path
 * and the exporter so a hole/solid brush is built exactly the same way a
 * plain mesh would be, orientation included. */
export function buildLayerGeometries(layer: ShapeLayer, scale: number): THREE.BufferGeometry[] {
  const depth = Math.max(0.2, layer.extrusionDepth)
  const isSimple = layer.regions.length === 1 && layer.regions[0].holes.length === 0

  let geometries: THREE.BufferGeometry[]
  if (isSimple) {
    const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
    const contour = smartPolishCorners(rounded, layer.smartPolish)
    const geo = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop)
    geo.scale(scale, scale, scale)
    geometries = [geo]
  } else {
    geometries = layer.regions.map((region) => buildSimpleRegionGeometry(region, depth, scale))
  }
  return geometries.map((geo) => bakeRotation(geo, layer))
}

/** Real geometric Z range (mm, print frame) of the built shape — derived
 * from the actual geometry, not assumed from z + extrusionDepth, so a
 * tilted or beveled object can't drift out of sync with what's rendered. */
export function layerZRange(layer: ShapeLayer): { bottomZ: number; topZ: number } {
  let min = Infinity
  let max = -Infinity
  for (const geo of buildLayerGeometries(layer, 1)) {
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    min = Math.min(min, bb.min.y)
    max = Math.max(max, bb.max.y)
  }
  if (!Number.isFinite(min)) return { bottomZ: layer.transform.z, topZ: layer.transform.z }
  return { bottomZ: layer.transform.z + min, topZ: layer.transform.z + max }
}
