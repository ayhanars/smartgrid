import { union, intersection, difference, xor, type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { Point2, ShapeLayer, ShapeRegion } from '../../types/document'
import { contourBounds } from './primitives'

function closeRing(points: Point2[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first)
  return ring
}

function layerToMultiPolygon(layer: ShapeLayer): MultiPolygon {
  const toWorld = (p: Point2) => ({ x: p.x + layer.transform.x, y: p.y + layer.transform.y })
  return layer.regions.map(
    (region): Polygon => [
      closeRing(region.outer.points.map(toWorld)),
      ...region.holes.map((h) => closeRing(h.points.map(toWorld))),
    ],
  )
}

function ringToPoints(ring: Ring): Point2[] {
  const pts = ring.map(([x, y]) => ({ x, y }))
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (pts.length > 1 && first.x === last.x && first.y === last.y) pts.pop()
  return pts
}

export interface BooleanResult {
  regions: ShapeRegion[]
  /** Where the result's local (0,0) origin landed in document/world space. */
  origin: Point2
}

function multiPolygonToResult(mp: MultiPolygon): BooleanResult | null {
  if (!mp.length) return null
  const worldRegions: ShapeRegion[] = mp.map((polygon) => ({
    outer: { points: ringToPoints(polygon[0]) },
    holes: polygon.slice(1).map((ring) => ({ points: ringToPoints(ring) })),
  }))
  const allPoints = worldRegions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const bounds = contourBounds(allPoints)
  const origin = { x: bounds.x, y: bounds.y }
  const toLocal = (p: Point2) => ({ x: p.x - origin.x, y: p.y - origin.y })
  const regions = worldRegions.map((r) => ({
    outer: { points: r.outer.points.map(toLocal) },
    holes: r.holes.map((h) => ({ points: h.points.map(toLocal) })),
  }))
  return { regions, origin }
}

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude'

/** Applies a real 2D polygon boolean to a z-ordered (back-to-front) list of
 * shapes, Figma-style: the back-most shape is the base, and Subtract/
 * Intersect treat every shape after it as being applied against that base
 * in order. Returns null if there's nothing to combine or the result is
 * empty (e.g. two shapes that don't overlap, Intersected). */
export function applyBooleanOp(op: BooleanOp, orderedLayers: ShapeLayer[]): BooleanResult | null {
  if (orderedLayers.length < 2) return null
  const polys = orderedLayers.map(layerToMultiPolygon)
  const [first, ...rest] = polys
  let result: MultiPolygon
  if (op === 'union') result = union(first, ...rest)
  else if (op === 'subtract') result = difference(first, ...rest)
  else if (op === 'intersect') result = intersection(first, ...rest)
  else result = xor(first, ...rest)
  return multiPolygonToResult(result)
}
