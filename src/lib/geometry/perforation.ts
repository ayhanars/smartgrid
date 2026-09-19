import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { defaultWallMargin, type HoleShape, type Perforation, type Point2, type WallSide } from '../../types/document'

/** Reach past the surface so CSG never has to resolve coplanar faces. */
const OVERSHOOT_MM = 0.5
const SEGMENTS = 16
/** Least material left between two holes, whatever the spacing says. */
const MIN_GAP_MM = 0.8
/** A hole keeps this much away from a carved pocket it would otherwise
 * break into. */
const POCKET_CLEARANCE_MM = 0.8
/** Slot length as a multiple of its width. */
const SLOT_ASPECT = 2.4
/** Depth of a wall hole with no cavity behind it, in hole sizes. */
const BLIND_DEPTH_FACTOR = 2

function sideOf(nx: number, ny: number): WallSide {
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'right' : 'left'
  return ny >= 0 ? 'front' : 'back'
}

function pointInRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distanceToRing(p: Point2, ring: Point2[]): number {
  let best = Infinity
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
    best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)))
  }
  return best
}

function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const orient = (p: Point2, q: Point2, r: Point2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

/** Do two simple polygons overlap (share any area)? */
function polygonsOverlap(a: Point2[], b: Point2[]): boolean {
  if (a.some((p) => pointInRing(p, b)) || b.some((p) => pointInRing(p, a))) return true
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true
    }
  }
  return false
}

/** Distance along the ray (origin, dir) to the nearest crossing of any
 * ring's edge beyond `minT`, or null when it hits nothing. */
function rayToRings(origin: Point2, dir: Point2, rings: Point2[][], minT: number): number | null {
  let best: number | null = null
  for (const ring of rings) {
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      const ex = b.x - a.x
      const ey = b.y - a.y
      const denom = dir.x * ey - dir.y * ex
      if (Math.abs(denom) < 1e-12) continue
      const wx = a.x - origin.x
      const wy = a.y - origin.y
      const t = (wx * ey - wy * ex) / denom
      const u = (wx * dir.y - wy * dir.x) / denom
      if (t > minT && u >= 0 && u <= 1 && (best === null || t < best)) best = t
    }
  }
  return best
}

/** The hole's outline in its own face plane (u across, v up), counter-
 * clockwise, centered on the origin; `size` is the width across. */
export function holeOutline(shape: HoleShape, size: number): Point2[] {
  const r = size / 2
  const ring = (n: number, radius: number, phase = 0) =>
    Array.from({ length: n }, (_, i) => {
      const a = phase + (i / n) * Math.PI * 2
      return { x: Math.cos(a) * radius, y: Math.sin(a) * radius }
    })
  const stadium = (angle: number) => {
    // Straight-sided slot with round ends, long axis along `angle`.
    const half = (SLOT_ASPECT * size - size) / 2
    const pts: Point2[] = []
    const n = SEGMENTS / 2
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI
      pts.push({ x: half + Math.cos(a) * r, y: Math.sin(a) * r })
    }
    for (let i = 0; i <= n; i++) {
      const a = Math.PI / 2 + (i / n) * Math.PI
      pts.push({ x: -half + Math.cos(a) * r, y: Math.sin(a) * r })
    }
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return pts.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }))
  }
  switch (shape) {
    case 'square':
      return [
        { x: -r, y: -r },
        { x: r, y: -r },
        { x: r, y: r },
        { x: -r, y: r },
      ]
    case 'hex':
      return ring(6, r / Math.cos(Math.PI / 6))
    case 'diamond':
      return ring(4, r * Math.SQRT2 * 0.85, Math.PI / 2)
    case 'triangle':
      return ring(3, r * 1.15, Math.PI / 2)
    case 'star': {
      const outer = r * 1.2
      const inner = outer * 0.45
      return Array.from({ length: 10 }, (_, i) => {
        const a = Math.PI / 2 + (i / 10) * Math.PI * 2
        const radius = i % 2 === 0 ? outer : inner
        return { x: Math.cos(a) * radius, y: Math.sin(a) * radius }
      })
    }
    case 'slot-v':
      return stadium(Math.PI / 2)
    case 'slot-h':
      return stadium(0)
    case 'slot-d':
      return stadium(Math.PI / 4)
    case 'round':
    default:
      return ring(SEGMENTS, r)
  }
}

