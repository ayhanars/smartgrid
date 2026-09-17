import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Point2 } from '../../types/document'
import { computeSafeBevel, erodePolygon, signedArea } from './offset'

// Below this angle between adjacent faces, normals blend smoothly (a
// rounded fillet reads as glossy-smooth); at or above it, the edge stays
// faceted (a star tip or a box corner stays sharp instead of being wrongly
// averaged into a dark or blown-out face — see CREASE_ANGLE below).
const CREASE_ANGLE = Math.PI / 3

// How many rings approximate each bevel's quarter-circle profile — enough
// that consecutive rings are well under CREASE_ANGLE apart so the fillet
// reads as a smooth curve rather than a chamfer.
const BEVEL_SEGMENTS = 8

/**
 * Builds an extruded solid with independent, geometry-safe top/bottom
 * bevels — hand-rolled instead of THREE.ExtrudeGeometry's built-in bevel,
 * which offsets the contour with a plain per-vertex miter and happily
 * produces a self-intersecting (visibly broken) cap on a complex or
 * concave outline. Here every requested bevel is first clamped via
 * `computeSafeBevel` to the largest amount that erodes cleanly, so a bevel
 * that would corrupt the mesh gets silently reduced instead.
 *
 * Contour must be a simple polygon, in local units (top-left origin,
 * matching every other shape's `regions[0].outer.points`). Builds in the
 * SAME units passed in (mm) — callers scale the resulting geometry, not
 * the inputs, so this stays reusable for STL export later too.
 */
export function buildBeveledGeometry(
  inputContour: Point2[],
  depth: number,
  bevelBottomRequested: number,
  bevelTopRequested: number,
): THREE.BufferGeometry {
  // Wall and cap triangle winding below assumes the same orientation every
  // primitive shape has (positive signed area). A pen path clicked in the
  // other direction arrives reversed and would build inside-out — every
  // face back-face culled, "the sides disappear" — so normalize it first.
  const contour = signedArea(inputContour) < 0 ? [...inputContour].reverse() : inputContour
  const n = contour.length
  if (n < 3 || depth <= 0) return new THREE.BufferGeometry()

  let safeBottom = Math.max(0, computeSafeBevel(contour, bevelBottomRequested))
  let safeTop = Math.max(0, computeSafeBevel(contour, bevelTopRequested))

  // Leave at least a hair of straight wall so the two bevels never cross
  // over into a negative-height middle section.
  const maxTotal = depth * 0.98
  if (safeBottom + safeTop > maxTotal) {
    const scale = maxTotal / (safeBottom + safeTop)
    safeBottom *= scale
    safeTop *= scale
  }

  const positions: number[] = []
  const indices: number[] = []

  const addRingPoints = (ring: Point2[], z: number) => {
    const start = positions.length / 3
    for (const p of ring) positions.push(p.x, z, p.y)
    return start
  }

  const addWall = (ringA: Point2[], zA: number, ringB: Point2[], zB: number) => {
    const startA = addRingPoints(ringA, zA)
    const startB = addRingPoints(ringB, zB)
    for (let i = 0; i < n; i++) {
      const iNext = (i + 1) % n
      const a0 = startA + i
      const a1 = startA + iNext
      const b0 = startB + i
      const b1 = startB + iNext
      indices.push(a0, b0, b1, a0, b1, a1)
    }
  }

  // Traces a quarter-circle fillet profile instead of a single flat taper,
  // so "bevel" actually reads as a rounded, glossy edge rather than a sharp
  // chamfer. `mode` picks which quarter of the circle: a bottom bevel starts
  // narrow (fully eroded) at the cap and widens out to the full contour
  // where it meets the straight wall; a top bevel does the mirror image.
  const buildFilletRings = (r: number, mode: 'bottom' | 'top', zStart: number) => {
    const rings: { ring: Point2[]; z: number }[] = []
    let lastRing = contour
    for (let i = 0; i <= BEVEL_SEGMENTS; i++) {
      const theta = (i / BEVEL_SEGMENTS) * (Math.PI / 2)
      const erosion = mode === 'bottom' ? r * (1 - Math.sin(theta)) : r * (1 - Math.cos(theta))
      const z = mode === 'bottom' ? zStart + r * (1 - Math.cos(theta)) : zStart + r * Math.sin(theta)
      const ring = erosion <= 1e-9 ? contour : (erodePolygon(contour, erosion) ?? lastRing)
      lastRing = ring
      rings.push({ ring, z })
    }
    return rings
  }

  const bottomRings = safeBottom > 0 ? buildFilletRings(safeBottom, 'bottom', 0) : null
  const topRings = safeTop > 0 ? buildFilletRings(safeTop, 'top', depth - safeTop) : null

  const bottomCap = bottomRings ? bottomRings[0].ring : contour
  const topCap = topRings ? topRings[topRings.length - 1].ring : contour

  if (bottomRings) {
    for (let i = 0; i < bottomRings.length - 1; i++) {
      addWall(bottomRings[i].ring, bottomRings[i].z, bottomRings[i + 1].ring, bottomRings[i + 1].z)
    }
  }
  if (depth - safeTop > safeBottom + 1e-6) addWall(contour, safeBottom, contour, depth - safeTop)
  if (topRings) {
    for (let i = 0; i < topRings.length - 1; i++) {
      addWall(topRings[i].ring, topRings[i].z, topRings[i + 1].ring, topRings[i + 1].z)
    }
  }

  const toVector2 = (ring: Point2[]) => ring.map((p) => new THREE.Vector2(p.x, p.y))

  // Bottom faces -Y (down, away from the solid) with the contour's natural
  // winding; top faces +Y and needs the reverse — verified by hand via the
  // cross product, not just eyeballed, since getting this backwards is
  // exactly what silently back-face-culls a cap and looks like a hole.
  const bottomTriangles = THREE.ShapeUtils.triangulateShape(toVector2(bottomCap), [])
  const bottomStart = addRingPoints(bottomCap, 0)
  for (const [a, b, c] of bottomTriangles) indices.push(bottomStart + a, bottomStart + b, bottomStart + c)

  const topTriangles = THREE.ShapeUtils.triangulateShape(toVector2(topCap), [])
  const topStart = addRingPoints(topCap, depth)
  for (const [a, b, c] of topTriangles) indices.push(topStart + a, topStart + c, topStart + b)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  // Plain computeVertexNormals shares a vertex's normal across every face
  // touching it, so a sharp reflex corner (a star's inner notch, a plain
  // box corner) blends into a normal that can point the wrong way and
  // render as a dark/near-invisible face. Re-deriving with a crease-angle
  // cutoff keeps genuinely smooth curves (the fillet rings above, rounded
  // corners) soft while snapping real corners back to flat shading.
  return toCreasedNormals(geometry, CREASE_ANGLE)
}
