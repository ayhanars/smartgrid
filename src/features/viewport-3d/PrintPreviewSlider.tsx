import { useRef } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { PREVIEW_LAYER_HEIGHT_MM } from '../../state/viewStore'

interface PrintPreviewSliderProps {
  /** Highest point of anything on the plate, in mm. */
  maxHeight: number
  /** Current cut height in mm. */
  value: number
  onChange: (height: number) => void
  onClose: () => void
}

const LAYER = PREVIEW_LAYER_HEIGHT_MM

/**
 * Vertical "print progress" slider: drags the cut height from the first
 * layer up to the top of the tallest shape, snapped to whole slicing
 * layers so the readout matches what a slicer would show.
 */
export function PrintPreviewSlider({ maxHeight, value, onChange, onClose }: PrintPreviewSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const layerCount = Math.max(1, Math.ceil(maxHeight / LAYER - 1e-6))
  const top = layerCount * LAYER
  const layerIndex = Math.min(layerCount, Math.max(0, Math.round(value / LAYER)))
  const fraction = layerIndex / layerCount

  const setLayer = (index: number) => onChange(Math.min(layerCount, Math.max(0, index)) * LAYER)

  const fromPointer = (clientY: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const f = 1 - (clientY - rect.top) / rect.height
    setLayer(Math.round(Math.min(1, Math.max(0, f)) * layerCount))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    trackRef.current?.setPointerCapture(e.pointerId)
    trackRef.current?.focus()
    fromPointer(e.clientY)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons & 1) fromPointer(e.clientY)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setLayer(layerIndex + step)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setLayer(layerIndex - step)
    else if (e.key === 'Home') setLayer(0)
    else if (e.key === 'End') setLayer(layerCount)
    else return
    e.preventDefault()
  }

  return (
    <div className="print-preview" role="group" aria-label="Print preview">
      <div className="print-preview__header">
        <span>Preview</span>
        <button type="button" className="print-preview__close" aria-label="Close print preview" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <button type="button" className="print-preview__step" aria-label="One layer up" onClick={() => setLayer(layerIndex + 1)}>
        <ChevronUp size={14} />
      </button>
      <div
        ref={trackRef}
        className="print-preview__track"
        role="slider"
        tabIndex={0}
        aria-label="Print height"
        aria-valuemin={0}
        aria-valuemax={layerCount}
        aria-valuenow={layerIndex}
        aria-valuetext={`layer ${layerIndex} of ${layerCount}, ${(layerIndex * LAYER).toFixed(1)} mm`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div className="print-preview__fill" style={{ height: `${fraction * 100}%` }} />
        <div className="print-preview__thumb" style={{ bottom: `${fraction * 100}%` }} />
      </div>
      <button type="button" className="print-preview__step" aria-label="One layer down" onClick={() => setLayer(layerIndex - 1)}>
        <ChevronDown size={14} />
      </button>
      <div className="print-preview__readout">
        <strong>
          {layerIndex} / {layerCount}
        </strong>
        <span>{(layerIndex * LAYER).toFixed(1)} mm</span>
        <span className="print-preview__hint">{LAYER} mm layers · {top.toFixed(1)} mm total</span>
      </div>
    </div>
  )
}
