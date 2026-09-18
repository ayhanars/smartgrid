import * as THREE from 'three'
import { intersection, type MultiPolygon, type Ring } from 'polygon-clipping'
import type { Point2, SurfaceTexture, WallSide } from '../../types/document'
import { getTile, sampleTile } from './customTile'

/** Mesh pieces in the same layout buildBeveledGeometry accumulates:
 * flat xyz positions and triangle indices (local to `positions`). */
export interface MeshPart {
  positions: number[]
  indices: number[]
}

const TWO_PI = Math.PI * 2

function frac(x: number): number {
  return x - Math.floor(x)
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Deterministic 0..1 hash of an integer cell, for per-brick / per-cell
 * variation that reads as hand-made rather than machine-perfect. */
function cellHash(i: number, j: number, salt = 0): number {
  const x = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453
  return x - Math.floor(x)
}

/** Smooth value noise, 0..1. */
function noise2(x: number, y: number, salt = 0): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = cellHash(ix, iy, salt)
  const b = cellHash(ix + 1, iy, salt)
  const c = cellHash(ix, iy + 1, salt)
  const d = cellHash(ix + 1, iy + 1, salt)
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
}

/** A groove of relative width `w` centered on every integer of `x`
 * (x already in pattern-cell units): rounded profile, 1 at the center. */
function groove(x: number, w: number): number {
  const t = frac(x)
  const d = Math.min(t, 1 - t)
  return 1 - smoothstep(0, w / 2, d)
}

/**
 * Groove strength (0 = untouched surface, 1 = full depth) at surface
 * coordinates u, v (mm). `extent` is the size of the surface being
 * textured (for a custom image placed once, centered).
 */
export function patternStrength(texture: SurfaceTexture, u: number, v: number, extent: { width: number; height: number }): number {
  const s = Math.max(0.5, texture.size)
  switch (texture.pattern) {
    case 'ripples':
      return 0.5 - 0.5 * Math.cos((TWO_PI * v) / s)
    case 'flutes':
      return 0.5 - 0.5 * Math.cos((TWO_PI * u) / s)
    case 'grid':
      return Math.max(groove(u / s, 0.3), groove(v / s, 0.3))
    case 'bricks': {
      // Running bond, 2:1 bricks. Mortar joints are the grooves; every
      // brick also sits at a slightly different depth with a soft
      // pillowed face, which is what makes real brickwork read as such.
      const row = Math.floor(v / s)
      const shift = row % 2 === 0 ? 0 : 0.5
      const col = Math.floor(u / (2 * s) + shift)
      const mortar = Math.max(groove(v / s, 0.2), groove(u / (2 * s) + shift, 0.1))
      const fu = frac(u / (2 * s) + shift)
      const fv = frac(v / s)
      const pillow = 0.12 * (1 - Math.pow(Math.abs(fu - 0.5) * 2, 3)) * (1 - Math.pow(Math.abs(fv - 0.5) * 2, 3))
      const wobble = 0.1 * cellHash(col, row) + 0.05 * noise2((u / s) * 5, (v / s) * 5, 3)
      return Math.max(mortar, Math.min(1, wobble + 0.12 - pillow))
    }
    case 'diamonds':
      return Math.max(groove((u + v) / s, 0.24), groove((u - v) / s, 0.24))
    case 'honeycomb': {
      // Pointy-top hexagons, flat-to-flat = s: groove along the cell walls.
      const R = s / Math.sqrt(3)
      const q = ((Math.sqrt(3) / 3) * u - (1 / 3) * v) / R
      const r = ((2 / 3) * v) / R
      let rq = Math.round(q)
      let rr = Math.round(r)
      const rs = Math.round(-q - r)
      const dq = Math.abs(rq - q)
      const dr = Math.abs(rr - r)
      const ds = Math.abs(rs + q + r)
      if (dq > dr && dq > ds) rq = -rr - rs
      else if (dr > ds) rr = -rq - rs
      const cx = R * Math.sqrt(3) * (rq + rr / 2)
      const cy = R * 1.5 * rr
      const px = u - cx
      const py = v - cy
      const inradius = (R * Math.sqrt(3)) / 2
      let m = 0
      for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) m = Math.max(m, Math.abs(px * Math.cos(a) + py * Math.sin(a)))
      return 1 - smoothstep(0, 0.16 * s, inradius - m)
    }
    case 'dots': {
      // Hemispherical dimples on a staggered lattice.
      const row = Math.floor(v / s)
      const shift = row % 2 === 0 ? 0 : 0.5
      const dx = (frac(u / s + shift) - 0.5) * s
      const dy = (frac(v / s) - 0.5) * s
      const r = 0.36 * s
      const d = Math.hypot(dx, dy) / r
      return d >= 1 ? 0 : Math.sqrt(1 - d * d)
    }
    case 'wood': {
      // Grain: wavy growth rings (low frequency, drifting), with fine
      // fibre lines and a little noise so no two boards look alike.
      const drift = 0.35 * noise2(u / (6 * s), v / (3 * s), 1) + 0.15 * Math.sin((TWO_PI * u) / (4.3 * s))
      const rings = v / s + drift
      const ring = 0.5 - 0.5 * Math.cos(TWO_PI * rings)
      const fibre = 0.5 - 0.5 * Math.cos(TWO_PI * (v / (s * 0.23) + 0.6 * noise2(u / s, v / s, 2)))
      const knots = noise2(u / (2.5 * s), v / (2.5 * s), 4)
      return Math.min(1, ring * ring * 0.8 + fibre * 0.18 + (knots > 0.82 ? (knots - 0.82) * 3 : 0))
    }
    case 'custom': {
      if (!texture.tile) return 0
      const tile = getTile(texture.tile)
      if (!tile) return 0
      const aspect = tile.height / tile.width
      if (texture.repeat === false) {
        // Placed once, `size` mm wide, centered on the surface.
        const w = s
        const h = s * aspect
        const x0 = extent.width / 2 - w / 2
        const y0 = extent.height / 2 - h / 2
        return sampleTile(tile, (u - x0) / w, (v - y0) / h, false)
      }
      return sampleTile(tile, u / s, v / (s * aspect), true)
    }
  }
}

