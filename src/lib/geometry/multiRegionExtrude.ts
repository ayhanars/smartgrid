import * as THREE from 'three'
import { signedArea } from './offset'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ShapeRegion } from '../../types/document'

// Same crease-angle cutoff as buildBeveledGeometry — ExtrudeGeometry's own
// computeVertexNormals() has the identical sharp-corner darkening bug on a
// concave boolean result (a notch from a Subtract, say).
const CREASE_ANGLE = Math.PI / 3

/**
 * Plain (non-beveled) extrusion for one region, holes cut natively via
 * THREE.Shape.holes. Used for boolean-op results (multiple regions and/or
 * real holes) instead of buildBeveledGeometry — bevel-safety erosion only
 * knows how to erode a single outer contour inward; extending it to also
 * push holes outward correctly is a separate piece of work, so a
 * boolean-combined shape renders as a sharp-edged solid for now rather
 * than silently producing wrong geometry.
 */
export function buildSimpleRegionGeometry(region: ShapeRegion, depth: number, scale: number): THREE.BufferGeometry {
  const toVec2 = (p: { x: number; y: number }) => new THREE.Vector2(p.x * scale, -p.y * scale)
  // The extrusion's walls follow each ring's direction, so the outline
  // and its holes must run opposite ways (as the SVG importer leaves
  // them) or the hole walls face inward and the mesh is not oriented.
  const outer = signedArea(region.outer.points) < 0 ? [...region.outer.points].reverse() : region.outer.points
  const shape = new THREE.Shape(outer.map(toVec2))
  for (const hole of region.holes) {
    const ring = signedArea(hole.points) > 0 ? [...hole.points].reverse() : hole.points
    shape.holes.push(new THREE.Path(ring.map(toVec2)))
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, depth) * scale, bevelEnabled: false, steps: 1 })
  geo.rotateX(-Math.PI / 2)
  return toCreasedNormals(geo, CREASE_ANGLE)
}
