import * as THREE from 'three'

export interface TubeSpec {
  radius: number
  /** Centreline, local mm: x across, y along the canvas (depth), z up. */
  points: { x: number; y: number; z: number }[]
}

const RING = 24

/**
 * A closed tube mesh along a polyline: a ring of vertices at every path
 * point in the plane of the local tangent (parallel-transported frames,
 * so the rings never twist), quads between rings, a fan closing each
 * end. Built in the viewport's Y-up frame like every other body:
 * (x, height, depth) = (x, z, y), local to the layer's origin.
 */
export function buildTubeGeometry(tube: TubeSpec, scale: number): THREE.BufferGeometry {
  const r = tube.radius
  const pts = tube.points.map((p) => new THREE.Vector3(p.x, p.z, p.y))
  const n = pts.length
  const geometry = new THREE.BufferGeometry()
  if (n < 2) return geometry
  // Tangents (averaged at interior points) and a stable normal carried
  // along the path.
  const tangents = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    return b.clone().sub(a).normalize()
  })
  let normal = new THREE.Vector3(1, 0, 0)
  if (Math.abs(normal.dot(tangents[0])) > 0.9) normal = new THREE.Vector3(0, 1, 0)
  normal = normal.clone().sub(tangents[0].clone().multiplyScalar(normal.dot(tangents[0]))).normalize()
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // Parallel transport: rotate the previous normal by the change of tangent.
      const axis = tangents[i - 1].clone().cross(tangents[i])
      const len = axis.length()
      if (len > 1e-6) {
        const angle = Math.asin(Math.min(1, len))
        normal.applyAxisAngle(axis.normalize(), angle)
      }
      normal.sub(tangents[i].clone().multiplyScalar(normal.dot(tangents[i]))).normalize()
    }
    const binormal = tangents[i].clone().cross(normal)
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2
      const v = pts[i].clone().addScaledVector(normal, Math.cos(a) * r).addScaledVector(binormal, Math.sin(a) * r)
      positions.push(v.x, v.y, v.z)
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < RING; k++) {
      const a0 = i * RING + k
      const a1 = i * RING + ((k + 1) % RING)
      const b0 = (i + 1) * RING + k
      const b1 = (i + 1) * RING + ((k + 1) % RING)
      indices.push(a0, b0, b1, a0, b1, a1)
    }
  }
  // End caps: a centre vertex and a fan, wound to face outward.
  const startCenter = positions.length / 3
  positions.push(pts[0].x, pts[0].y, pts[0].z)
  for (let k = 0; k < RING; k++) indices.push(startCenter, (k + 1) % RING, k)
  const endCenter = positions.length / 3
  positions.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z)
  const last = (n - 1) * RING
  for (let k = 0; k < RING; k++) indices.push(endCenter, last + k, last + ((k + 1) % RING))
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.scale(scale, scale, scale)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Points along a quarter-circle arc from angle `from` to `to` (radians)
 * about `center`, in a plane given by two unit axes. */
export function arcPoints(center: { x: number; y: number; z: number }, radius: number, u: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, from: number, to: number, steps: number) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps
    const c = Math.cos(a) * radius
    const s = Math.sin(a) * radius
    return { x: center.x + u.x * c + v.x * s, y: center.y + u.y * c + v.y * s, z: center.z + u.z * c + v.z * s }
  })
}
