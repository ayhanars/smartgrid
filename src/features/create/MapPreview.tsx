import type { MapPreview as MapPreviewData } from '../../lib/products/cityMap'
import type { ShapeRegion } from '../../types/document'

/**
 * The city map seen from above, as it will print: the plate, the window
 * the map fills, and each layer in its colour. Redraws as the place,
 * the area or the layers change.
 */
export function MapPreview({ preview, large = false }: { preview: MapPreviewData; large?: boolean }) {
  const box = large ? 520 : 300
  const pad = 4
  const scale = box / (preview.width + 2 * pad)
  const px = (v: number) => ((v + pad) * scale).toFixed(2)
  const d = (regions: ShapeRegion[]) => regions.map((r) => [r.outer, ...r.holes].map((c) => 'M' + c.points.map((p) => `${px(p.x)} ${px(p.y)}`).join('L') + 'Z').join('')).join('')
  const plate = 'M' + preview.plate.map((p) => `${px(p.x)} ${px(p.y)}`).join('L') + 'Z'
  const win = 'M' + preview.window.map((p) => `${px(p.x)} ${px(p.y)}`).join('L') + 'Z'
  return (
    <div className={`map-preview ${large ? 'map-preview--large' : ''}`}>
      <svg viewBox={`0 0 ${box} ${box}`} width={box} height={box} role="img" aria-label="Map preview">
        <path d={plate} className="map-preview__plate" />
        <path d={win} className="map-preview__window" />
        {preview.layers.map((l) => (
          <path key={l.name} d={d(l.regions)} fill={l.color} fillRule="evenodd" stroke={l.color} strokeWidth="0.3" />
        ))}
        {preview.label && <path d={d(preview.label)} fill="#ffffff" fillRule="evenodd" />}
      </svg>
      <p className="map-preview__caption">{preview.caption}</p>
    </div>
  )
}
