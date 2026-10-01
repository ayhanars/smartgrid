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

/** A picture of some export meshes: the bodies from the front-left,
 * above, lit like a product photo. `background` null keeps the canvas
 * transparent (the 3MF's plate pictures); a colour fills it (a
 * community card). Null where WebGL is not available. */
export async function renderMeshPicture(meshes: ExportMesh[], width: number, height: number, format: 'png' | 'webp' = 'png', background: string | null = null, quality = 0.9): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: background === null, preserveDrawingBuffer: true })
  } catch {
    return null
  }
  try {
    renderer.setPixelRatio(1)
    if (background === null) renderer.setClearColor(0x000000, 0)
    else renderer.setClearColor(new THREE.Color(background), 1)
    const scene = buildScene(meshes)
    if (!scene) return null
    const camera = frameCamera(scene.box, width / height)
    renderer.setSize(width, height, false)
    renderer.render(scene.scene, camera)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === 'webp' ? 'image/webp' : 'image/png', quality))
    scene.dispose()
    return blob
  } finally {
    renderer.dispose()
  }
}

function buildScene(meshes: ExportMesh[]): { scene: THREE.Scene; box: THREE.Box3; dispose: () => void } | null {
  const scene = new THREE.Scene()
  const box = new THREE.Box3()
  let any = false
  const add = (m: ExportMesh) => {
    if (m.components) {
      m.components.forEach(add)
      return
    }
    if (m.positions.length === 0) return
    // The export's own arrays are what the file is written from, so
    // they are only read here: copies for the geometry, and the
    // Z-up → Y-up turn on the object, not the vertices.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.positions), 3))
    if (m.indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(m.indices), 1))
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(m.color || '#4d8dff'), roughness: 0.55, metalness: 0.05 }))
    mesh.rotation.x = -Math.PI / 2
    mesh.updateMatrixWorld()
    scene.add(mesh)
    box.expandByObject(mesh)
    any = true
  }
  meshes.forEach(add)
  if (!any) return null
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.8)
  key.position.copy(center).add(new THREE.Vector3(-radius, radius * 1.5, radius))
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.6)
  fill.position.copy(center).add(new THREE.Vector3(radius, radius * 0.3, -radius))
  scene.add(fill)
  const dispose = () =>
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  return { scene, box, dispose }
}

function frameCamera(box: THREE.Box3, aspect: number): THREE.PerspectiveCamera {
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2)
  const camera = new THREE.PerspectiveCamera(28, aspect, 1, radius * 20)
  const dir = new THREE.Vector3(-0.75, 0.8, 1).normalize()
  // Fit the bounding sphere into the narrower of the two view angles.
  const vFov = (camera.fov * Math.PI) / 360
  const hFov = Math.atan(Math.tan(vFov) * aspect)
  camera.position.copy(center).addScaledVector(dir, (radius / Math.sin(Math.min(vFov, hFov))) * 1.05)
  camera.lookAt(center)
  return camera
}

/** Renders one PNG per plate (1-based) that has a body. Returns nothing
 * where WebGL is not available (the 3MF is then written without). */
export async function renderThumbnails(meshes: ExportMesh[], plateCount: number): Promise<PlateThumbnail[]> {
  const out: PlateThumbnail[] = []
  for (let plate = 1; plate <= Math.max(1, plateCount); plate++) {
    const own = meshes.filter((m) => (m.plate ?? 1) === plate)
    const png = await renderMeshPicture(own, SIZE, SIZE)
    const small = png ? await renderMeshPicture(own, SMALL, SMALL) : null
    if (png && small) out.push({ plate, png: new Uint8Array(await png.arrayBuffer()), small: new Uint8Array(await small.arrayBuffer()) })
  }
  return out
}
