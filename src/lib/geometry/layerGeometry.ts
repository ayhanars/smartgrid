import * as THREE from 'three'
import type { Point2, ShapeLayer } from '../../types/document'
import { contourBounds } from './primitives'
import { rotatedLocalPoints } from './layerBounds'
import { roundPolygonCorners, smartPolishCorners } from './rounding'
import { buildBeveledGeometry } from './bevelExtrude'
import { buildSimpleRegionGeometry } from './multiRegionExtrude'
import { buildPerforationCutter } from './perforation'

// Print frame (X/Y along the plate, Z up) -> three.js scene frame (Y up,
// doc Y along +Z). A proper rotation, so orientation math done in the
// print frame (where the stored Euler angles live) transfers exactly.
const PRINT_TO_THREE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1),
)
const THREE_TO_PRINT = PRINT_TO_THREE.clone().invert()

const DEG = Math.PI / 180

/** The shape's orientation as a quaternion in the PRINT frame, from its
 * stored Euler angles in the one fixed XYZ order used everywhere. */
export function layerPrintQuaternion(layer: ShapeLayer): THREE.Quaternion {
  const t = layer.transform
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotationX * DEG, t.rotationY * DEG, t.rotation * DEG, 'XYZ'))
}

/** Re-expresses a rotation measured in the three.js scene frame (e.g. what
 * a viewport gizmo reports) in the print frame the stored angles live in. */
export function sceneRotationToPrint(q: THREE.Quaternion): THREE.Quaternion {
  return THREE_TO_PRINT.clone().multiply(q).multiply(PRINT_TO_THREE)
}

/** Back from a print-frame quaternion to the stored Euler angles (degrees,
 * XYZ order). */
export function printQuaternionToEuler(q: THREE.Quaternion): { x: number; y: number; z: number } {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return { x: e.x / DEG, y: e.y / DEG, z: e.z / DEG }
}

/** The transform that bakes the layer's orientation into scene-frame
 * geometry: rotate about the footprint center (keeping the footprint
 * centered where it was), then re-anchor so the object's lowest point is
 * at Y=0 — `transform.z` stays "the height of this object's own bottom"
 * no matter how it's tilted, so a tilt can never sink it under the plate.
 * Computed from the main geometry and shared with its cutters, so a
 * perforation rotates and re-anchors exactly with the body it drills. */
function rotationBake(geometry: THREE.BufferGeometry, layer: ShapeLayer): THREE.Matrix4 | null {
  const { rotationX, rotationY, rotation } = layer.transform
  if (!rotationX && !rotationY && !rotation) return null
  geometry.computeBoundingBox()
  const pivot = geometry.boundingBox!.getCenter(new THREE.Vector3())
  const q = PRINT_TO_THREE.clone().multiply(layerPrintQuaternion(layer)).multiply(THREE_TO_PRINT)
  const rotate = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
  const probe = geometry.clone().applyMatrix4(rotate)
  probe.computeBoundingBox()
  const minY = probe.boundingBox!.min.y
  probe.dispose()
  return new THREE.Matrix4().makeTranslation(0, -minY, 0).multiply(rotate)
}

/** The effective outline the mesh is built from (rounded + polished) for
 * a simple shape, or null for a multi-region one. */
function effectiveContour(layer: ShapeLayer) {
  const isSimple = layer.regions.length === 1 && layer.regions[0].holes.length === 0
  if (!isSimple) return null
  const rounded = roundPolygonCorners(layer.regions[0].outer.points, layer.cornerRadius)
  return smartPolishCorners(rounded, layer.smartPolish)
}

/** Builds the same extruded (and, for a single-region shape, beveled)
 * geometry used for normal rendering — shared with the CSG hole-cut path
 * and the exporter so a hole/solid brush is built exactly the same way a
 * plain mesh would be, orientation included. */
export interface LayerGeometryOptions {
  /** Subdivide faces at about this step (mm) — see BeveledGeometryOptions. */
  tessellate?: number
}

/** The face subdivision a perforated body is built with. */
export function perforationTessellation(layer: ShapeLayer): number | undefined {
  const perforation = !layer.isHole ? layer.perforation : undefined
  return perforation ? Math.min(2.5, Math.max(1, perforation.spacing / 2)) : undefined
}

