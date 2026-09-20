import * as THREE from 'three'
import type { Point2, ShapeLayer } from '../../types/document'
import { contourBounds } from './primitives'
import { rotatedLocalPoints } from './layerBounds'
import { roundPolygonCorners, smartPolishCorners } from './rounding'
import { buildBeveledGeometry } from './bevelExtrude'
import { computeSafeBevel } from './offset'
import { buildSimpleRegionGeometry } from './multiRegionExtrude'
import { buildPerforationCutter } from './perforation'
import { applyProfile, footprintCenter, profileTessellation } from './profile'
import { difference, type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { ShapeRegion } from '../../types/document'

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
    const profileStep = profileTessellation(layer.profile, depth)
    const requested = options.tessellate ?? perforationTessellation(layer)
    const geo = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop, {
      flare: layer.isHole && (layer.bevelMode ?? 'rim') === 'rim',
      texture: layer.texture ?? null,
      textureSign: ((layer.isHole ? 1 : -1) * (layer.texture?.relief === 'raised' ? -1 : 1)) as 1 | -1,
      textureTopCap: !layer.isHole,
      tessellate: profileStep && requested ? Math.min(profileStep, requested) : (profileStep ?? requested),
    })
    // A vase, a cone, a barrel: the footprint scaled along the height.
    if (layer.profile && layer.profile.points.length > 0) applyProfile(geo, layer.profile, depth, footprintCenter(contour))
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

/** The fillet heights the mesh is actually built with: each bevel is
 * clamped to what the outline can support, then both are scaled down so
 * a hair of straight wall always remains (see buildBeveledGeometry). */
function builtBevels(contour: Point2[], depth: number, layer: ShapeLayer): { bevelBottom: number; bevelTop: number } {
  let bottom = Math.max(0, computeSafeBevel(contour, layer.bevelBottom))
  let top = Math.max(0, computeSafeBevel(contour, layer.bevelTop))
  const maxTotal = depth * 0.98
  if (bottom + top > maxTotal) {
    const k = maxTotal / (bottom + top)
    bottom *= k
    top *= k
  }
  return { bevelBottom: bottom, bevelTop: top }
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
export function buildLayerCutters(layer: ShapeLayer, scale: number, holes: ShapeLayer[] = []): THREE.BufferGeometry[] {
  if (!layer.perforation || layer.isHole) return []
  const contour = effectiveContour(layer)
  if (!contour) return []
  const depth = Math.max(0.2, layer.extrusionDepth)
  // Hollowed cavities are where "through the wall" holes stop; every other
  // cutter (a carved pocket, a magnet recess) is something to keep out of.
  const innerContours = holes.filter((h) => h.shellOf).flatMap((hole) => holeFootprintsInLocalFrame(layer, hole))
  const obstacles = holes
    .filter((h) => !h.shellOf)
    .map((hole) => ({
      rings: holeFootprintsInLocalFrame(layer, hole),
      zFrom: hole.transform.z - layer.transform.z,
      zTo: hole.transform.z - layer.transform.z + hole.extrusionDepth,
    }))
  const cutters = buildPerforationCutter(contour, depth, layer.perforation, { innerContours, obstacles, ...builtBevels(contour, depth, layer) })
  if (cutters.length === 0) return []
  // Same bake as the body: derive it from the body's own (unscaled) mesh.
  const body = buildBeveledGeometry(contour, depth, layer.bevelBottom, layer.bevelTop)
  body.scale(scale, scale, scale)
  const bake = rotationBake(body, layer)
  body.dispose()
  const center = footprintCenter(contour)
  return cutters.map((cutter) => {
    // Drilled into a profiled wall: the cutters follow the same curve so a
    // hole starts outside the bulge and ends in the cavity, as designed.
    if (layer.profile && layer.profile.points.length > 0) applyProfile(cutter, layer.profile, depth, center)
    cutter.scale(scale, scale, scale)
    return bake ? cutter.applyMatrix4(bake) : cutter
  })
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

// ---------------------------------------------------------------------------
// Flat cuts: a straight hole all the way through a plain extrusion needs no
// 3D boolean at all — subtract its footprint in 2D and extrude the result.
// That is milliseconds where the CSG takes seconds on a detailed body.
// ---------------------------------------------------------------------------

const EPS = 1e-6

/** True when `hole` can be cut from `solid` in 2D: both stand upright, the
 * solid is a plain extrusion (no bevel, relief or perforation) and the
 * hole is a straight prism spanning the solid's whole height. */
export function isFlatHole(solid: ShapeLayer, hole: ShapeLayer): boolean {
  if (!hole.isHole || hole.shellOf) return false
  if (solid.transform.rotationX || solid.transform.rotationY || hole.transform.rotationX || hole.transform.rotationY) return false
  if (solid.bevelBottom > 0 || solid.bevelTop > 0 || solid.texture || solid.perforation || solid.profile) return false
  if (hole.bevelBottom > 0 || hole.bevelTop > 0 || hole.texture) return false
  const solidBottom = solid.transform.z
  const solidTop = solid.transform.z + Math.max(0.2, solid.extrusionDepth)
  const holeBottom = hole.transform.z
  const holeTop = hole.transform.z + Math.max(0.2, hole.extrusionDepth)
  return holeBottom <= solidBottom + EPS && holeTop >= solidTop - EPS
}

function toRing(points: Point2[]): [number, number][] {
  const ring = points.map((p): [number, number] => [p.x, p.y])
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0])
  return ring
}

