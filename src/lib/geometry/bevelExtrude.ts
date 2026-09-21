import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Point2 } from '../../types/document'
import { computeSafeBevel, dilatePolygon, erodePolygon, signedArea } from './offset'
import type { SurfaceTexture } from '../../types/document'
import { buildTexturedCap, buildTexturedWall, subdivideRing, textureStep } from './surfaceTexture'

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
export interface BeveledGeometryOptions {
  /** Hole cutters bevel OUTWARD (the rings widen toward the open face),
   * which rounds/countersinks the rim of the hole they cut. */
  flare?: boolean
  /** Printable relief on the straight wall and/or the top cap. */
  texture?: SurfaceTexture | null
  /** -1 cuts grooves into a solid; +1 pushes a cutter out (grooves in the
   * cavity walls it leaves) — or, for a raised relief on a solid, stands
   * the pattern proud of the surface. */
  textureSign?: 1 | -1
  /** Whether the top cap takes the texture (a cutter's top never does). */
  textureTopCap?: boolean
  /** Subdivide every face at about this step (mm) even without a texture.
   * A body about to be perforated needs this: CSG against a handful of
   * huge triangles cascades into thousands of splits (a 200-hole plate
   * took 6 s; pre-tessellated at 2 mm it takes 0.7 s). */
  tessellate?: number
  /** Return the indexed geometry without normals: the caller will bend
   * it (profile, twist) and shade it once at the end. */
  deferShading?: boolean
  /** Subdivide the caps too (default). A body that is only scaled or
   * turned per height keeps its caps planar, so they can stay two plain
   * fans — the caps are the slow part of a tessellation. */
  tessellateCaps?: boolean
  /** Coarsest texture step allowed (mm), for quick previews. */
  minStep?: number
}

