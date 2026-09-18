import type { Point2, ShapeLayer, ShapeRegion } from '../../types/document'
import { computeSafeBevel, dilatePolygon, erodePolygon } from './offset'
import { roundPolygonCorners, smartPolishCorners } from './rounding'
import { rotatedLocalPoints } from './layerBounds'
import { contourBounds } from './primitives'

export interface ShellOptions {
  /** Wall thickness, mm. */
  wall: number
  /** Floor (or ceiling, when opened from the bottom) thickness, mm. */
  floor: number
  openFrom: 'top' | 'bottom'
}

export interface ShellCavity {
  /** Local regions for the cavity (top-left origin at 0,0). */
  regions: ShapeRegion[]
  /** Document position of that origin. */
  x: number
  y: number
  z: number
  depth: number
  /** The wall the cavity was actually cut with — smaller than requested
   * when the outline is too narrow for the full wall. */
  wall: number
}

/** Extra reach past the open face so CSG never has to resolve coplanar
 * faces there. */
const OVERSHOOT_MM = 1
const MIN_WALL_MM = 0.4

function dedupe(points: Point2[]): Point2[] {
  const out: Point2[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p)
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop()
  return out
}

/**
 * The negative shape that hollows `solid` into a shell: its own outline
 * inset by the wall thickness (holes in the outline widened by the same
 * amount), reaching from the floor up through the top — or, opened from
 * the bottom, from under the plate up to the ceiling. Built on the same
 * rounded/polished contour the 3D mesh uses so the cavity walls follow
 * the finished outer walls. The solid's Z-spin is baked into the cavity
 * so it lines up whatever the shape's rotation.
 */
export function buildShellCavity(solid: ShapeLayer, options: ShellOptions): ShellCavity | null {
  const wall = Math.max(MIN_WALL_MM, options.wall)
  const isSimple = solid.regions.length === 1 && solid.regions[0].holes.length === 0

  let appliedWall = wall
  const regions: ShapeRegion[] = []
  for (const region of solid.regions) {
    let outer = region.outer.points
    if (isSimple) outer = smartPolishCorners(roundPolygonCorners(outer, solid.cornerRadius), solid.smartPolish)
    const safe = computeSafeBevel(outer, wall)
    if (safe < MIN_WALL_MM) continue
    appliedWall = Math.min(appliedWall, safe)
    const inner = erodePolygon(outer, safe)
    if (!inner) continue
    const innerClean = dedupe(inner)
    if (innerClean.length < 3) continue
    const holes = region.holes
      .map((h) => dilatePolygon(h.points, safe) ?? h.points)
      .map(dedupe)
      .filter((pts) => pts.length >= 3)
    regions.push({ outer: { points: innerClean }, holes: holes.map((points) => ({ points })) })
  }
  if (regions.length === 0) return null

  // Bake the spin: express every point in document space, then re-origin.
  const toWorld = (pts: Point2[]) => rotatedLocalPoints(solid, pts).map((p) => ({ x: p.x + solid.transform.x, y: p.y + solid.transform.y }))
  const worldRegions = regions.map((r) => ({ outer: { points: toWorld(r.outer.points) }, holes: r.holes.map((h) => ({ points: toWorld(h.points) })) }))
  const all = worldRegions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const bounds = contourBounds(all)
  const localize = (pts: Point2[]) => pts.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))

  const top = solid.transform.z + solid.extrusionDepth
  const floor = Math.max(0, options.floor)
  const z = options.openFrom === 'top' ? solid.transform.z + floor : solid.transform.z - OVERSHOOT_MM
  const depth = options.openFrom === 'top' ? top + OVERSHOOT_MM - z : top - floor - z
  if (depth <= 0.05) return null

  return {
    regions: worldRegions.map((r) => ({ outer: { points: localize(r.outer.points) }, holes: r.holes.map((h) => ({ points: localize(h.points) })) })),
    x: bounds.x,
    y: bounds.y,
    z: Math.round(z * 1e6) / 1e6,
    depth: Math.round(depth * 1e6) / 1e6,
    wall: appliedWall,
  }
}
