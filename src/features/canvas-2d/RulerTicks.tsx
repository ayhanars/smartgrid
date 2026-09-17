import type { Point2 } from '../../types/document'

const RULER_SIZE = 20
const TARGET_MAJOR_SPACING_PX = 70

/** Picks a "nice" (1/2/5 × 10^n) mm interval between major ticks so the
 * ruler always reads cleanly regardless of zoom, instead of showing
 * awkward spacings like every 37mm. */
function niceStep(zoom: number): number {
  const rawStep = TARGET_MAJOR_SPACING_PX / zoom
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const niceResidual = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1
  return niceResidual * magnitude
}

interface RulerTicksProps {
  orientation: 'horizontal' | 'vertical'
  lengthPx: number
  zoom: number
  pan: Point2
}

/** Renders calibrated mm tick marks + labels along one ruler, positioned to
 * exactly track the canvas's own pan/zoom (same doc-to-screen math as the
 * artboard itself) so a tick always lines up with the document position it
 * labels. */
export function RulerTicks({ orientation, lengthPx, zoom, pan }: RulerTicksProps) {
  if (lengthPx <= 0) return null

  const panOffset = orientation === 'horizontal' ? pan.x : pan.y
  const toScreen = (doc: number) => doc * zoom + panOffset
  const toDoc = (screen: number) => (screen - panOffset) / zoom

  const step = niceStep(zoom)
  const minorStep = step / 5
  const startDoc = toDoc(0)
  const endDoc = toDoc(lengthPx)

  const majors: number[] = []
  for (let v = Math.floor(startDoc / step) * step; v <= endDoc + step; v += step) majors.push(v)

  const minors: number[] = []
  for (let v = Math.floor(startDoc / minorStep) * minorStep; v <= endDoc + minorStep; v += minorStep) minors.push(v)

  const isHorizontal = orientation === 'horizontal'

  return (
    <svg
      className="ruler-ticks"
      width={isHorizontal ? lengthPx : RULER_SIZE}
      height={isHorizontal ? RULER_SIZE : lengthPx}
    >
      {minors.map((v) => {
        const pos = toScreen(v)
        return isHorizontal ? (
          <line key={v} x1={pos} y1={RULER_SIZE - 5} x2={pos} y2={RULER_SIZE} className="ruler-ticks__minor" />
        ) : (
          <line key={v} x1={RULER_SIZE - 5} y1={pos} x2={RULER_SIZE} y2={pos} className="ruler-ticks__minor" />
        )
      })}
      {majors.map((v) => {
        const pos = toScreen(v)
        const label = Math.round(v * 100) / 100
        return isHorizontal ? (
          <g key={v}>
            <line x1={pos} y1={0} x2={pos} y2={RULER_SIZE} className="ruler-ticks__major" />
            <text x={pos + 3} y={11} className="ruler-ticks__label">
              {label}
            </text>
          </g>
        ) : (
          <g key={v}>
            <line x1={0} y1={pos} x2={RULER_SIZE} y2={pos} className="ruler-ticks__major" />
            <text x={13} y={pos - 3} className="ruler-ticks__label" transform={`rotate(-90 13 ${pos - 3})`}>
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
