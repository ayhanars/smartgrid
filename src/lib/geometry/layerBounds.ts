import type { Bounds, Point2, ShapeLayer } from '../../types/document'
import { contourBounds } from './primitives'

/** Local points with the shape's Z-spin applied about its footprint
 * center — what the 2D canvas draws and what every footprint/overlap
 * test in the app measures. */
export function rotatedLocalPoints(layer: ShapeLayer, points: Point2[]): Point2[] {
  const deg = layer.transform.rotation
  if (!deg) return points
  const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const local = contourBounds(allPoints)
  const cx = local.x + local.width / 2
  const cy = local.y + local.height / 2
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return points.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }))
}

export function shapeWorldBounds(layer: ShapeLayer): Bounds {
  const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const local = contourBounds(rotatedLocalPoints(layer, allPoints))
  return {
    x: layer.transform.x + local.x,
    y: layer.transform.y + local.y,
    width: local.width,
    height: local.height,
  }
}
