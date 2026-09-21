import * as THREE from 'three'
import type { Point2, ShapeLayer, SurfaceTexture } from '../../types/document'
import { effectiveContour, holeFootprintsInLocalFrame, rotationBake } from './layerGeometry'
import { applyProfile, applyTwist, footprintCenter, profileTessellation, reshade } from './profile'
import { buildTexturedWall, textureStep, type MeshPart } from './surfaceTexture'
import { signedArea } from './offset'

/** A texture's zero-depth stand-in: just a subdivision. */
const FLAT: SurfaceTexture = { pattern: 'grid', target: 'walls', size: 6, depth: 0 }
/** A step no wall or edge is longer than: one row, one column per edge. */
const PLAIN = 1e6

/**
 * Whether `cavity` hollows `solid` in a way the shell can be built
 * directly — outer wall, inner wall, rim and floor — instead of by a 3D
 * boolean. That is the common vase / cup: a single-outline solid with
 * no bevels or perforation, its texture (if any) on the walls, and the
 * cavity its own "Hollow out" one.
 */
export function canBuildShellDirectly(solid: ShapeLayer, cavity: ShapeLayer): boolean {
  const link = cavity.shellOf
  if (!link || link.solidId !== solid.id || !cavity.visible) return false
  if (solid.perforation || solid.bevelBottom > 0 || solid.bevelTop > 0) return false
  if (!effectiveContour(solid)) return false
  if (cavity.regions.length !== 1 || cavity.regions[0].holes.length > 0 || cavity.regions[0].outer.points.length < 3) return false
  const t = solid.texture
  if (t && t.depth > 0 && t.target !== 'walls') return false
  const ct = cavity.texture
  if (ct && ct.depth > 0 && ct.target !== 'walls') return false
  return true
}

/**
 * The hollowed solid as one mesh, in the solid's own frame and
 * orientation (what `buildLayerGeometries` would give for the solid,
 * with the cavity taken out). Both walls are built by the same routine
 * as the bodies, so a "through the wall" relief lines up exactly, and
 * the profile / twist bend the whole shell at once.
 */
export function buildShellGeometry(solid: ShapeLayer, cavity: ShapeLayer, scale: number, options: { minStep?: number } = {}): THREE.BufferGeometry {
  const depth = Math.max(0.2, solid.extrusionDepth)
  const outer = orient(dedupe(effectiveContour(solid)!))
  const inner = orient(dedupe(holeFootprintsInLocalFrame(solid, cavity)[0]))
  const link = cavity.shellOf!
  const openTop = link.openFrom === 'top'
  // Floor (or ceiling) thickness as the cavity was actually built.
  const floor = openTop ? cavity.transform.z - solid.transform.z : solid.transform.z + depth - (cavity.transform.z + cavity.extrusionDepth)
  const innerA = openTop ? floor : 0
  const innerB = openTop ? depth : depth - floor

  const profileStep = profileTessellation(solid.profile, depth, solid.twist ?? 0)
  const stepFor = (texture: SurfaceTexture | undefined) => {
    const textured = texture && texture.depth > 0
    let step = textured ? textureStep(texture) : (profileStep ?? PLAIN)
    if (textured && profileStep) step = Math.min(step, profileStep)
    if (options.minStep) step = Math.max(step, options.minStep)
    return step
  }
  const solidTexture = solid.texture && solid.texture.depth > 0 ? solid.texture : undefined
  const solidSign = ((solid.texture?.relief === 'raised' ? 1 : -1) as 1 | -1)
  // The cavity's texture, re-based to the solid's frame: heights are the
  // solid's, and the lookup ring across the wall is the solid's outline.
  const cavityTexture: SurfaceTexture | undefined =
    cavity.texture && cavity.texture.depth > 0
      ? { ...cavity.texture, derived: cavity.texture.derived ? { ...cavity.texture.derived, phaseV: innerA, ring: outer } : undefined }
      : undefined
  const cavitySign = ((cavity.texture?.relief === 'raised' ? -1 : 1) as 1 | -1)

  const positions: number[] = []
  const indices: number[] = []
  const append = (part: MeshPart, flip = false) => {
    const base = positions.length / 3
    for (const v of part.positions) positions.push(v)
    for (let i = 0; i < part.indices.length; i += 3) {
      if (flip) indices.push(base + part.indices[i], base + part.indices[i + 2], base + part.indices[i + 1])
      else indices.push(base + part.indices[i], base + part.indices[i + 1], base + part.indices[i + 2])
    }
  }
  const ringAt = (ring: Point2[], z: number) => {
    const start = positions.length / 3
    for (const p of ring) positions.push(p.x, z, p.y)
    return start
  }
  const toV2 = (ring: Point2[]) => ring.map((p) => new THREE.Vector2(p.x, p.y))

  // Outer wall faces out; the inner wall, built the same way, is turned
  // to face into the cavity.
  append(buildTexturedWall(outer, 0, depth, solidTexture ?? FLAT, solidSign, stepFor(solidTexture)))
  append(buildTexturedWall(inner, innerA, innerB, cavityTexture ?? FLAT, cavitySign, stepFor(cavityTexture)), true)

  // Caps: bottom faces -Y with the ring's natural winding, top faces +Y
  // with the reverse (as in buildBeveledGeometry).
  const fan = (ring: Point2[], z: number, up: boolean) => {
    const tris = THREE.ShapeUtils.triangulateShape(toV2(ring), [])
    const start = ringAt(ring, z)
    for (const [a, b, c] of tris) indices.push(start + a, start + (up ? c : b), start + (up ? b : c))
  }
  const rim = (z: number, up: boolean) => {
    const tris = THREE.ShapeUtils.triangulateShape(toV2(outer), [toV2(inner)])
    const start = ringAt(outer, z)
    ringAt(inner, z)
    for (const [a, b, c] of tris) indices.push(start + a, start + (up ? c : b), start + (up ? b : c))
  }
  if (openTop) {
    fan(outer, 0, false)
    fan(inner, floor, true)
    rim(depth, true)
  } else {
    fan(outer, depth, true)
    fan(inner, depth - floor, false)
    rim(0, false)
  }

  let geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  const center = footprintCenter(outer)
  if (solid.profile && solid.profile.points.length > 0) geo = applyProfile(geo, solid.profile, depth, center)
  if (solid.twist) geo = applyTwist(geo, solid.twist, depth, center)
  geo = reshade(geo, true)
  geo.scale(scale, scale, scale)
  const bake = rotationBake(geo, solid)
  return bake ? geo.applyMatrix4(bake) : geo
}

function dedupe(ring: Point2[]): Point2[] {
  return ring.filter((p, i) => {
    const q = ring[(i + 1) % ring.length]
    return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9
  })
}

function orient(ring: Point2[]): Point2[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring
}
