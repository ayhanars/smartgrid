import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Point2, ProfilePoint, ShapeProfile } from '../../types/document'

/** Wall subdivision (mm) a profiled or twisted body is built with, so the
 * walls have enough rows to follow the curve. */
export function profileTessellation(profile: ShapeProfile | undefined, depth: number, twist = 0): number | undefined {
  const shaped = (profile && profile.points.length > 0) || Math.abs(twist) > 1e-6
  if (!shaped) return undefined
  // A twist also needs the wall split along its length, or a flat side
  // could only bend at its corners.
  const step = Math.min(4, Math.max(1, depth / 24))
  return Math.abs(twist) > 1e-6 ? Math.min(step, 2) : step
}

/** Turns every vertex of a Y-up geometry about `center` in the plan by the
 * twist's share of its height: a twisted vase. */
export function applyTwist(geometry: THREE.BufferGeometry, twistDeg: number, depth: number, center: Point2, zOffset = 0): THREE.BufferGeometry {
  if (Math.abs(twistDeg) < 1e-6) return geometry
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const total = (twistDeg * Math.PI) / 180
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) + zOffset) / depth))
    const a = total * t
    const c = Math.cos(a)
    const s = Math.sin(a)
    const x = pos.getX(i) - center.x
    const z = pos.getZ(i) - center.y
    pos.setX(i, center.x + x * c - z * s)
    pos.setZ(i, center.y + x * s + z * c)
  }
  pos.needsUpdate = true
  return geometry
}

/** Rings sorted by height, clamped into [0, depth]. */
export function orderedProfile(profile: ShapeProfile, depth: number): ProfilePoint[] {
  return [...profile.points].map((p) => ({ z: Math.min(depth, Math.max(0, p.z)), scale: Math.max(0.05, p.scale) })).sort((a, b) => a.z - b.z)
}

/** The footprint scale at height `z`: straight lines between rings, or a
 * monotone cubic through them (no overshoot past a ring's value); flat
 * beyond the outermost rings. */
export function profileScaleAt(profile: ShapeProfile, depth: number, z: number): number {
  return scaleFromPoints(profile, orderedProfile(profile, depth), z)
}

/** The same curve, with the rings sorted once: for sampling many heights. */
export function profileSampler(profile: ShapeProfile, depth: number): (z: number) => number {
  const pts = orderedProfile(profile, depth)
  return (z) => scaleFromPoints(profile, pts, z)
}

function scaleFromPoints(profile: ShapeProfile, pts: ProfilePoint[], z: number): number {
  if (pts.length === 0) return 1
  if (pts.length === 1 || z <= pts[0].z) return pts[0].scale
  if (z >= pts[pts.length - 1].z) return pts[pts.length - 1].scale
  let i = 0
  while (i < pts.length - 2 && z > pts[i + 1].z) i++
  const a = pts[i]
  const b = pts[i + 1]
  const span = b.z - a.z
  if (span <= 1e-9) return b.scale
  const t = (z - a.z) / span
  if (!profile.smooth) return a.scale + (b.scale - a.scale) * t
  // Fritsch–Carlson monotone tangents.
  const slope = (p: ProfilePoint, q: ProfilePoint) => (q.z - p.z > 1e-9 ? (q.scale - p.scale) / (q.z - p.z) : 0)
  const d = slope(a, b)
  const dPrev = i > 0 ? slope(pts[i - 1], a) : d
  const dNext = i + 2 < pts.length ? slope(b, pts[i + 2]) : d
  const tangent = (m0: number, m1: number) => (m0 * m1 <= 0 ? 0 : (m0 + m1) / 2)
  let ma = i > 0 ? tangent(dPrev, d) : d
  let mb = i + 2 < pts.length ? tangent(d, dNext) : d
  if (d !== 0) {
    const alpha = ma / d
    const beta = mb / d
    const k = alpha * alpha + beta * beta
    if (k > 9) {
      const tau = 3 / Math.sqrt(k)
      ma = tau * alpha * d
      mb = tau * beta * d
    }
  }
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return h00 * a.scale + h10 * span * ma + h01 * b.scale + h11 * span * mb
}

/** After bending the vertices, shade the surface again: smooth across the
 * bend, crisp only at real corners (the same rule the plain body uses).
 * Plain computeVertexNormals on the unindexed body would give every
 * triangle its own normal — a faceted, "paper-folded" look. */
export function reshade(geometry: THREE.BufferGeometry, fast = false): THREE.BufferGeometry {
  if (fast) {
    // The extruder's wall grid shares vertices along the wall but not
    // with the caps, so averaged normals are smooth on the wall and
    // still break at the rim — only sharp outline corners go soft.
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  }
  // toCreasedNormals welds by position itself, so an indexed body (the
  // extruder's, before shading) needs no mergeVertices pass first.
  const creased = toCreasedNormals(geometry, Math.PI / 3)
  if (creased !== geometry) geometry.dispose()
  creased.computeBoundingBox()
  creased.computeBoundingSphere()
  return creased
}

/** Centre of a footprint (its bounding box), the point the profile scales
 * about — the same for a body and the cutters drilled into it. */
export function footprintCenter(contour: Point2[]): Point2 {
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
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/** Scales every vertex of a Y-up geometry (built in mm, height along Y)
 * about `center` in the plan by the profile's scale at its height. Used
 * for bodies and for the cutters drilled into them, so they stay aligned. */
export function applyProfile(geometry: THREE.BufferGeometry, profile: ShapeProfile, depth: number, center: Point2, zOffset = 0): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const scaleAt = profileSampler(profile, depth)
  for (let i = 0; i < pos.count; i++) {
    const s = scaleAt(pos.getY(i) + zOffset)
    pos.setX(i, center.x + (pos.getX(i) - center.x) * s)
    pos.setZ(i, center.y + (pos.getZ(i) - center.y) * s)
  }
  pos.needsUpdate = true
  return geometry
}

/** Height ranges where the wall leans out more than 45°, which a printer
 * cannot do without support. `radius` is the footprint's half-extent. */
export function profileOverhangs(profile: ShapeProfile, depth: number, radius: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const steps = 48
  let start: number | null = null
  for (let i = 0; i < steps; i++) {
    const z0 = (i / steps) * depth
    const z1 = ((i + 1) / steps) * depth
    const dr = (profileScaleAt(profile, depth, z1) - profileScaleAt(profile, depth, z0)) * radius
    const steep = dr > (z1 - z0) * Math.tan(Math.PI / 4) + 1e-6
    if (steep && start == null) start = z0
    if (!steep && start != null) {
      out.push({ from: start, to: z0 })
      start = null
    }
  }
  if (start != null) out.push({ from: start, to: depth })
  return out
}

export type ProfilePreset = 'straight' | 'bulge' | 'taper' | 'flare' | 'waist'

export function presetProfile(preset: ProfilePreset, depth: number): ShapeProfile | undefined {
  switch (preset) {
    case 'straight':
      return undefined
    case 'bulge':
      return { smooth: true, points: [{ z: 0, scale: 0.85 }, { z: depth * 0.5, scale: 1.15 }, { z: depth, scale: 0.85 }] }
    case 'taper':
      return { smooth: false, points: [{ z: 0, scale: 1 }, { z: depth, scale: 0.7 }] }
    case 'flare':
      return { smooth: false, points: [{ z: 0, scale: 0.7 }, { z: depth, scale: 1 }] }
    case 'waist':
      return { smooth: true, points: [{ z: 0, scale: 1 }, { z: depth * 0.5, scale: 0.75 }, { z: depth, scale: 1 }] }
  }
}
