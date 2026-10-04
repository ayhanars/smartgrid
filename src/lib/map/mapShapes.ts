/**
 * The 2D work behind the city map: lines widened into strips, polygons
 * united, everything clipped to the plate, all through polygon-clipping
 * so each map layer leaves as one set of regions with holes.
 */
import { difference, intersection, union, type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { Point2, ShapeRegion } from '../../types/document'

export type Poly = MultiPolygon

export const EMPTY: Poly = []

const toRing = (pts: Point2[]): Ring => {
  const r = pts.map((p): [number, number] => [p.x, p.y])
  r.push(r[0])
  return r
}

/** Rings (outer first) as a polygon-clipping polygon. */
export const polygonOf = (rings: Point2[][]): Polygon => rings.filter((r) => r.length >= 3).map(toRing)

/** Douglas–Peucker simplification to `tol`. */
export function simplify(points: Point2[], tol: number): Point2[] {
  if (points.length < 3) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const pa = points[a], pb = points[b]
    const dx = pb.x - pa.x, dy = pb.y - pa.y
    const len = Math.hypot(dx, dy)
    let best = -1, bestD = tol
    for (let i = a + 1; i < b; i++) {
      const p = points[i]
      const d = len < 1e-9 ? Math.hypot(p.x - pa.x, p.y - pa.y) : Math.abs(dy * p.x - dx * p.y + pb.x * pa.y - pb.y * pa.x) / len
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best > 0) {
      keep[best] = true
      stack.push([a, best], [best, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** A closed ring simplified, keeping it a ring. */
export function simplifyRing(points: Point2[], tol: number): Point2[] {
  if (points.length < 4) return points
  const open = simplify([...points, points[0]], tol)
  return open.slice(0, -1)
}

function unionAll(polys: Polygon[]): Poly {
  if (polys.length === 0) return EMPTY
  // Union in balanced batches: polygon-clipping's sweep handles many
  // inputs at once better than a long chain.
  let acc: Poly = EMPTY
  for (let i = 0; i < polys.length; i += 64) {
    const batch = polys.slice(i, i + 64)
    try {
      acc = acc.length ? union(acc, ...batch) : union(batch[0], ...batch.slice(1))
    } catch {
      // A degenerate input: add the batch one by one, skipping offenders.
      for (const p of batch) {
        try {
          acc = acc.length ? union(acc, p) : union(p)
        } catch {
          /* skip */
        }
      }
    }
  }
  return acc
}

/** Polygons (each: rings, outer first) united. */
export function unionPolygons(polys: Point2[][][]): Poly {
  return unionAll(polys.map(polygonOf).filter((p) => p.length > 0 && p[0].length >= 4))
}

/** A polyline widened to `width` (round joins and ends). */
export function strip(points: Point2[], width: number): Poly {
  const r = width / 2
  const pieces: Polygon[] = []
  const circle = (c: Point2): Ring => {
    const ring: Ring = []
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      ring.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)])
    }
    ring.push(ring[0])
    return ring
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const nx = (-dy / len) * r, ny = (dx / len) * r
    pieces.push([[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny], [a.x + nx, a.y + ny]]])
    if (i > 0) pieces.push([circle(a)])
  }
  if (points.length >= 2) pieces.push([circle(points[0])], [circle(points[points.length - 1])])
  return unionAll(pieces)
}

export function unite(...polys: Poly[]): Poly {
  const present = polys.filter((p) => p.length > 0)
  if (present.length === 0) return EMPTY
  try {
    return union(present[0], ...present.slice(1))
  } catch {
    return present[0]
  }
}

export function subtract(a: Poly, ...b: Poly[]): Poly {
  const present = b.filter((p) => p.length > 0)
  if (a.length === 0) return EMPTY
  if (present.length === 0) return a
  try {
    return difference(a, ...present)
  } catch {
    return a
  }
}

export function clip(a: Poly, window: Poly): Poly {
  if (a.length === 0 || window.length === 0) return EMPTY
  try {
    return intersection(a, window)
  } catch {
    return EMPTY
  }
}

/** Regions for the document, dropping slivers under `minArea` mm² and
 * ring points closer than `tol`. */
export function regionsOf(poly: Poly, minArea = 0.5, tol = 0.05): ShapeRegion[] {
  const out: ShapeRegion[] = []
  const ring = (r: Ring): Point2[] => {
    const pts = r.map(([x, y]) => ({ x, y }))
    const first = pts[0], last = pts[pts.length - 1]
    const open = first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9 ? pts.slice(0, -1) : pts
    return tol > 0 ? simplifyRing(open, tol) : open
  }
  for (const p of poly) {
    const outer = ring(p[0])
    if (outer.length < 3 || Math.abs(area(outer)) < minArea) continue
    const holes = p.slice(1).map(ring).filter((h) => h.length >= 3 && Math.abs(area(h)) >= minArea)
    out.push({ outer: { points: outer }, holes: holes.map((points) => ({ points })) })
  }
  return out
}

export function area(ring: Point2[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export const polyArea = (poly: Poly): number => poly.reduce((s, p) => s + p.reduce((t, r, i) => t + (i === 0 ? 1 : -1) * Math.abs(area(r.map(([x, y]) => ({ x, y })))), 0), 0)