function fromRing(ring: [number, number][]): Point2[] {
  const pts = ring.map(([x, y]) => ({ x, y }))
  if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop()
  return pts
}

/** The solid's footprint as regions in its own unrotated local frame. */
function solidLocalRegions(solid: ShapeLayer): ShapeRegion[] {
  const contour = effectiveContour(solid)
  return contour ? [{ outer: { points: contour }, holes: [] }] : solid.regions
}

/** A hole layer's full footprint (outer rings minus its islands) in the
 * solid's local frame. */
function holeLocalPolygons(solid: ShapeLayer, hole: ShapeLayer): Polygon[] {
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
  const place = (pts: Point2[]) => toRing(rotatedLocalPoints(hole, pts).map((p) => toLocal({ x: p.x + hole.transform.x, y: p.y + hole.transform.y })))
  return hole.regions.map((r) => [place(r.outer.points), ...r.holes.map((h) => place(h.points))])
}

/** The solid with every flat hole already subtracted, built like a plain
 * multi-region extrusion (same frame and orientation as
 * buildLayerGeometries). Falls back to the uncut body when the 2D
 * boolean fails or removes everything. */
export function buildFlatCutGeometries(solid: ShapeLayer, holes: ShapeLayer[], scale: number): THREE.BufferGeometry[] {
  const depth = Math.max(0.2, solid.extrusionDepth)
  let regions: ShapeRegion[]
  try {
    const base: MultiPolygon = solidLocalRegions(solid).map((r) => [toRing(r.outer.points), ...r.holes.map((h) => toRing(h.points))])
    const cutters: Polygon[] = holes.flatMap((h) => holeLocalPolygons(solid, h))
    const result = difference(base, cutters)
    regions = result.map((polygon) => ({ outer: { points: fromRing(polygon[0]) }, holes: polygon.slice(1).map((ring) => ({ points: fromRing(ring) })) }))
    regions = regions.filter((r) => r.outer.points.length >= 3)
    if (regions.length === 0) regions = solidLocalRegions(solid)
  } catch {
    regions = solidLocalRegions(solid)
  }
  return regions
    .map((region) => buildSimpleRegionGeometry(region, depth, scale))
    .map((geo) => {
      const bake = rotationBake(geo, solid)
      return bake ? geo.applyMatrix4(bake) : geo
    })
}
