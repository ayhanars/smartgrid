import type { Point2 } from '../../types/document'

export function signedArea(points: Point2[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

function cross(o: Point2, a: Point2, b: Point2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** True if open segments p1-p2 and p3-p4 properly cross. Segments that only
 * touch at an endpoint (as adjacent polygon edges always do) are not
 * considered crossing — this is a "does the polygon self-intersect"
 * check, not a general segment-intersection one. */
function segmentsCross(p1: Point2, p2: Point2, p3: Point2, p4: Point2): boolean {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** True if any edge of `offset` points the opposite way from the
 * corresponding edge of `original` — a short segment (like one piece of a
 * finely-subdivided rounded corner) folding back on itself under erosion.
 * This is exactly the kind of local defect `isSimplePolygon`'s crossing
 * check can't see, since it only looks at non-adjacent edge pairs. */
function hasFoldedEdge(original: Point2[], offset: Point2[]): boolean {
  const n = original.length
  for (let i = 0; i < n; i++) {
    const o1 = original[i]
    const o2 = original[(i + 1) % n]
    const f1 = offset[i]
    const f2 = offset[(i + 1) % n]
    const dot = (o2.x - o1.x) * (f2.x - f1.x) + (o2.y - o1.y) * (f2.y - f1.y)
    if (dot < 0) return true
  }
  return false
}

function isSimplePolygon(points: Point2[]): boolean {
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a1 = points[i]
    const a2 = points[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue
      if (segmentsCross(a1, a2, points[j], points[(j + 1) % n])) return false
    }
  }
  return true
}

interface OffsetLine {
  point: Point2
  dir: Point2
}

function lineIntersection(a: OffsetLine, b: OffsetLine): Point2 | null {
  const denom = a.dir.x * b.dir.y - a.dir.y * b.dir.x
  if (Math.abs(denom) < 1e-9) return null
  const dx = b.point.x - a.point.x
  const dy = b.point.y - a.point.y
  const t = (dx * b.dir.y - dy * b.dir.x) / denom
  return { x: a.point.x + a.dir.x * t, y: a.point.y + a.dir.y * t }
}

// A vertex whose two adjacent edges meet at a very shallow angle produces a
// miter join that shoots arbitrarily far from the original corner as the
// angle approaches 0 (classic behavior of any mitered offset/stroke) — left
// unclamped, that spike can warp the ENTIRE eroded contour into something
// unrecognizable well before it trips the self-intersection checks below.
// Every stroke/offset implementation (SVG, Cairo, Skia) guards against this
// with a miter limit; this clamps the same way, pulling an over-long miter
// back along its own direction instead of letting it distort the shape.
const MITER_LIMIT = 4

/** Offsets every edge of the polygon by `distance` along one of the two
 * possible perpendiculars (`flip` picks which), then re-intersects
 * consecutive offset edges to find the new vertices — the standard
 * mitered-offset construction. Which perpendicular is "inward" depends on
 * the polygon's winding, which `erodePolygon` figures out by trying both. */
function offsetOnce(points: Point2[], distance: number, flip: boolean): Point2[] {
  const n = points.length
  const lines: OffsetLine[] = []
  for (let i = 0; i < n; i++) {
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    const dir = { x: (p2.x - p1.x) / len, y: (p2.y - p1.y) / len }
    const normal = flip ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x }
    lines.push({ point: { x: p1.x + normal.x * distance, y: p1.y + normal.y * distance }, dir })
  }
  const maxMiterDist = distance * MITER_LIMIT
  return lines.map((curr, i) => {
    const prev = lines[(i - 1 + n) % n]
    const raw = lineIntersection(prev, curr) ?? prev.point
    const original = points[i]
    const dx = raw.x - original.x
    const dy = raw.y - original.y
    const rawDist = Math.hypot(dx, dy)
    if (rawDist > maxMiterDist && rawDist > 1e-9) {
      const scale = maxMiterDist / rawDist
      return { x: original.x + dx * scale, y: original.y + dy * scale }
    }
    return raw
  })
}

/**
 * Inward-offsets (erodes) a simple polygon by `distance`, returning null if
 * that erosion is not geometrically safe at this distance — either because
 * it collapses/inverts the shape, or because the offset edges cross each
 * other (which is exactly what happens when a bevel eats past a narrow
 * neck or a sharp reflex corner on a complex shape). Callers use this to
 * binary-search the largest safe bevel rather than ever building geometry
 * from a self-intersecting offset.
 */
export function erodePolygon(points: Point2[], distance: number): Point2[] | null {
  if (distance <= 0) return points.slice()
  if (points.length < 3) return null

  const area0 = signedArea(points)
  if (Math.abs(area0) < 1e-6) return null

  const candidateA = offsetOnce(points, distance, false)
  const candidateB = offsetOnce(points, distance, true)
  const areaA = signedArea(candidateA)
  const areaB = signedArea(candidateB)

  const shrankA = Math.sign(areaA) === Math.sign(area0) && Math.abs(areaA) < Math.abs(area0)
  const shrankB = Math.sign(areaB) === Math.sign(area0) && Math.abs(areaB) < Math.abs(area0)

  let result: Point2[]
  if (shrankA && !shrankB) result = candidateA
  else if (shrankB && !shrankA) result = candidateB
  else if (shrankA && shrankB) {
    // Both nominally shrank — pick whichever moved less, since a correct
    // inward erosion at this scale should only remove a modest sliver.
    result = Math.abs(areaA) > Math.abs(areaB) ? candidateA : candidateB
  } else {
    return null
  }

  if (!isSimplePolygon(result) || hasFoldedEdge(points, result)) return null
  return result
}

/** Binary-searches the largest bevel distance (down from `requested`) at
 * which `erodePolygon` still succeeds, so a bevel that would otherwise
 * corrupt the mesh gets silently reduced instead. */
export function computeSafeBevel(points: Point2[], requested: number): number {
  if (requested <= 0) return 0
  if (erodePolygon(points, requested)) return requested

  let lo = 0
  let hi = requested
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (erodePolygon(points, mid)) lo = mid
    else hi = mid
  }
  return lo
}
