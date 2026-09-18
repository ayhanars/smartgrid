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

export interface UnitRest {
  /** Z change to apply to every shape in the unit. */
  delta: number
  /** The shape the unit ends up resting on. */
  supporterId: string
}

/**
 * How far a selection has to move, as one rigid unit, so that it rests on
 * whatever lies under it: the member that needs the biggest lift decides
 * (any smaller move would leave that member inside its supporter). Only
 * shapes outside the unit count as support. Null when nothing is under
 * any member.
 */
export function unitRest(ids: string[], layers: Record<string, ShapeLayer>, order: string[]): UnitRest | null {
  let best: UnitRest | null = null
  for (const id of ids) {
    const layer = layers[id]
    if (!layer || layer.isHole || !layer.visible) continue
    const below = shapesBelow(layer, layers, order, ids)[0]
    if (!below) continue
    const own = layerZRange(layer)
    const delta = below.topZ - own.bottomZ
    if (!best || delta > best.delta) best = { delta, supporterId: below.id }
  }
  return best
}

/** Z change that puts the lowest point of the unit on the bed. */
export function unitDropDelta(ids: string[], layers: Record<string, ShapeLayer>): number {
  let lowest = Infinity
  for (const id of ids) {
    const layer = layers[id]
    if (!layer || !layer.visible) continue
    lowest = Math.min(lowest, layer.isHole ? layer.transform.z : layerZRange(layer).bottomZ)
  }
  return Number.isFinite(lowest) ? -lowest : 0
}
