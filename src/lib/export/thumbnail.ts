import * as THREE from 'three'
import type { ExportMesh } from './exportMeshes'

/** A plate's thumbnail for the 3MF: the plate's bodies rendered from the
 * front-left, above, on a transparent background. */
export interface PlateThumbnail {
  plate: number
  png: Uint8Array
  small: Uint8Array
}

const SIZE = 512
const SMALL = 128

/** Renders one PNG per plate (1-based) that has a body. Returns nothing
 * where WebGL is not available (the 3MF is then written without). */
export async function renderThumbnails(meshes: ExportMesh[], plateCount: number): Promise<PlateThumbnail[]> {
  if (typeof document === 'undefined') return []
  const canvas = document.createElement('canvas')
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  } catch {
    return []
  }
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x000000, 0)
  const out: PlateThumbnail[] = []
  try {
    for (let plate = 1; plate <= Math.max(1, plateCount); plate++) {
      const scene = new THREE.Scene()
      const box = new THREE.Box3()
      let any = false
      const add = (m: ExportMesh) => {
        if (m.components) {
          m.components.forEach(add)
          return
        }
        if (m.positions.length === 0) return
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
        if (m.indices) geometry.setIndex(new THREE.BufferAttribute(m.indices, 1))
        // Slicer coordinates are Z-up; three.js draws Y-up.
        geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
        geometry.computeVertexNormals()
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(m.color || '#4d8dff'), roughness: 0.55, metalness: 0.05 }))
        scene.add(mesh)
        box.expandByObject(mesh)
        any = true
      }
      meshes.filter((m) => (m.plate ?? 1) === plate).forEach(add)
      if (!any) continue
      const center = box.getCenter(new THREE.Vector3())
      const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2)
      const camera = new THREE.PerspectiveCamera(28, 1, 1, radius * 20)
      const dir = new THREE.Vector3(-0.75, 0.8, 1).normalize()
      camera.position.copy(center).addScaledVector(dir, radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05)
      camera.lookAt(center)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6))
      const key = new THREE.DirectionalLight(0xffffff, 1.8)
      key.position.copy(center).add(new THREE.Vector3(-radius, radius * 1.5, radius))
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xffffff, 0.6)
      fill.position.copy(center).add(new THREE.Vector3(radius, radius * 0.3, -radius))
      scene.add(fill)
      const shot = async (size: number) => {
        renderer.setSize(size, size, false)
        renderer.render(scene, camera)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null
      }
      const png = await shot(SIZE)
      const small = await shot(SMALL)
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          ;(o.material as THREE.Material).dispose()
        }
      })
      if (png && small) out.push({ plate, png, small })
    }
  } finally {
    renderer.dispose()
  }
  return out
}
