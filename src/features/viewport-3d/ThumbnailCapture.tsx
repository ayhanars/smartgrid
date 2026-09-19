import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useDocumentStore } from '../../state/documentStore'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { shapeWorldBounds } from '../../lib/geometry/layerBounds'
import { layerZRange } from '../../lib/geometry/layerGeometry'
import { registerThumbnailCapture, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, type CaptureResult } from '../../lib/persistence/thumbnails'
import { SCENE_SCALE } from './sceneScale'

/** Scene objects that are editor chrome, not the model: hidden while the
 * thumbnail renders. Wrap them in `<group name={THUMBNAIL_HIDE}>`. */
export const THUMBNAIL_HIDE = 'thumbnail-hide'

function isChrome(obj: THREE.Object3D): boolean {
  if (obj.name === THUMBNAIL_HIDE) return true
  // Selection outlines (drei <Edges lineWidth>) and the transform gizmo.
  const type = obj.type
  return type === 'Line2' || type === 'LineSegments2' || type.startsWith('TransformControls')
}

/**
 * Lives inside the editor's <Canvas>. On request it renders the live scene
 * from a fixed three-quarter view, framed on the shapes, into a small
 * offscreen target and hands back a WebP data URL, so the home page shows
 * the real model with its holes, bevels and textures.
 */
export function ThumbnailCapture({ ready }: { ready: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  // Holes are cut in a worker; a picture taken before they land would show
  // solid shapes.
  const readyRef = useRef(ready)
  readyRef.current = ready

  useEffect(() => {
    const target = new THREE.WebGLRenderTarget(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { samples: 4 })
    const camera = new THREE.PerspectiveCamera(35, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.01, 100)
    const pixels = new Uint8Array(THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4)
    const canvas = document.createElement('canvas')
    canvas.width = THUMBNAIL_WIDTH
    canvas.height = THUMBNAIL_HEIGHT

    const frame = () => {
      const { layers, order, bedPresetId, customBedWidth, customBedHeight } = useDocumentStore.getState()
      const bed = getBedPreset(bedPresetId)
      const artboardWidth = bed?.width ?? customBedWidth
      const artboardHeight = bed?.height ?? customBedHeight
      const bedWidth = artboardWidth * SCENE_SCALE
      const bedDepth = artboardHeight * SCENE_SCALE
      const box = new THREE.Box3()
      for (const id of order) {
        const l = layers[id]
        if (!l || !l.visible || l.isHole) continue
        const b = shapeWorldBounds(l)
        const z = layerZRange(l)
        box.expandByPoint(new THREE.Vector3((b.x - artboardWidth / 2) * SCENE_SCALE, z.bottomZ * SCENE_SCALE, (b.y - artboardHeight / 2) * SCENE_SCALE))
        box.expandByPoint(new THREE.Vector3((b.x + b.width - artboardWidth / 2) * SCENE_SCALE, z.topZ * SCENE_SCALE, (b.y + b.height - artboardHeight / 2) * SCENE_SCALE))
      }
      let center: THREE.Vector3
      let radius: number
      if (box.isEmpty()) {
        center = new THREE.Vector3(0, 0, 0)
        radius = Math.max(bedWidth, bedDepth) * 0.6
      } else {
        const size = box.getSize(new THREE.Vector3())
        center = box.getCenter(new THREE.Vector3())
        radius = Math.max(size.x, size.z, size.y * 1.5, bedWidth * 0.12) * 0.75
      }
      const dist = radius * 2.3
      camera.position.set(center.x + dist * 0.8, center.y + dist * 0.65, center.z + dist * 0.8)
      camera.lookAt(center)
      camera.updateProjectionMatrix()
    }

    const capture = (): CaptureResult => {
      if (!readyRef.current) return 'busy'
      frame()
      const hidden: THREE.Object3D[] = []
      scene.traverse((obj) => {
        if (obj.visible && isChrome(obj)) hidden.push(obj)
      })
      for (const obj of hidden) obj.visible = false
      const previousTarget = gl.getRenderTarget()
      try {
        gl.setRenderTarget(target)
        gl.clear()
        gl.render(scene, camera)
        gl.readRenderTargetPixels(target, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, pixels)
      } finally {
        gl.setRenderTarget(previousTarget)
        for (const obj of hidden) obj.visible = true
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const image = ctx.createImageData(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
      // GL rows run bottom-up; flip while copying.
      const rowBytes = THUMBNAIL_WIDTH * 4
      for (let y = 0; y < THUMBNAIL_HEIGHT; y++) {
        const src = (THUMBNAIL_HEIGHT - 1 - y) * rowBytes
        image.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes)
      }
      ctx.putImageData(image, 0, 0)
      return canvas.toDataURL('image/webp', 0.82)
    }

    const unregister = registerThumbnailCapture(capture)
    return () => {
      unregister()
      target.dispose()
    }
  }, [gl, scene])

  return null
}
