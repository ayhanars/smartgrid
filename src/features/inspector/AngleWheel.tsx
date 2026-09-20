import { useRef } from 'react'
import './RotationDial.css'

const SIZE = 132
const C = SIZE / 2
const R = 60

/**
 * A wheel for one angle: drag anywhere on it and the needle follows the
 * pointer. The needle shows the direction the pattern's lines run (0° is
 * straight up), so the control reads like the result. Angles are folded
 * into −90..90 — a groove direction has no front or back — and snap to
 * 5°, or 1° with Shift.
 */
export function AngleWheel({
  value,
  onChange,
  onStart,
  onEnd,
  size = 96,
  label = 'Angle',
  fold = true,
}: {
  value: number
  onChange: (deg: number) => void
  onStart?: () => void
  onEnd?: () => void
  size?: number
  label?: string
  /** Fold the angle into −90..90 (a line's direction). Off: −180..180,
   * for a turn that has a direction (a twist). */
  fold?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const angleFrom = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - C
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - C
    // 0° up, positive clockwise (leaning right), folded to −90..90.
    let deg = (Math.atan2(x, -y) * 180) / Math.PI
    if (fold) {
      if (deg > 90) deg -= 180
      else if (deg < -90) deg += 180
    }
    const step = e.shiftKey ? 1 : 5
    const limit = fold ? 90 : 180
    return Math.max(-limit, Math.min(limit, Math.round(deg / step) * step))
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    dragging.current = true
    onStart?.()
    onChange(angleFrom(e))
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging.current) onChange(angleFrom(e))
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    onEnd?.()
  }

  const rad = (value * Math.PI) / 180
  const dx = Math.sin(rad) * (R - 10)
  const dy = -Math.cos(rad) * (R - 10)
  // Three parallel strokes hint at the pattern's lines at this angle.
  const px = Math.cos(rad) * 12
  const py = Math.sin(rad) * 12

  return (
    <svg
      ref={svgRef}
      className="rotation-dial angle-wheel"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="slider"
      aria-label={label}
      aria-valuemin={fold ? -90 : -180}
      aria-valuemax={fold ? 90 : 180}
      aria-valuenow={Math.round(value)}
    >
      <circle className="rotation-dial__ball" cx={C} cy={C} r={R} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        const inner = R - (i % 3 === 0 ? 9 : 5)
        return <line key={i} className="rotation-dial__tick" x1={C + Math.cos(a) * inner} y1={C + Math.sin(a) * inner} x2={C + Math.cos(a) * (R - 1)} y2={C + Math.sin(a) * (R - 1)} />
      })}
      <line className="rotation-dial__axis" x1={C} y1={C - R + 12} x2={C} y2={C + R - 12} />
      {fold &&
        [-1, 1].map((k) => (
          <line key={k} className="rotation-dial__tilt-line" x1={C + k * px + dx * 0.6} y1={C + k * py + dy * 0.6} x2={C + k * px - dx * 0.6} y2={C + k * py - dy * 0.6} />
        ))}
      {!fold && Math.abs(value) > 0.5 && (
        <path
          className="angle-wheel__arc"
          d={`M ${C} ${C - (R - 22)} A ${R - 22} ${R - 22} 0 ${Math.abs(value) > 180 ? 1 : 0} ${value > 0 ? 1 : 0} ${C + Math.sin(rad) * (R - 22)} ${C - Math.cos(rad) * (R - 22)}`}
        />
      )}
      <line className="angle-wheel__needle" x1={fold ? C - dx : C} y1={fold ? C - dy : C} x2={C + dx} y2={C + dy} />
      <circle className="rotation-dial__marker" cx={C + dx} cy={C + dy} r={5} />
    </svg>
  )
}
