import type { TrayPreview as TrayPreviewData } from '../../lib/products'

/**
 * The drawer simulator: the tray from above with its compartments, the
 * tiles it is cut into for the bed (one colour each) and the clips on
 * the seams. Redraws as the specs change.
 */
export function TrayPreview({ preview }: { preview: TrayPreviewData }) {
  const { width, depth, cells, tiles, joints } = preview
  const pad = 6
  const scale = Math.min(460 / (width + 2 * pad), 220 / (depth + 2 * pad))
  const px = (v: number) => (v + pad) * scale
  const w = (width + 2 * pad) * scale
  const h = (depth + 2 * pad) * scale
  const many = tiles.length > 1
  return (
    <figure className="board-preview">
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: Math.min(200, h) }} role="img" aria-label={preview.caption ?? 'Tray preview'}>
        <rect x={0} y={0} width={w} height={h} className="board-preview__sheet" />
        {tiles.map((t, i) => (
          <rect key={`t${i}`} x={px(t.x)} y={px(t.y)} width={t.width * scale} height={t.height * scale} className={`tray-preview__tile ${many ? `tray-preview__tile--${i % 5}` : ''}`} />
        ))}
        {cells.map((c, i) => (
          <rect key={`c${i}`} x={px(c.x)} y={px(c.y)} width={c.width * scale} height={c.height * scale} className="tray-preview__cell" />
        ))}
        {many &&
          tiles.map((t, i) => (
            <text key={`n${i}`} x={px(t.x + t.width / 2)} y={px(t.y + t.height / 2)} className="tray-preview__label" textAnchor="middle" dominantBaseline="middle">
              {i + 1}
            </text>
          ))}
        {(joints ?? []).map((j, i) => (
          <circle key={`j${i}`} cx={px(j.x)} cy={px(j.y)} r={Math.max(3, 3 * scale)} className="tray-preview__joint" />
        ))}
      </svg>
      {preview.caption && <figcaption>{preview.caption}</figcaption>}
    </figure>
  )
}