/** Width (u) and height (v) of a hole outline's bounding box. */
export function holeExtents(shape: HoleShape, size: number): { u: number; v: number } {
  const pts = holeOutline(shape, size)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { u: Math.max(...xs) - Math.min(...xs), v: Math.max(...ys) - Math.min(...ys) }
}

/**
 * A straight prism with the given cross-section: outline points are placed
 * as center + U·x + V·y, and it runs along `axis` from `from` to `to`
 * (distances from center). Non-indexed with outward-facing windings and
 * flat normals — what a CSG brush wants.
 */
export function prism(outline: Point2[], center: THREE.Vector3, U: THREE.Vector3, V: THREE.Vector3, axis: THREE.Vector3, from: number, to: number): THREE.BufferGeometry {
  const n = outline.length
  const at = (p: Point2, s: number) => new THREE.Vector3().copy(center).addScaledVector(U, p.x).addScaledVector(V, p.y).addScaledVector(axis, s)
  const a = outline.map((p) => at(p, from))
  const b = outline.map((p) => at(p, to))
  // Sides and caps must agree: for a counter-clockwise outline in the
  // (U, V) plane with the axis along U × V, a side quad [a_i, b_j, b_i]
  // faces outward (tangent × axis), the far cap keeps the outline's
  // winding and the near cap reverses it.
  const tris: THREE.Vector3[][] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    tris.push([a[i], b[j], b[i]], [a[i], a[j], b[j]])
  }
  const caps = THREE.ShapeUtils.triangulateShape(outline.map((p) => new THREE.Vector2(p.x, p.y)), [])
  for (const [i, j, k] of caps) {
    tris.push([a[i], a[k], a[j]], [b[i], b[j], b[k]])
  }
  // Whichever way the outline and axis happen to be handed (a mirrored
  // frame flips every face together), make the whole surface point
  // outward: flip everything if the signed volume comes out negative.
  let volume = 0
  for (const [p, q, r] of tris) volume += p.dot(new THREE.Vector3().crossVectors(q, r))
  const positions = new Float32Array(tris.length * 9)
  let o = 0
  for (const t of tris) {
    const ordered = volume < 0 ? [t[0], t[2], t[1]] : t
    for (const v of ordered) {
      positions[o++] = v.x
      positions[o++] = v.y
      positions[o++] = v.z
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Evenly spaced centers along a span of `length`, never closer than
 * half a hole to either end, with an optional half-step stagger. */
function centersAlong(length: number, size: number, spacing: number, stagger: boolean): number[] {
  const usable = length - size
  if (usable < 0) return []
  const count = Math.floor(usable / spacing) + 1
  const start = (length - (count - 1) * spacing) / 2
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(start + i * spacing)
  if (!stagger) return out
  // Shift by half a step, dropping whatever no longer fits.
  return out.map((c) => c + spacing / 2).filter((c) => c + size / 2 <= length)
}

/** Something already cut out of the shape (a carved pocket, a magnet
 * recess) that holes must not break into: its footprint rings and its
 * height range, in the shape's own local frame (z from the shape's
 * bottom). */
export interface PerforationObstacle {
  rings: Point2[][]
  zFrom: number
  zTo: number
}

export interface PerforationContext {
  /** Footprints of cavities hollowed into this shape: a wall hole
   * "through the wall" stops just inside the nearest one. */
  innerContours?: Point2[][]
  obstacles?: PerforationObstacle[]
}

/**
 * The combined cutter for a shape's perforation, in the same local frame
 * as the shape's own geometry (mm, Y up, before rotation baking): holes
 * along each wall (from the outer surface inward) and/or down through the
 * top face, on a grid or staggered lattice, sized and spaced in mm.
 *
 * A hole whose tunnel would run into a carved pocket is left out rather
 * than cut half-way (a ragged edge on the pocket wall); wall holes stop
 * just inside a hollowed cavity instead of tunnelling across the object.
 */
export function buildPerforationCutter(contour: Point2[], depth: number, perforation: Perforation, context: PerforationContext = {}): THREE.BufferGeometry[] {
  const { size, spacing } = perforation
  if (size <= 0.2 || spacing <= size) return []
  const innerContours = context.innerContours ?? []
  const obstacles = context.obstacles ?? []
  // One cutter per travel direction. Tunnels in a group are parallel and
  // never touch, so each merged cutter is a clean solid; tunnels that
  // cross (a block drilled from two sides) live in different groups and
  // are subtracted one after another — a self-intersecting cutter is what
  // makes a boolean produce garbage.
  const groups = new Map<string, THREE.BufferGeometry[]>()
  const addPart = (axis: THREE.Vector3, geometry: THREE.BufferGeometry) => {
    const key = `${axis.x.toFixed(3)},${axis.y.toFixed(3)},${axis.z.toFixed(3)}`
    const list = groups.get(key) ?? []
    list.push(geometry)
    groups.set(key, list)
  }
  const n = contour.length
  const holeDepth = perforation.depth ?? null
  const sides = perforation.sides && perforation.sides.length > 0 ? new Set(perforation.sides) : null
  const outline = holeOutline(perforation.shape, size)
  const ext = holeExtents(perforation.shape, size)
  const up = new THREE.Vector3(0, 1, 0)

  // A hole's tunnel (its footprint swept along its travel) must stay clear
  // of every pocket that overlaps it in height.
  const blocked = (footprint: Point2[], zFrom: number, zTo: number) =>
    obstacles.some((o) => o.zTo > zFrom && o.zFrom < zTo && o.rings.some((ring) => polygonsOverlap(footprint, ring)))

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of contour) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  if (perforation.target === 'walls' || perforation.target === 'both') {
    const from = Math.max(0, perforation.wallFrom ?? defaultWallMargin(depth))
    const to = Math.min(depth, depth - Math.max(0, perforation.wallTopMargin ?? defaultWallMargin(depth)))
    const rowSpacing = Math.max(spacing, ext.v + MIN_GAP_MM)
    const colSpacing = Math.max(spacing, ext.u + MIN_GAP_MM)
    const rows = centersAlong(to - from, ext.v, rowSpacing, false).map((v) => from + v)
    // How sharply the outline turns at each vertex (0 along a curve, π/2
    // at a box corner), only where it turns the convex way — tunnels from
    // the two walls of a concave corner diverge and never meet.
    const dirs = contour.map((a, i) => {
      const b = contour[(i + 1) % n]
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    })
    let area2 = 0
    for (let i = 0; i < n; i++) {
      const a = contour[i]
      const b = contour[(i + 1) % n]
      area2 += a.x * b.y - b.x * a.y
    }
    const turnAt = (i: number) => {
      const prev = dirs[(i - 1 + n) % n]
      const next = dirs[i]
      const cross = prev.x * next.y - prev.y * next.x
      if (cross * area2 <= 0) return 0
      const dot = Math.max(-1, Math.min(1, prev.x * next.x + prev.y * next.y))
      return Math.min(Math.PI / 2, Math.acos(dot))
    }
    for (let i = 0; i < n; i++) {
      const a = contour[i]
      const b = contour[(i + 1) % n]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < ext.u) continue
      const dir = dirs[i]
      // Along-wall clearance a tunnel of this reach needs from each end so
      // it can't meet the next wall's tunnels inside the corner.
      const clearStart = Math.tan(turnAt(i) / 2)
      const clearEnd = Math.tan(turnAt((i + 1) % n) / 2)
      // outward normal for a positive-area (screen-space) contour
      const nrm = { x: dir.y, y: -dir.x }
      if (sides && !sides.has(sideOf(nrm.x, nrm.y))) continue
      const inward = { x: -nrm.x, y: -nrm.y }
      const axis = new THREE.Vector3(inward.x, 0, inward.y).normalize()
      const U = new THREE.Vector3(dir.x, 0, dir.y)
      rows.forEach((z, rowIndex) => {
        const stagger = perforation.pattern === 'staggered' && rowIndex % 2 === 1
        for (const u of centersAlong(len, ext.u, colSpacing, stagger)) {
          const px = a.x + dir.x * u
          const py = a.y + dir.y * u
          // How deep this hole goes: the set depth, else to the nearest
          // cavity behind this wall, else out the far side of the solid.
          let reach = holeDepth
          if (reach == null) {
            const cavity = rayToRings({ x: px, y: py }, inward, innerContours, 0)
            const exit = rayToRings({ x: px, y: py }, inward, [contour], 1e-6)
            // No cavity behind this wall (a solid block): a blind hole a
            // couple of diameters deep. Tunnelling across the block would
            // cross the other walls' tunnels, which is both ugly and a
            // pathological boolean.
            const blind = Math.min(BLIND_DEPTH_FACTOR * size, exit != null ? exit / 2 : Infinity)
            reach = cavity != null ? cavity + OVERSHOOT_MM : blind
          }
          if (u - ext.u / 2 < reach * clearStart || u + ext.u / 2 > len - reach * clearEnd) continue
          if (obstacles.length) {
            // Plan view of the tunnel, padded by the clearance.
            const hw = ext.u / 2 + POCKET_CLEARANCE_MM
            const corner = (s: number, w: number) => ({ x: px + inward.x * s + dir.x * w, y: py + inward.y * s + dir.y * w })
            const tunnel = [corner(-POCKET_CLEARANCE_MM, -hw), corner(-POCKET_CLEARANCE_MM, hw), corner(reach, hw), corner(reach, -hw)]
            if (blocked(tunnel, z - ext.v / 2 - POCKET_CLEARANCE_MM, z + ext.v / 2 + POCKET_CLEARANCE_MM)) continue
          }
          const center = new THREE.Vector3(px, z, py)
          addPart(axis, prism(outline, center, U, up, axis, -OVERSHOOT_MM, reach))
        }
      })
    }
  }

  if (perforation.target === 'top' || perforation.target === 'both') {
    const reach = (holeDepth ?? depth) + OVERSHOOT_MM
    const margin = Math.max(ext.u, ext.v) / 2 + (perforation.topInset ?? 0)
    const colSpacing = Math.max(spacing, ext.u + MIN_GAP_MM)
    const rowSpacing = Math.max(spacing, ext.v + MIN_GAP_MM)
    const xs = centersAlong(maxX - minX, ext.u, colSpacing, false).map((x) => minX + x)
    const ys = centersAlong(maxY - minY, ext.v, rowSpacing, false).map((y) => minY + y)
    const U = new THREE.Vector3(1, 0, 0)
    const V = new THREE.Vector3(0, 0, 1)
    const down = new THREE.Vector3(0, -1, 0)
    ys.forEach((y, rowIndex) => {
      const stagger = perforation.pattern === 'staggered' && rowIndex % 2 === 1
      const row = stagger ? xs.map((x) => x + colSpacing / 2) : xs
      for (const x of row) {
        const p = { x, y }
        if (!pointInRing(p, contour) || distanceToRing(p, contour) < margin) continue
        if (obstacles.length) {
          const hw = ext.u / 2 + POCKET_CLEARANCE_MM
          const hh = ext.v / 2 + POCKET_CLEARANCE_MM
          const footprint = [
            { x: x - hw, y: y - hh },
            { x: x + hw, y: y - hh },
            { x: x + hw, y: y + hh },
            { x: x - hw, y: y + hh },
          ]
          if (blocked(footprint, depth - reach - POCKET_CLEARANCE_MM, depth + OVERSHOOT_MM)) continue
        }
        const center = new THREE.Vector3(x, depth, y)
        addPart(down, prism(outline, center, U, V, down, -OVERSHOOT_MM, reach))
      }
    })
  }

  const cutters: THREE.BufferGeometry[] = []
  for (const parts of groups.values()) {
    const merged = mergeGeometries(parts, false)
    for (const g of parts) g.dispose()
    if (merged) cutters.push(merged)
  }
  return cutters
}
