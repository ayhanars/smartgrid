import { useRef } from 'react'
import * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { useDocumentStore } from '../../state/documentStore'
import { layerPrintQuaternion, printQuaternionToEuler } from '../../lib/geometry/layerGeometry'
import './RotationDial.css'

const SIZE = 132
const CENTER = SIZE / 2
const RADIUS = 60
/** Pointer distance from center (as a fraction of RADIUS) at or beyond
 * which a drag is on the roll ring rather than inside the orbit ball. */
const RING_FRACTION = 0.68
const ORBIT_DEG_PER_PX = 0.5

type Drag =
  | { mode: 'roll'; lastAngle: number; cumulative: number }
  | { mode: 'orbit'; q: THREE.Quaternion; lastX: number; lastY: number }

/**
 * One control that orients an object about all three axes with no mode
 * switch: the outer ring rolls it about its own Z (accumulated angle
 * deltas, so multi-turn spins work), the inner ball orbits it by
 * premultiplying world-axis yaw/pitch quaternions onto its current
 * orientation — done in world space so a horizontal drag still yaws "on
 * screen" once the object is tilted, instead of fighting its local frame.
 */
export function RotationDial({ layer, size = SIZE }: { layer: ShapeLayer; size?: number }) {
  const setRotation = useDocumentStore((s) => s.setRotation)
  const beginTransientEdit = useDocumentStore((s) => s.beginTransientEdit)
  const commitTransientEdit = useDocumentStore((s) => s.commitTransientEdit)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)

  const localPoint = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * SIZE - CENTER, y: ((e.clientY - rect.top) / rect.height) * SIZE - CENTER }
  }
  const angleDeg = (p: { x: number; y: number }) => (Math.atan2(p.y, p.x) * 180) / Math.PI

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (layer.locked) return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const p = localPoint(e)
    const fraction = Math.hypot(p.x, p.y) / RADIUS
    beginTransientEdit()
    if (fraction >= RING_FRACTION) {
      dragRef.current = { mode: 'roll', lastAngle: angleDeg(p), cumulative: layer.transform.rotation }
    } else {
      dragRef.current = { mode: 'orbit', q: layerPrintQuaternion(layer), lastX: e.clientX, lastY: e.clientY }
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'roll') {
      const angle = angleDeg(localPoint(e))
      let delta = angle - drag.lastAngle
      // Unwrap so crossing the ±180° seam is a small step, not a full turn.
      if (delta > 180) delta -= 360
      else if (delta < -180) delta += 360
      drag.lastAngle = angle
      drag.cumulative += delta
      setRotation(layer.id, { z: drag.cumulative })
    } else {
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (dx * ORBIT_DEG_PER_PX * Math.PI) / 180)
      const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (dy * ORBIT_DEG_PER_PX * Math.PI) / 180)
      drag.q = yaw.multiply(pitch).multiply(drag.q)
      setRotation(layer.id, printQuaternionToEuler(drag.q))
    }
  }

  const onPointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    commitTransientEdit()
  }

  // Ring marker at the current roll angle; ball marker = where the
  // object's "up" vector lands when projected onto the plate, so a tilt
  // visibly pulls the dot off center in the direction of the lean.
  const rollRad = (layer.transform.rotation * Math.PI) / 180
  const marker = { x: CENTER + Math.cos(rollRad) * (RADIUS - 9), y: CENTER + Math.sin(rollRad) * (RADIUS - 9) }
  const up = new THREE.Vector3(0, 0, 1).applyQuaternion(layerPrintQuaternion(layer))
  const ballR = RADIUS * RING_FRACTION - 4
  const tiltDot = { x: CENTER + up.x * ballR, y: CENTER - up.y * ballR }

  return (
    <svg
      ref={svgRef}
      className={`rotation-dial ${layer.locked ? 'rotation-dial--locked' : ''}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      aria-label="Rotation dial"
      aria-valuenow={Math.round(layer.transform.rotation)}
    >
      <circle className="rotation-dial__ring" cx={CENTER} cy={CENTER} r={(RADIUS + RADIUS * RING_FRACTION) / 2} strokeWidth={RADIUS * (1 - RING_FRACTION)} />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2
        const inner = RADIUS - (i % 6 === 0 ? 13 : 8)
        return (
          <line
            key={i}
            className="rotation-dial__tick"
            x1={CENTER + Math.cos(a) * inner}
            y1={CENTER + Math.sin(a) * inner}
            x2={CENTER + Math.cos(a) * (RADIUS - 2)}
            y2={CENTER + Math.sin(a) * (RADIUS - 2)}
          />
        )
      })}
      <circle className="rotation-dial__ball" cx={CENTER} cy={CENTER} r={RADIUS * RING_FRACTION - 1} />
      <line className="rotation-dial__axis" x1={CENTER - ballR} y1={CENTER} x2={CENTER + ballR} y2={CENTER} />
      <line className="rotation-dial__axis" x1={CENTER} y1={CENTER - ballR} x2={CENTER} y2={CENTER + ballR} />
      <line className="rotation-dial__tilt-line" x1={CENTER} y1={CENTER} x2={tiltDot.x} y2={tiltDot.y} />
      <circle className="rotation-dial__tilt-dot" cx={tiltDot.x} cy={tiltDot.y} r={5} />
      <circle className="rotation-dial__marker" cx={marker.x} cy={marker.y} r={5} />
    </svg>
  )
}
