import * as THREE from 'three'
import type { Point2 } from '../../types/document'
import { computeSafeBevel, erodePolygon } from './offset'

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
  contour: Point2[],
  depth: number,
  bevelBottomRequested: number,
  bevelTopRequested: number,
): THREE.BufferGeometry {
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

  const bottomInset = safeBottom > 0 ? erodePolygon(contour, safeBottom) : null
  const topInset = safeTop > 0 ? erodePolygon(contour, safeTop) : null
  const bottomCap = bottomInset ?? contour
  const topCap = topInset ?? contour

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

  if (safeBottom > 0 && bottomInset) addWall(bottomInset, 0, contour, safeBottom)
  if (depth - safeTop > safeBottom + 1e-6) addWall(contour, safeBottom, contour, depth - safeTop)
  if (safeTop > 0 && topInset) addWall(contour, depth - safeTop, topInset, depth)

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
  return geometry
}
