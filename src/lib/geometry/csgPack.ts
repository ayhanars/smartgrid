import * as THREE from 'three'

/** A geometry in transferable form, plus where it sits (see
 * PositionedGeometry in holeCut.ts). */
export interface PackedGeometry {
  position: Float32Array
  normal: Float32Array | null
  index: Uint32Array | null
  x: number
  y: number
  z: number
}

export function packGeometry(geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0): PackedGeometry {
  const position = geometry.getAttribute('position').array as Float32Array
  const normal = geometry.getAttribute('normal')?.array as Float32Array | undefined
  const index = geometry.index?.array
  // Copies, so the originals stay usable on this side (they are also the
  // uncut geometry the viewport shows while the cut is in flight).
  return {
    position: Float32Array.from(position),
    normal: normal ? Float32Array.from(normal) : null,
    index: index ? Uint32Array.from(index) : null,
    x,
    y,
    z,
  }
}

export function unpackGeometry(packed: PackedGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(packed.position, 3))
  if (packed.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(packed.normal, 3))
  else geometry.computeVertexNormals()
  if (packed.index) geometry.setIndex(new THREE.BufferAttribute(packed.index, 1))
  return geometry
}

export function transferables(packed: PackedGeometry): ArrayBuffer[] {
  const out: ArrayBuffer[] = [packed.position.buffer as ArrayBuffer]
  if (packed.normal) out.push(packed.normal.buffer as ArrayBuffer)
  if (packed.index) out.push(packed.index.buffer as ArrayBuffer)
  return out
}
