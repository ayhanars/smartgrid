import type { Point2 } from '../../types/document'

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function quadraticBezier(p0: Point2, p1: Point2, p2: Point2, t: number): Point2 {
  const ax = lerp(p0.x, p1.x, t)
  const ay = lerp(p0.y, p1.y, t)
  const bx = lerp(p1.x, p2.x, t)
  const by = lerp(p1.y, p2.y, t)
  return { x: lerp(ax, bx, t), y: lerp(ay, by, t) }
}

const CORNER_SEGMENTS = 6

/** Replaces one vertex with a bezier-approximated round corner of the given
 * radius (clamped to half of whichever adjacent edge is shorter, so it can
 * never overshoot into a neighboring corner) — pushes the original vertex
 * straight through if the radius comes out to 0. */
function roundVertex(prev: Point2, curr: Point2, next: Point2, radius: number, out: Point2[]) {
  const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y)
  const outLen = Math.hypot(next.x - curr.x, next.y - curr.y)
  const trim = Math.min(radius, inLen / 2, outLen / 2)
  if (trim <= 0) {
    out.push(curr)
    return
  }
  const inRatio = trim / inLen
  const outRatio = trim / outLen
  const p1: Point2 = { x: curr.x + (prev.x - curr.x) * inRatio, y: curr.y + (prev.y - curr.y) * inRatio }
  const p2: Point2 = { x: curr.x + (next.x - curr.x) * outRatio, y: curr.y + (next.y - curr.y) * outRatio }
  for (let s = 0; s <= CORNER_SEGMENTS; s++) {
    out.push(quadraticBezier(p1, curr, p2, s / CORNER_SEGMENTS))
  }
}

/** Rounds every vertex of a closed polygon by the same radius. A cheap
 * bezier-through-the-vertex stand-in for a true arc fillet, close enough
 * at the segment counts our shapes use. */
export function roundPolygonCorners(points: Point2[], radius: number): Point2[] {
  if (radius <= 0 || points.length < 3) return points
  const n = points.length
  const result: Point2[] = []
  for (let i = 0; i < n; i++) {
    roundVertex(points[(i - 1 + n) % n], points[i], points[(i + 1) % n], radius, result)
  }
  return result
}

function interiorAngleDegrees(prev: Point2, curr: Point2, next: Point2): number {
  const v1 = { x: prev.x - curr.x, y: prev.y - curr.y }
  const v2 = { x: next.x - curr.x, y: next.y - curr.y }
  const len1 = Math.hypot(v1.x, v1.y) || 1
  const len2 = Math.hypot(v2.x, v2.y) || 1
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (len1 * len2)))
  return (Math.acos(cos) * 180) / Math.PI
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

// A vertex is "sharp" once its interior angle drops below this, and the
// softening intensity blends in smoothly over BLEND_RANGE_DEG above that —
// no sudden on/off seam between a softened corner and an untouched curve.
const SHARP_THRESHOLD_DEG = 150
const BLEND_RANGE_DEG = 60

/** Sharpness-adaptive corner softening: only rounds vertices whose interior
 * angle is already sharp (below SHARP_THRESHOLD_DEG), smoothstep-blending
 * the radius in as the angle sharpens so an already-gentle curve is left
 * completely alone instead of getting a uniform fillet. `intensity` is the
 * radius applied at full blend (very sharp/acute corners). */
export function smartPolishCorners(points: Point2[], intensity: number): Point2[] {
  if (intensity <= 0 || points.length < 3) return points
  const n = points.length
  const result: Point2[] = []
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const curr = points[i]
    const next = points[(i + 1) % n]
    const angle = interiorAngleDegrees(prev, curr, next)
    const blend = 1 - smoothstep(SHARP_THRESHOLD_DEG - BLEND_RANGE_DEG, SHARP_THRESHOLD_DEG, angle)
    roundVertex(prev, curr, next, intensity * blend, result)
  }
  return result
}