export function buildLayerGeometries(layer: ShapeLayer, scale: number, options: LayerGeometryOptions = {}): THREE.BufferGeometry[] {
  const depth = Math.max(0.2, layer.extrusionDepth)
  const contour = effectiveContour(layer)

  let geometries: THREE.BufferGeometry[]
  if (contour) {
    const geo = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop, {
      flare: layer.isHole && (layer.bevelMode ?? 'rim') === 'rim',
      texture: layer.texture ?? null,
      textureSign: layer.isHole ? 1 : -1,
      tessellate: options.tessellate ?? perforationTessellation(layer),
    })
    geo.scale(scale, scale, scale)
    geometries = [geo]
  } else {
    geometries = layer.regions.map((region) => buildSimpleRegionGeometry(region, depth, scale))
  }
  return geometries.map((geo) => {
    const bake = rotationBake(geo, layer)
    return bake ? geo.applyMatrix4(bake) : geo
  })
}

/** A hole layer's footprint rings expressed in `solid`'s own unrotated
 * local frame (the frame its geometry and cutters are built in): world
 * XY, then undo the solid's spin about its footprint center. */
function holeFootprintsInLocalFrame(solid: ShapeLayer, hole: ShapeLayer): Point2[][] {
  const all = solid.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const bounds = contourBounds(all)
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const rad = (-solid.transform.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const toLocal = (p: Point2): Point2 => {
    const x = p.x - solid.transform.x - cx
    const y = p.y - solid.transform.y - cy
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }
  }
  return hole.regions.map((r) => rotatedLocalPoints(hole, r.outer.points).map((p) => toLocal({ x: p.x + hole.transform.x, y: p.y + hole.transform.y })))
}

/** The shape's own perforation cutter (real holes through its walls/top),
 * in the same frame and orientation as `buildLayerGeometries` — subtract
 * it like any hole. Null when the shape has no perforation. */
export function buildLayerCutters(layer: ShapeLayer, scale: number, cavities: ShapeLayer[] = []): THREE.BufferGeometry[] {
  if (!layer.perforation || layer.isHole) return []
  const contour = effectiveContour(layer)
  if (!contour) return []
  const depth = Math.max(0.2, layer.extrusionDepth)
  const cutter = buildPerforationCutter(contour, depth, layer.perforation, cavities.flatMap((hole) => holeFootprintsInLocalFrame(layer, hole)))
  if (!cutter) return []
  cutter.scale(scale, scale, scale)
  // Same bake as the body: derive it from the body's own (unscaled) mesh.
  const body = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop)
  body.scale(scale, scale, scale)
  const bake = rotationBake(body, layer)
  body.dispose()
  return [bake ? cutter.applyMatrix4(bake) : cutter]
}

/** Real geometric Z range (mm, print frame) of the built shape — derived
 * from the actual geometry, not assumed from z + extrusionDepth, so a
 * tilted or beveled object can't drift out of sync with what's rendered. */
const zRangeCache = new WeakMap<ShapeLayer, { bottomZ: number; topZ: number }>()

export function layerZRange(layer: ShapeLayer): { bottomZ: number; topZ: number } {
  // Layer objects are immutable store values, so one build per object is
  // enough however many callers ask (preview, stacking, support analysis).
  const cached = zRangeCache.get(layer)
  if (cached) return cached
  const range = computeZRange(layer)
  zRangeCache.set(layer, range)
  return range
}

function computeZRange(layer: ShapeLayer): { bottomZ: number; topZ: number } {
  let min = Infinity
  let max = -Infinity
  // Surface relief cuts inward and perforations only remove material, so
  // neither changes the extents: build the plain (cheap) body for them.
  const plain: ShapeLayer = layer.texture || layer.perforation ? { ...layer, texture: undefined, perforation: undefined } : layer
  for (const geo of buildLayerGeometries(plain, 1)) {
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    min = Math.min(min, bb.min.y)
    max = Math.max(max, bb.max.y)
  }
  if (!Number.isFinite(min)) return { bottomZ: layer.transform.z, topZ: layer.transform.z }
  return { bottomZ: layer.transform.z + min, topZ: layer.transform.z + max }
}