export function buildBeveledGeometry(
  inputContour: Point2[],
  depth: number,
  bevelBottomRequested: number,
  bevelTopRequested: number,
  options: BeveledGeometryOptions = {},
): THREE.BufferGeometry {
  const { flare = false, texture = null, textureSign = -1, textureTopCap = true, tessellate, deferShading = false, tessellateCaps = true, minStep } = options
  // Wall and cap triangle winding below assumes the same orientation every
  // primitive shape has (positive signed area). A pen path clicked in the
  // other direction arrives reversed and would build inside-out — every
  // face back-face culled, "the sides disappear" — so normalize it first.
  const oriented = signedArea(inputContour) < 0 ? [...inputContour].reverse() : inputContour
  // A subdivided wall is built on a pre-subdivided ring, so its columns
  // are the ring's points and the caps and bevel rings, triangulated on
  // the same ring, meet it vertex for vertex (a closed mesh, no
  // T-junctions for the slicer to "repair").
  const wallTexture = texture && texture.depth > 0 && (texture.target === 'walls' || texture.target === 'both') ? texture : null
  const wallStep = wallTexture ? (minStep ? Math.max(textureStep(wallTexture), minStep) : textureStep(wallTexture)) : tessellate
  const contour = wallStep ? subdivideRing(oriented, wallStep) : oriented
  const n = contour.length
  if (n < 3 || depth <= 0) return new THREE.BufferGeometry()

  // Erosion has a geometric limit (a narrow neck pinching shut); dilation
  // does not, so a flared cutter takes the requested amounts as-is.
  let safeBottom = Math.max(0, flare ? bevelBottomRequested : computeSafeBevel(contour, bevelBottomRequested))
  let safeTop = Math.max(0, flare ? bevelTopRequested : computeSafeBevel(contour, bevelTopRequested))

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

  const samePoint = (a: Point2, b: Point2) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

  // An eroded ring can carry runs of identical vertices where a rounded
  // corner collapsed to a point (see collapseFolds in offset.ts) — the ring
  // keeps its length so walls still stitch by index, but the triangles
  // spanning a collapsed run have zero area and are skipped rather than
  // emitted as slivers into the mesh and the STL.
  const addWall = (ringA: Point2[], zA: number, ringB: Point2[], zB: number) => {
    const startA = addRingPoints(ringA, zA)
    const startB = addRingPoints(ringB, zB)
    for (let i = 0; i < n; i++) {
      const iNext = (i + 1) % n
      const a0 = startA + i
      const a1 = startA + iNext
      const b0 = startB + i
      const b1 = startB + iNext
      const aCollapsed = samePoint(ringA[i], ringA[iNext])
      const bCollapsed = samePoint(ringB[i], ringB[iNext])
      if (aCollapsed && bCollapsed) continue
      if (!bCollapsed) indices.push(a0, b0, b1)
      if (!aCollapsed) indices.push(a0, b1, a1)
    }
  }

  // Cap triangulation wants a clean ring: drop repeated vertices left by a
  // collapsed corner (caps are indexed independently of the walls, so
  // changing their vertex count is fine).
  const dedupeRing = (ring: Point2[]) => ring.filter((p, i) => !samePoint(p, ring[(i + 1) % ring.length]))

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
      const ring = erosion <= 1e-9 ? contour : ((flare ? dilatePolygon(contour, erosion) : erodePolygon(contour, erosion)) ?? lastRing)
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
  const appendPart = (part: { positions: number[]; indices: number[] }) => {
    const base = positions.length / 3
    for (const v of part.positions) positions.push(v)
    for (const i of part.indices) indices.push(base + i)
  }
  const textureWalls = texture && texture.depth > 0 && (texture.target === 'walls' || texture.target === 'both')
  const textureTop = texture && texture.depth > 0 && (texture.target === 'top' || texture.target === 'both')
  // A zero-depth "texture" is just a tessellation.
  const flat: SurfaceTexture = { pattern: 'grid', target: 'both', size: 6, depth: 0 }
  if (depth - safeTop > safeBottom + 1e-6) {
    if (textureWalls) appendPart(buildTexturedWall(contour, safeBottom, depth - safeTop, texture, textureSign, wallStep))
    else if (tessellate) appendPart(buildTexturedWall(contour, safeBottom, depth - safeTop, flat, textureSign, tessellate))
    else addWall(contour, safeBottom, contour, depth - safeTop)
  }
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
  const bottomCapRing = dedupeRing(bottomCap)
  const capStep = tessellateCaps ? tessellate : undefined
  if (capStep) {
    // Same grid as the top, flipped to face down.
    const part = buildTexturedCap(bottomCapRing, 0, flat, capStep)
    for (let i = 0; i < part.indices.length; i += 3) {
      const b = part.indices[i + 1]
      part.indices[i + 1] = part.indices[i + 2]
      part.indices[i + 2] = b
    }
    appendPart(part)
  } else {
    const bottomTriangles = THREE.ShapeUtils.triangulateShape(toVector2(bottomCapRing), [])
    const bottomStart = addRingPoints(bottomCapRing, 0)
    for (const [a, b, c] of bottomTriangles) indices.push(bottomStart + a, bottomStart + b, bottomStart + c)
  }

  const topCapRing = dedupeRing(topCap)
  if (textureTop && textureTopCap) {
    appendPart(buildTexturedCap(topCapRing, depth, texture, minStep ? Math.max(textureStep(texture), minStep) : undefined, textureSign))
  } else if (capStep) {
    appendPart(buildTexturedCap(topCapRing, depth, flat, capStep))
  } else {
    const topTriangles = THREE.ShapeUtils.triangulateShape(toVector2(topCapRing), [])
    const topStart = addRingPoints(topCapRing, depth)
    for (const [a, b, c] of topTriangles) indices.push(topStart + a, topStart + c, topStart + b)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  if (deferShading) return geometry
  geometry.computeVertexNormals()
  // A subdivided wall is a smooth relief whose facets can turn more than
  // the crease angle on a tall ridge; crease detection would shade each
  // one flat (a serrated look). Its grid already splits at sharp outline
  // corners and shares nothing with the caps, so averaged normals are
  // right as they are.
  if (textureWalls || tessellate) return geometry
  // Plain computeVertexNormals shares a vertex's normal across every face
  // touching it, so a sharp reflex corner (a star's inner notch, a plain
  // box corner) blends into a normal that can point the wrong way and
  // render as a dark/near-invisible face. Re-deriving with a crease-angle
  // cutoff keeps genuinely smooth curves (the fillet rings above, rounded
  // corners) soft while snapping real corners back to flat shading.
  return toCreasedNormals(geometry, CREASE_ANGLE)
}
