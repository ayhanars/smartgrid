import * as THREE from 'three'
import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// A single Evaluator is reusable across calls (it just holds scratch state
// for the operation), so we don't pay setup cost per shape per frame.
let sharedEvaluator: Evaluator | null = null
function getEvaluator(): Evaluator {
  if (!sharedEvaluator) {
    sharedEvaluator = new Evaluator()
    // Our geometry is flat-colored (no textures), so it never gets a uv
    // attribute — the Evaluator's default attribute list includes 'uv' and
    // crashes trying to read it off geometry that doesn't have one.
    sharedEvaluator.attributes = ['position', 'normal']
  }
  return sharedEvaluator
}

export interface PositionedGeometry {
  geometry: THREE.BufferGeometry
  worldX: number
  /** Vertical (three.js Y) — the print-height axis. */
  worldY: number
  worldZ: number
}

/**
 * Subtracts every hole's geometry from a solid's, using a real 3D boolean
 * (three-bvh-csg), not a 2D trick — the hole's own world position (X, Y
 * height, Z) is completely independent of the solid's, which is what makes
 * a recessed pocket possible at all.
 *
 * Evaluator.evaluate() bakes brush A's world transform onto the result and
 * leaves the result geometry in brush A's original local frame, so the
 * returned geometry can be rendered with the exact same position the solid
 * would have used uncut — no extra transform bookkeeping needed here.
 */
export function cutHolesFromSolid(solid: PositionedGeometry, holes: PositionedGeometry[]): THREE.BufferGeometry {
  if (holes.length === 0) return solid.geometry

  let brush: Brush = new Brush(solid.geometry)
  brush.position.set(solid.worldX, solid.worldY, solid.worldZ)
  brush.updateMatrixWorld()

  const evaluator = getEvaluator()
  for (const hole of holes) {
    const holeBrush = new Brush(hole.geometry)
    holeBrush.position.set(hole.worldX, hole.worldY, hole.worldZ)
    holeBrush.updateMatrixWorld()
    brush = evaluator.evaluate(brush, holeBrush, SUBTRACTION)
    brush.updateMatrixWorld()
  }
  // The evaluator emits three unshared vertices per triangle; welding the
  // ones that coincide (same position and normal) cuts the vertex count
  // several-fold, which is what the vertex stage, the outline pass and
  // the exported file all pay for.
  const welded = mergeVertices(brush.geometry, 1e-6)
  welded.clearGroups()
  return welded
}

/** Unions several placed bodies into one (a box with its hooks), in the
 * first body's local frame — the same convention as cutHolesFromSolid. */
export function fuseSolids(parts: PositionedGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry()
  if (parts.length === 1) return parts[0].geometry
  let brush: Brush = new Brush(parts[0].geometry)
  brush.position.set(parts[0].worldX, parts[0].worldY, parts[0].worldZ)
  brush.updateMatrixWorld()
  const evaluator = getEvaluator()
  for (const part of parts.slice(1)) {
    const other = new Brush(part.geometry)
    other.position.set(part.worldX, part.worldY, part.worldZ)
    other.updateMatrixWorld()
    brush = evaluator.evaluate(brush, other, ADDITION)
    brush.updateMatrixWorld()
  }
  const welded = mergeVertices(brush.geometry, 1e-6)
  welded.clearGroups()
  return welded
}
