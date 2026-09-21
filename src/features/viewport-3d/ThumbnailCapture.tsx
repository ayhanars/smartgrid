import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useDocumentStore } from '../../state/documentStore'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { shapeWorldBounds } from '../../lib/geometry/layerBounds'
import { layerZRange } from '../../lib/geometry/layerGeometry'
import { encodeCanvas, registerThumbnailCapture, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, type CaptureResult } from '../../lib/persistence/thumbnails'
import { SCENE_SCALE } from './sceneScale'

/** Scene objects that are editor chrome, not the model: hidden while the
 * thumbnail renders. Wrap them in `<group name={THUMBNAIL_HIDE}>`. */
export const THUMBNAIL_HIDE = 'thumbnail-hide'

function isChrome(obj: THREE.Object3D): boolean {
  if (obj.name === THUMBNAIL_HIDE) return true
  // A selected cutter's translucent ghost (a hollow's cavity, a hole).
  if (obj.userData?.cutterGhost === true) return true
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
  const mainCamera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  // Holes are cut in a worker; a picture taken before they land would show
  // solid shapes.
  const readyRef = useRef(ready)
  readyRef.current = ready

  useEffect(() => {
    const camera = new THREE.PerspectiveCamera(35, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT, 0.01, 100)
    const canvas = document.createElement('canvas')
    canvas.width = THUMBNAIL_WIDTH
    canvas.height = THUMBNAIL_HEIGHT

    // The capture is a center crop of the viewport canvas, so the camera
    // takes the canvas' aspect and a field of view that makes the crop
    // read like a 35° 4:3 view.
    const frame = (canvasAspect: number) => {
      camera.aspect = canvasAspect
      const targetAspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
      const verticalFraction = canvasAspect >= targetAspect ? 1 : canvasAspect / targetAspect
      camera.fov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35 / 2)) / verticalFraction) * 180) / Math.PI
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
      const dist = radius * 2.6
      camera.position.set(center.x + dist * 0.8, center.y + dist * 0.65, center.z + dist * 0.8)
      camera.lookAt(center)
      camera.updateProjectionMatrix()
    }

    const capture = async (): Promise<CaptureResult> => {
      if (!readyRef.current) return 'busy'
      frame(gl.domElement.width / Math.max(1, gl.domElement.height))
      const hidden: THREE.Object3D[] = []
      scene.traverse((obj) => {
        if (obj.visible && isChrome(obj)) hidden.push(obj)
      })
      for (const obj of hidden) obj.visible = false
      // Draw straight into the viewport's own canvas, not an offscreen
      // target: a render target disables tone mapping and switches the
      // color space, which makes three.js compile a second shader variant
      // for every material — hundreds of ms — and reading back a
      // multisampled target is slow as well. The visible frame is restored
      // before this task ends, so the capture view never reaches the screen.
      const dom = gl.domElement
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      try {
        gl.render(scene, camera)
        // Center-crop the viewport to 4:3 and scale into the thumbnail.
        const sw = dom.width
        const sh = dom.height
        const targetAspect = THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT
        let cw = sw
        let ch = Math.round(sw / targetAspect)
        if (ch > sh) {
          ch = sh
          cw = Math.round(sh * targetAspect)
        }
        ctx.drawImage(dom, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
      } finally {
        for (const obj of hidden) obj.visible = true
        // Put the real view back in the drawing buffer right away.
        gl.render(scene, mainCamera)
        invalidate()
      }
      // Encoded in a worker: compressing a 960×720 WebP would block the
      // editor for hundreds of ms otherwise.
      return await encodeCanvas(canvas, 0.86)
    }

    return registerThumbnailCapture(capture)
  }, [gl, scene, mainCamera, invalidate])

  return null
}
