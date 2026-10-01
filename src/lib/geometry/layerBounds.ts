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

/** A tilted shape (rotationX / rotationY) seen from above: its outline
 * foreshortened by the tilt about the footprint centre, once for each
 * face of the extrusion, which sit depth/2 apart along the tilt. Both
 * faces together are the strip the shape occupies on the plate. An
 * untilted shape gives its points back once. */
export function projectedLocalRegions(layer: ShapeLayer): Point2[][] {
  const tx = layer.transform.rotationX || 0
  const ty = layer.transform.rotationY || 0
  const rings = layer.regions.flatMap((r) => [r.outer.points, ...r.holes.map((h) => h.points)])
  if (!tx && !ty) return rings.map((ring) => rotatedLocalPoints(layer, ring))
  const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const local = contourBounds(allPoints)
  const cx = local.x + local.width / 2
  const cy = local.y + local.height / 2
  const ax = (tx * Math.PI) / 180
  const ay = (ty * Math.PI) / 180
  const depth = Math.max(0.2, layer.extrusionDepth)
  const faces: Point2[][] = []
  for (const side of [-0.5, 0.5]) {
    const ox = depth * side * Math.sin(ay)
    const oy = depth * side * Math.sin(ax)
    for (const ring of rings) {
      faces.push(rotatedLocalPoints(layer, ring.map((p) => ({ x: cx + (p.x - cx) * Math.cos(ay) + ox, y: cy + (p.y - cy) * Math.cos(ax) + oy }))))
    }
  }
  return faces
}

export function shapeWorldBounds(layer: ShapeLayer): Bounds {
  const local = contourBounds(projectedLocalRegions(layer).flat())
  return {
    x: layer.transform.x + local.x,
    y: layer.transform.y + local.y,
    width: local.width,
    height: local.height,
  }
}
