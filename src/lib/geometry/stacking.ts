import { intersection } from 'polygon-clipping'
import type { ShapeLayer } from '../../types/document'
import { area, footprint } from './support'
import { layerZRange } from './layerGeometry'

const MIN_OVERLAP_FRACTION = 0.005

export interface ShapeBelow {
  id: string
  topZ: number
  /** Share of `layer`'s footprint that lies over this shape. */
  overlap: number
}

/**
 * Every visible solid under `layer`'s footprint that it could rest on:
 * overlapping in XY and not already above it (a part stacked on top of
 * this one is not something it can rest on). Sorted highest first.
 */
export function shapesBelow(layer: ShapeLayer, layers: Record<string, ShapeLayer>, order: string[], exclude: string[] = []): ShapeBelow[] {
  const fp = footprint(layer)
  const fpArea = area(fp)
  if (fpArea <= 1e-6) return []
  const own = layerZRange(layer)
  const result: ShapeBelow[] = []
  for (const id of order) {
    if (id === layer.id || exclude.includes(id)) continue
    const other = layers[id]
    if (!other || other.isHole || !other.visible) continue
    const range = layerZRange(other)
    if (range.bottomZ >= own.topZ - 1e-6 && range.bottomZ > layer.transform.z + 1e-6) continue
    const overlap = area(intersection(fp, footprint(other))) / fpArea
    if (overlap < MIN_OVERLAP_FRACTION) continue
    result.push({ id, topZ: range.topZ, overlap })
  }
  return result.sort((a, b) => b.topZ - a.topZ)
}

/**
 * The Z at which `layer`'s bottom would sit exactly on the highest solid
 * under it, or null when nothing (with at least `minContainment` of the
 * footprint over it) is there.
 */
export function restingHeight(
  layer: ShapeLayer,
  layers: Record<string, ShapeLayer>,
  order: string[],
  minContainment = 0,
  exclude: string[] = [],
): number | null {
  const below = shapesBelow(layer, layers, order, exclude).filter((s) => s.overlap >= minContainment)
  if (below.length === 0) return null
  // The shape rests where its own lowest point (which a tilt can move
  // below transform.z) touches the supporter's top.
  const own = layerZRange(layer)
  const lift = own.bottomZ - layer.transform.z
  return Math.round((below[0].topZ - lift) * 1e6) / 1e6
}
