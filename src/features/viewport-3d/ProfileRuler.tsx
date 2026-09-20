import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { ShapeLayer, ShapeProfile } from '../../types/document'
import { useDocumentStore } from '../../state/documentStore'
import { shapeWorldBounds, rotatedLocalPoints } from '../../lib/geometry/layerBounds'
import { orderedProfile, profileOverhangs, profileScaleAt } from '../../lib/geometry/profile'
import { SCENE_SCALE } from './sceneScale'

const RULER_GAP_MM = 16
const HANDLE_MM = 2.4

/**
 * A vertical ruler beside the selected shape for shaping its profile: one
 * ring per control point, dragged up/down on the ruler for its height and
 * in/out beside the shape for its width; a click on the ruler adds a ring.
 */
export function ProfileRuler({ layer, artboardWidth, artboardHeight, controls }: { layer: ShapeLayer; artboardWidth: number; artboardHeight: number; controls: OrbitControlsImpl | null }) {
  const setProfile = useDocumentStore((s) => s.setProfile)
  const beginTransientEdit = useDocumentStore((s) => s.beginTransientEdit)
  const commitTransientEdit = useDocumentStore((s) => s.commitTransientEdit)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  const depth = Math.max(0.2, layer.extrusionDepth)
  const profile: ShapeProfile = layer.profile ?? { smooth: true, points: [] }
  const points = orderedProfile(profile, depth)
  const bounds = shapeWorldBounds(layer)
  const S = SCENE_SCALE
  const cx = (bounds.x + bounds.width / 2 - artboardWidth / 2) * S
  const cz = (bounds.y + bounds.height / 2 - artboardHeight / 2) * S
  const y0 = layer.transform.z * S
  const height = depth * S
  // The ruler stands to the shape's right (toward the default camera), past
  // the widest ring so the shape never covers it; the width handles pull out
  // to the front, so the two never overlap.
  const widest = Math.max(1, ...points.map((p) => p.scale))
  const rulerX = cx + (bounds.width / 2) * widest * S + RULER_GAP_MM * S
  const halfD = (bounds.height / 2) * S
  const handle = HANDLE_MM * S

  // The shape's outline (spin included) for the rings.
  const outline = useMemo(() => {
    const pts = rotatedLocalPoints(layer, layer.regions[0]?.outer.points ?? [])
    const all = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
    const local = rotatedLocalPoints(layer, all)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of local) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const mx = (minX + maxX) / 2
    const my = (minY + maxY) / 2
    return pts.map((p) => ({ x: (p.x - mx) * S, y: (p.y - my) * S }))
  }, [layer, S])

  const ringGeometry = (scale: number) => {
    const geo = new THREE.BufferGeometry()
    const arr = new Float32Array(outline.length * 3)
    outline.forEach((p, i) => {
      arr[i * 3] = p.x * scale
      arr[i * 3 + 1] = 0
      arr[i * 3 + 2] = p.y * scale
    })
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return geo
  }

  const drag = useRef<{ index: number; kind: 'height' | 'width'; plane: THREE.Plane; raf: number | null; pending: ShapeProfile | null } | null>(null)
  const clickStart = useRef<{ x: number; y: number } | null>(null)
  const gl = useThree((s) => s.gl)

  const pushProfile = (next: ShapeProfile) => {
    const d = drag.current
    if (!d) return
    d.pending = next
    if (d.raf == null) {
      d.raf = requestAnimationFrame(() => {
        if (d.pending) setProfile(layer.id, d.pending)
        d.raf = null
        invalidate()
      })
    }
  }

  // The drag is followed on the window (not through the canvas' own
  // pointer capture), with the ray rebuilt from the mouse position, so a
  // handle keeps following the pointer wherever it goes and lets go cleanly.
  const startDrag = (e: ThreeEvent<PointerEvent>, index: number, kind: 'height' | 'width') => {
    e.stopPropagation()
    if (drag.current) return
    if (controls) controls.enabled = false
    beginTransientEdit()
    const point = e.point.clone()
    let plane: THREE.Plane
    if (kind === 'height') {
      // A vertical plane facing the camera through the ruler.
      const dir = camera.getWorldDirection(new THREE.Vector3())
      dir.y = 0
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
      dir.normalize()
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, point)
    } else {
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y)
    }
    const d = { index, kind, plane, raf: null as number | null, pending: null as ShapeProfile | null }
    drag.current = d
    const raycaster = new THREE.Raycaster()
    const onMove = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.ray.intersectPlane(d.plane, new THREE.Vector3())
      if (!hit) return
      const current = orderedProfile(useDocumentStore.getState().layers[layer.id]?.profile ?? profile, depth)
      const next = current.map((p, i) => {
        if (i !== d.index) return p
        if (d.kind === 'height') return { ...p, z: Math.round(Math.min(depth, Math.max(0, (hit.y - y0) / S)) * 10) / 10 }
        const scale = Math.min(3, Math.max(0.05, (hit.z - cz - handle * 1.5) / Math.max(halfD, 1e-6)))
        return { ...p, scale: Math.round(scale * 100) / 100 }
      })
      pushProfile({ ...profile, points: next })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (d.raf != null) cancelAnimationFrame(d.raf)
      if (d.pending) setProfile(layer.id, d.pending)
      drag.current = null
      commitTransientEdit()
      if (controls) controls.enabled = true
      invalidate()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const addRingAt = (y: number) => {
    const z = Math.round(Math.min(depth, Math.max(0, (y - y0) / S)) * 10) / 10
    const base = layer.profile ?? { smooth: true, points: [{ z: 0, scale: 1 }, { z: depth, scale: 1 }] }
    setProfile(layer.id, { ...base, points: [...orderedProfile(base, depth), { z, scale: profileScaleAt(base, depth, z) }] })
  }

  const overhangs = profileOverhangs(profile, depth, Math.max(bounds.width, bounds.height) / 2)
  const ticks: number[] = []
  for (let mm = 0; mm <= depth; mm += 10) ticks.push(mm)

  return (
    <group>
      {/* the ruler bar: click to add a ring */}
      <mesh
        position={[rulerX, y0 + height / 2, cz]}
        onPointerDown={(e) => {
          e.stopPropagation()
          clickStart.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
        }}
        onPointerUp={(e) => {
          const start = clickStart.current
          clickStart.current = null
          if (!start || Math.hypot(e.nativeEvent.clientX - start.x, e.nativeEvent.clientY - start.y) > 4) return
          e.stopPropagation()
          addRingAt(e.point.y)
        }}
      >
        <boxGeometry args={[handle * 0.9, height, handle * 0.9]} />
        <meshBasicMaterial color="#3b3c48" transparent opacity={0.9} />
      </mesh>
      {ticks.map((mm) => (
        <mesh key={mm} position={[rulerX + handle * (mm % 50 === 0 ? 1.1 : 0.8), y0 + mm * S, cz]}>
          <boxGeometry args={[handle * (mm % 50 === 0 ? 1.2 : 0.6), 0.004, handle * 0.3]} />
          <meshBasicMaterial color="#8b8b95" />
        </mesh>
      ))}
      {overhangs.map((o, i) => (
        <mesh key={`o${i}`} position={[rulerX - handle * 0.9, y0 + ((o.from + o.to) / 2) * S, cz]}>
          <boxGeometry args={[handle * 0.4, (o.to - o.from) * S, handle * 0.4]} />
          <meshBasicMaterial color="#ffb648" />
        </mesh>
      ))}
      <Html position={[rulerX, y0 - handle * 2, cz]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <span className="profile-ruler__label">0</span>
      </Html>
      <Html position={[rulerX, y0 + height + handle * 2, cz]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <span className="profile-ruler__label">{Math.round(depth)} mm</span>
      </Html>

      {points.map((p, i) => {
        const y = y0 + p.z * S
        return (
          <group key={i}>
            {/* the ring itself, drawn on the shape */}
            <lineLoop geometry={ringGeometry(p.scale)} position={[cx, y, cz]}>
              <lineBasicMaterial color="#4d8dff" transparent opacity={0.9} depthTest={false} />
            </lineLoop>
            {/* height handle on the ruler */}
            <mesh position={[rulerX, y, cz]} onPointerDown={(e) => startDrag(e, i, 'height')}>
              <boxGeometry args={[handle * 2.2, handle * 1.2, handle * 2.2]} />
              <meshStandardMaterial color="#4d8dff" emissive="#4d8dff" emissiveIntensity={0.35} />
            </mesh>
            {/* width handle beside the shape */}
            <mesh position={[cx, y, cz + halfD * p.scale + handle * 1.5]} onPointerDown={(e) => startDrag(e, i, 'width')}>
              <boxGeometry args={[handle * 1.6, handle * 1.6, handle * 1.6]} />
              <meshStandardMaterial color="#ffffff" emissive="#4d8dff" emissiveIntensity={0.25} />
            </mesh>
            <Html position={[rulerX + handle * 3, y, cz]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none', transform: 'translate(0, -50%)' }}>
              <span className="profile-ruler__label profile-ruler__label--ring">
                {Math.round(p.z * 10) / 10} mm · {Math.round(p.scale * 100)}%
              </span>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
