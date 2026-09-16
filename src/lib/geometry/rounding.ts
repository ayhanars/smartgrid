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

/** Rounds every vertex of a closed polygon by the same radius, approximating
 * each corner with a quadratic bezier through the original vertex — a cheap
 * stand-in for a true arc fillet, close enough at the segment counts our
 * shapes use. The radius is clamped per-corner to half of whichever
 * adjacent edge is shorter, so a large radius can never overshoot past a
 * neighboring corner. */
export function roundPolygonCorners(points: Point2[], radius: number): Point2[] {
  if (radius <= 0 || points.length < 3) return points
  const n = points.length
  const result: Point2[] = []

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]
    const curr = points[i]
    const next = points[(i + 1) % n]

    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y)
    const trim = Math.min(radius, inLen / 2, outLen / 2)
    if (trim <= 0) {
      result.push(curr)
      continue
    }

    const inRatio = trim / inLen
    const outRatio = trim / outLen
    const p1: Point2 = { x: curr.x + (prev.x - curr.x) * inRatio, y: curr.y + (prev.y - curr.y) * inRatio }
    const p2: Point2 = { x: curr.x + (next.x - curr.x) * outRatio, y: curr.y + (next.y - curr.y) * outRatio }

    for (let s = 0; s <= CORNER_SEGMENTS; s++) {
      result.push(quadraticBezier(p1, curr, p2, s / CORNER_SEGMENTS))
    }
  }

  return result
}