/** Which side of the plate a wall faces, from its outward normal in
 * document coordinates (y grows toward the printer's front). */
function sideOf(nx: number, ny: number): WallSide {
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'right' : 'left'
  return ny >= 0 ? 'front' : 'back'
}

/** Subdivision step for a pattern: fine enough to resolve it, capped so a
 * big plate stays a reasonable triangle count. */
export function textureStep(texture: SurfaceTexture): number {
  return Math.min(2, Math.max(0.35, texture.size / 6))
}

/**
 * A straight wall between two copies of `ring` at heights zA and zB,
 * subdivided and displaced along the outward normal by the pattern.
 * `sign` is -1 to cut grooves into a solid, +1 to push a hole cutter
 * outward (grooves in the cavity wall). The first and last rows stay
 * undisplaced so the wall still meets the caps/bevel rings exactly.
 */
export function buildTexturedWall(ring: Point2[], zA: number, zB: number, texture: SurfaceTexture, sign: 1 | -1): MeshPart {
  const n = ring.length
  const step = textureStep(texture)
  const height = zB - zA
  const rows = Math.max(2, Math.ceil(height / step))
  const positions: number[] = []
  const indices: number[] = []

  // Outward edge normals (ring has positive signed area — see
  // buildBeveledGeometry) and averaged vertex normals so displacement is
  // continuous across corners.
  const edgeNormals = ring.map((p, i) => {
    const q = ring[(i + 1) % n]
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    return { x: (q.y - p.y) / len, y: -(q.x - p.x) / len }
  })
  const vertexNormals = ring.map((_, i) => {
    const a = edgeNormals[(i - 1 + n) % n]
    const b = edgeNormals[i]
    const x = a.x + b.x
    const y = a.y + b.y
    const len = Math.hypot(x, y)
    return len < 1e-6 ? b : { x: x / len, y: y / len }
  })

  // Columns around the ring: each edge split by arc length.
  const columns: { p: Point2; nrm: Point2; u: number; side: WallSide }[] = []
  let u = 0
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    const m = Math.max(1, Math.ceil(len / step))
    for (let k = 0; k < m; k++) {
      const t = k / m
      const nx = vertexNormals[i].x * (1 - t) + vertexNormals[(i + 1) % n].x * t
      const ny = vertexNormals[i].y * (1 - t) + vertexNormals[(i + 1) % n].y * t
      const nl = Math.hypot(nx, ny) || 1
      // Which wall a column belongs to is decided by its own edge's normal,
      // not the corner-blended vertex normal used for displacement.
      columns.push({ p: { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }, nrm: { x: nx / nl, y: ny / nl }, u: u + len * t, side: sideOf(edgeNormals[i].x, edgeNormals[i].y) })
    }
    u += len
  }
  const cols = columns.length
  const perimeter = u
  const sides = texture.sides && texture.sides.length > 0 ? new Set(texture.sides) : null
  const bandFrom = texture.wallFrom
  const bandTo = texture.wallTo
  for (let c = 0; c < cols; c++) {
    const col = columns[c]
    const onSide = !sides || sides.has(col.side) ? 1 : 0
    for (let j = 0; j <= rows; j++) {
      const z = zA + (height * j) / rows
      // Fade at the very ends (so the wall still meets caps/bevels) and at
      // the edges of a height band, over about one pattern step.
      const endFade = j === 0 || j === rows ? 0 : 1
      const bandFade = Math.min(
        bandFrom == null ? 1 : smoothstep(bandFrom - step, bandFrom + step, z - zA),
        bandTo == null ? 1 : 1 - smoothstep(bandTo - step, bandTo + step, z - zA),
      )
      const d = sign * texture.depth * patternStrength(texture, col.u, z - zA, { width: perimeter, height }) * endFade * bandFade * onSide
      positions.push(col.p.x + col.nrm.x * d, z, col.p.y + col.nrm.y * d)
    }
  }
  const stride = rows + 1
  for (let c = 0; c < cols; c++) {
    const c1 = (c + 1) % cols
    for (let j = 0; j < rows; j++) {
      const a0 = c * stride + j
      const a1 = c1 * stride + j
      const b0 = a0 + 1
      const b1 = a1 + 1
      indices.push(a0, b0, b1, a0, b1, a1)
    }
  }
  return { positions, indices }
}

function pointInRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distanceToRing(p: Point2, ring: Point2[]): number {
  let best = Infinity
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
    const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
    if (d < best) best = d
  }
  return best
}

/**
 * The top cap of an extrusion as a relief: a grid over the outline, cells
 * fully inside used as-is, cells the outline crosses clipped to it, and
 * every vertex lowered into the material by the pattern. Displacement
 * fades to zero within 1.5 cells of the outline, which keeps the rim
 * flat (so the walls still meet it) and makes the clipped cells and
 * their full neighbours agree along shared edges.
 */
export function buildTexturedCap(ring: Point2[], z: number, texture: SurfaceTexture): MeshPart {
  const step = textureStep(texture)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of ring) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / step))
  const ny = Math.max(1, Math.ceil((maxY - minY) / step))
  const cellW = (maxX - minX) / nx
  const cellH = (maxY - minY) / ny

  // Cells touched by an outline edge get clipped instead of trusted.
  const crossed = new Uint8Array(nx * ny)
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - minX) / cellW) - 1)
    const x1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x) - minX) / cellW) + 1)
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - minY) / cellH) - 1)
    const y1 = Math.min(ny - 1, Math.floor((Math.max(a.y, b.y) - minY) / cellH) + 1)
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) crossed[cy * nx + cx] = 1
  }

  const positions: number[] = []
  const indices: number[] = []
  const vertexIndex = new Map<string, number>()
  const inset = Math.max(1.5 * step, texture.topInset ?? 0)
  const heightAt = (x: number, y: number) => {
    const fade = smoothstep(inset, inset + step, distanceToRing({ x, y }, ring))
    return z - texture.depth * patternStrength(texture, x - minX, y - minY, { width: maxX - minX, height: maxY - minY }) * fade
  }
  const vertex = (x: number, y: number) => {
    const key = `${x.toFixed(5)},${y.toFixed(5)}`
    const hit = vertexIndex.get(key)
    if (hit !== undefined) return hit
    const idx = positions.length / 3
    positions.push(x, heightAt(x, y), y)
    vertexIndex.set(key, idx)
    return idx
  }
  // Top faces point +Y in the scene, which is clockwise in document
  // coordinates (y down).
  const tri = (a: Point2, b: Point2, c: Point2) => {
    const cross = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    if (Math.abs(cross) < 1e-12) return
    const ia = vertex(a.x, a.y)
    const ib = vertex(b.x, b.y)
    const ic = vertex(c.x, c.y)
    if (cross < 0) indices.push(ia, ib, ic)
    else indices.push(ia, ic, ib)
  }

  const ringPoly: Ring = ring.map((p) => [p.x, p.y] as [number, number])
  ringPoly.push(ringPoly[0])
  for (let cy = 0; cy < ny; cy++) {
    for (let cx = 0; cx < nx; cx++) {
      const x0 = minX + cx * cellW
      const x1 = cx === nx - 1 ? maxX : x0 + cellW
      const y0 = minY + cy * cellH
      const y1 = cy === ny - 1 ? maxY : y0 + cellH
      const corners: Point2[] = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ]
      if (!crossed[cy * nx + cx]) {
        if (!pointInRing({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, ring)) continue
        tri(corners[0], corners[1], corners[2])
        tri(corners[0], corners[2], corners[3])
        continue
      }
      let pieces: MultiPolygon
      try {
        pieces = intersection([[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]], [[ringPoly]])
      } catch {
        continue
      }
      for (const poly of pieces) {
        const outer = poly[0].slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
        const holes = poly.slice(1).map((h) => h.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)))
        if (outer.length < 3) continue
        const all = [...outer, ...holes.flat()]
        for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outer, holes)) tri(all[a], all[b], all[c])
      }
    }
  }
  return { positions, indices }
}
