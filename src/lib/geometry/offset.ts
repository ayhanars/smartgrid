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

/** Where open segments p1-p2 and p3-p4 properly cross, or null. */
function segmentCrossing(p1: Point2, p2: Point2, p3: Point2, p4: Point2): Point2 | null {
  if (!segmentsCross(p1, p2, p3, p4)) return null
  const rx = p2.x - p1.x
  const ry = p2.y - p1.y
  const sx = p4.x - p3.x
  const sy = p4.y - p3.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null
  const t = ((p3.x - p1.x) * sy - (p3.y - p1.y) * sx) / denom
  return { x: p1.x + rx * t, y: p1.y + ry * t }
}

/** True if edge `i` of `offset` points the opposite way from edge `i` of
 * `original` — a short segment (one piece of a finely-subdivided rounded
 * corner) folding back on itself under erosion. */
function isFoldedEdge(original: Point2[], offset: Point2[], i: number): boolean {
  const n = original.length
  const o1 = original[i]
  const o2 = original[(i + 1) % n]
  const f1 = offset[i]
  const f2 = offset[(i + 1) % n]
  return (o2.x - o1.x) * (f2.x - f1.x) + (o2.y - o1.y) * (f2.y - f1.y) < 0
}

// How many edges either side of a fold to look for the crossing that
// closes its loop. A rounded corner is 17 samples, a polished one the same
// again, so this comfortably spans one corner without reaching the next.
const FOLD_SEARCH_EDGES = 40

/**
 * Cleans up the one legitimate way a mitered inward offset "fails": a
 * rounded corner whose radius is smaller than the offset distance
 * geometrically collapses to a sharp point, but the per-edge construction
 * instead leaves a tiny swallowtail loop of reversed edges there. Every
 * such loop is closed by the nearest pair of edges that cross around it;
 * all its vertices get pinned to that crossing. The ring keeps the same
 * vertex count (walls are stitched between rings by index) but no longer
 * folds. Returns null only for a fold that no local crossing closes —
 * that is a real defect (a neck pinching shut), not a collapsed corner.
 *
 * Without this, a bevel + smart-polish/corner-radius combination silently
 * clamps the bevel to below the corner's own radius, which for a modest
 * polish means "the bevel stops doing anything".
 */
function collapseFolds(original: Point2[], offset: Point2[]): Point2[] | null {
  const n = original.length
  const out = offset.slice()
  for (let guard = 0; guard < n; guard++) {
    let a = -1
    for (let i = 0; i < n; i++) {
      if (isFoldedEdge(original, out, i)) {
        a = i
        break
      }
    }
    if (a < 0) return out

    // Extend the run of folded edges forward from `a` (backward is covered
    // by `a` being the first folded edge found, except across the wrap,
    // which the outward search below still spans).
    let b = a
    while (b - a < n - 2 && isFoldedEdge(original, out, (b + 1) % n)) b++

    let crossing: { at: Point2; from: number; to: number } | null = null
    search: for (let total = 2; total <= FOLD_SEARCH_EDGES * 2; total++) {
      for (let s = 1; s < total; s++) {
        const t = total - s
        if (s > FOLD_SEARCH_EDGES || t > FOLD_SEARCH_EDGES) continue
        const ia = (((a - s) % n) + n) % n
        const ib = (b + t) % n
        // Stop once the two edges would meet around the back of the ring.
        if ((ib - ia + n) % n >= n - 1 || s + t + (b - a) >= n - 1) break search
        const at = segmentCrossing(out[ia], out[(ia + 1) % n], out[ib], out[(ib + 1) % n])
        if (at) {
          crossing = { at, from: ia + 1, to: ib }
          break search
        }
      }
    }
    if (!crossing) return null
    const span = (((crossing.to - crossing.from) % n) + n) % n
    for (let m = 0; m <= span; m++) out[(crossing.from + m) % n] = crossing.at
  }
  return out
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

  const collapsed = collapseFolds(points, result)
  if (!collapsed || !isSimplePolygon(collapsed)) return null
  return collapsed
}

/**
 * Outward-offsets (dilates) a simple polygon by `distance` — the mirror of
 * `erodePolygon`, used to widen a hole ring when a shell's wall wraps
 * around it. Null when the result would self-intersect.
 */
export function dilatePolygon(points: Point2[], distance: number): Point2[] | null {
  if (distance <= 0) return points.slice()
  if (points.length < 3) return null
  const area0 = Math.abs(signedArea(points))
  if (area0 < 1e-6) return null
  const a = offsetOnce(points, distance, false)
  const b = offsetOnce(points, distance, true)
  const grown = Math.abs(signedArea(a)) > Math.abs(signedArea(b)) ? a : b
  if (Math.abs(signedArea(grown)) <= area0) return null
  return isSimplePolygon(grown) ? grown : null
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
