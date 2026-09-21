import * as THREE from 'three'
import type { ManifoldToplevel, Manifold as ManifoldT } from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import type { PositionedGeometry } from './holeCut'

/**
 * Booleans on the Manifold library: it guarantees a manifold (watertight,
 * consistently oriented, index-shared) result, which is what a slicer needs
 * to trust the model. Meshes that are not manifold to begin with are
 * rejected by it (it throws `NotManifold`), and the caller falls back to
 * the triangle-clipping evaluator for those.
 */
let modulePromise: Promise<ManifoldToplevel> | null = null

export function loadManifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = import('manifold-3d').then(async ({ default: init }) => {
      const wasm = await init({ locateFile: () => wasmUrl })
      wasm.setup()
      return wasm
    })
  }
  return modulePromise
}

/** Edges sharper than this keep a crease; flatter ones shade smoothly. */
const SHARP_ANGLE = 40

function toManifold(wasm: ManifoldToplevel, part: PositionedGeometry): ManifoldT {
  const geometry = part.geometry
  const position = geometry.getAttribute('position')
  const count = position.count
  const vertProperties = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    vertProperties[i * 3] = position.getX(i) + part.worldX
    vertProperties[i * 3 + 1] = position.getY(i) + part.worldY
    vertProperties[i * 3 + 2] = position.getZ(i) + part.worldZ
  }
  let triVerts: Uint32Array
  if (geometry.index) triVerts = Uint32Array.from(geometry.index.array)
  else {
    triVerts = new Uint32Array(count)
    for (let i = 0; i < count; i++) triVerts[i] = i
  }
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts })
  // Welds the per-face vertices our geometry carries for flat shading.
  mesh.merge()
  return new wasm.Manifold(mesh)
}

function toGeometry(result: ManifoldT, origin: PositionedGeometry): THREE.BufferGeometry {
  const shaded = result.calculateNormals(0, SHARP_ANGLE)
  const mesh = shaded.getMesh()
  shaded.delete()
  const stride = mesh.numProp
  const count = mesh.numVert
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const o = i * stride
    positions[i * 3] = mesh.vertProperties[o] - origin.worldX
    positions[i * 3 + 1] = mesh.vertProperties[o + 1] - origin.worldY
    positions[i * 3 + 2] = mesh.vertProperties[o + 2] - origin.worldZ
    normals[i * 3] = mesh.vertProperties[o + 3]
    normals[i * 3 + 1] = mesh.vertProperties[o + 4]
    normals[i * 3 + 2] = mesh.vertProperties[o + 5]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triVerts), 1))
  return geometry
}

/**
 * Subtracts `others` from `solid` (or unions them onto it) in the solid's
 * local frame, the convention of cutHolesFromSolid. Throws when any input
 * is not manifold.
 */
export function booleanManifold(wasm: ManifoldToplevel, solid: PositionedGeometry, others: PositionedGeometry[], op: 'subtract' | 'union'): THREE.BufferGeometry {
  const a = toManifold(wasm, solid)
  const bs: ManifoldT[] = []
  try {
    for (const other of others) bs.push(toManifold(wasm, other))
    const result = op === 'union' ? wasm.Manifold.union([a, ...bs]) : wasm.Manifold.difference(a, bs.length === 1 ? bs[0] : wasm.Manifold.union(bs))
    try {
      return toGeometry(result, solid)
    } finally {
      result.delete()
    }
  } finally {
    a.delete()
    for (const b of bs) b.delete()
  }
}
