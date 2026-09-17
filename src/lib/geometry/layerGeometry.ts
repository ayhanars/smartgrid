import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { roundPolygonCorners, smartPolishCorners } from './rounding'
import { buildBeveledGeometry } from './bevelExtrude'
import { buildSimpleRegionGeometry } from './multiRegionExtrude'

/** Builds the same extruded (and, for a single-region shape, beveled)
 * geometry used for normal rendering — shared with the CSG hole-cut path so
 * a hole/solid brush is built exactly the same way a plain mesh would be. */
export function buildLayerGeometries(layer: ShapeLayer, scale: number): THREE.BufferGeometry[] {
  const depth = Math.max(0.2, layer.extrusionDepth)
  const isSimple = layer.regions.length === 1 && layer.regions[0].holes.length === 0

  if (isSimple) {
    const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
    const contour = smartPolishCorners(rounded, layer.smartPolish)
    const geo = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop)
    geo.scale(scale, scale, scale)
    return [geo]
  }

  return layer.regions.map((region) => buildSimpleRegionGeometry(region, depth, scale))
}
