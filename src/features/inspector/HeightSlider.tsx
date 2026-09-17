import type { ShapeLayer } from '../../types/document'
import { useDocumentStore } from '../../state/documentStore'

const STEP_MM = 0.1
/** Fixed floor for the range so a bed with ~0 height still gives a usable
 * slider — deliberately NOT derived from the object's own current z (a
 * range that grew with the value would let every drag nudge the max up and
 * run away). */
const MIN_RANGE_MM = 50

interface HeightSliderProps {
  layer: ShapeLayer
  /** Every selected shape, so a grouped selection lifts together. */
  selectionIds: string[]
  bedMaxZ: number
}

export function HeightSlider({ layer, selectionIds, bedMaxZ }: HeightSliderProps) {
  const layers = useDocumentStore((s) => s.layers)
  const setLayerZ = useDocumentStore((s) => s.setLayerZ)
  const beginTransientEdit = useDocumentStore((s) => s.beginTransientEdit)
  const commitTransientEdit = useDocumentStore((s) => s.commitTransientEdit)

  const max = Math.max(bedMaxZ, MIN_RANGE_MM)
  // Display-only clamp: a z typed above the range just pins the thumb at
  // the top without touching the stored value.
  const shown = Math.min(layer.transform.z, max)

  const apply = (next: number) => {
    const delta = next - layer.transform.z
    for (const id of selectionIds) {
      const l = layers[id]
      if (l) setLayerZ(id, Math.max(0, l.transform.z + delta))
    }
  }

  return (
    <div className="height-slider">
      <input
        type="range"
        min={0}
        max={max}
        step={STEP_MM}
        value={shown}
        disabled={layer.locked}
        aria-label="Height"
        onPointerDown={beginTransientEdit}
        onPointerUp={commitTransientEdit}
        onPointerCancel={commitTransientEdit}
        onChange={(e) => apply(parseFloat(e.target.value))}
      />
      <span className="height-slider__value">{layer.transform.z.toFixed(1)} mm</span>
    </div>
  )
}
