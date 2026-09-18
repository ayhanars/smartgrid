import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Perforation, Point2, WallSide } from '../../types/document'

/** Reach past the surface so CSG never has to resolve coplanar faces. */
const OVERSHOOT_MM = 0.5
const SEGMENTS = 16

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

/** One cutter along +Y of the given length, centered at the origin. */
function cutterShape(shape: Perforation['shape'], size: number, length: number): THREE.BufferGeometry {
  const r = size / 2
  if (shape === 'square') return new THREE.BoxGeometry(size, length, size)
  return new THREE.CylinderGeometry(r, r, length, shape === 'hex' ? 6 : SEGMENTS)
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

/**
 * The combined cutter for a shape's perforation, in the same local frame
 * as the shape's own geometry (mm, Y up, before rotation baking): holes
 * along each wall (from the outer surface inward) and/or down through the
 * top face, on a grid or staggered lattice, sized and spaced in mm.
 *
 * `innerContours` are the footprints (same frame) of cavities cut into
 * this shape — a hollowed box's inside. A wall hole "through the wall"
 * then stops just inside the cavity instead of tunnelling across the
 * whole object, which is both what a basket needs and far cheaper to cut.
 */
export function buildPerforationCutter(contour: Point2[], depth: number, perforation: Perforation, innerContours: Point2[][] = []): THREE.BufferGeometry | null {
  const { size, spacing } = perforation
  if (size <= 0.2 || spacing <= size) return null
  const parts: THREE.BufferGeometry[] = []
  const n = contour.length
  const holeDepth = perforation.depth ?? null
  const sides = perforation.sides && perforation.sides.length > 0 ? new Set(perforation.sides) : null
  const up = new THREE.Vector3(0, 1, 0)

  if (perforation.target === 'walls' || perforation.target === 'both') {
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
    const throughLength = Math.hypot(maxX - minX, maxY - minY) + OVERSHOOT_MM
    const from = Math.max(0, perforation.wallFrom ?? 0)
    const to = Math.min(depth, perforation.wallTo ?? depth)
    const rows = centersAlong(to - from, size, spacing, false).map((v) => from + v)
    for (let i = 0; i < n; i++) {
      const a = contour[i]
      const b = contour[(i + 1) % n]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < size) continue
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
      // outward normal for a positive-area (screen-space) contour
      const nrm = { x: dir.y, y: -dir.x }
      if (sides && !sides.has(sideOf(nrm.x, nrm.y))) continue
      const axis = new THREE.Vector3(nrm.x, 0, nrm.y).normalize()
      const q = new THREE.Quaternion().setFromUnitVectors(up, axis)
      rows.forEach((z, rowIndex) => {
        const stagger = perforation.pattern === 'staggered' && rowIndex % 2 === 1
        for (const u of centersAlong(len, size, spacing, stagger)) {
          const px = a.x + dir.x * u
          const py = a.y + dir.y * u
          // How deep this hole goes: the set depth, else to the nearest
          // cavity behind this wall, else out the far side of the solid.
          let reach = holeDepth
          if (reach == null) {
            const inward = { x: -nrm.x, y: -nrm.y }
            const cavity = rayToRings({ x: px, y: py }, inward, innerContours, 0)
            const exit = rayToRings({ x: px, y: py }, inward, [contour], 1e-6)
            reach = cavity != null ? cavity + OVERSHOOT_MM : exit != null ? exit + OVERSHOOT_MM : throughLength
          }
          const length = reach + OVERSHOOT_MM
          const geo = cutterShape(perforation.shape, size, length)
          geo.applyQuaternion(q)
          // Runs from just outside the surface inward.
          const offset = OVERSHOOT_MM - length / 2
          geo.translate(px + nrm.x * offset, z, py + nrm.y * offset)
          parts.push(geo)
        }
      })
    }
  }

  if (perforation.target === 'top' || perforation.target === 'both') {
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
    const length = (holeDepth ?? depth) + 2 * OVERSHOOT_MM
    const margin = size / 2 + (perforation.topInset ?? 0)
    const xs = centersAlong(maxX - minX, size, spacing, false).map((x) => minX + x)
    const ys = centersAlong(maxY - minY, size, spacing, false).map((y) => minY + y)
    ys.forEach((y, rowIndex) => {
      const stagger = perforation.pattern === 'staggered' && rowIndex % 2 === 1
      const row = stagger ? xs.map((x) => x + spacing / 2) : xs
      for (const x of row) {
        const p = { x, y }
        if (!pointInRing(p, contour) || distanceToRing(p, contour) < margin) continue
        const geo = cutterShape(perforation.shape, size, length)
        geo.translate(x, depth + OVERSHOOT_MM - length / 2, y)
        parts.push(geo)
      }
    })
  }

  if (parts.length === 0) return null
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return merged
}
