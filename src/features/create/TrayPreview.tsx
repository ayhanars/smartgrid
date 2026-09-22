import type { TrayPreview as TrayPreviewData } from '../../lib/products'

/**
 * The drawer simulator: the tray from above with real wall thickness,
 * the tiles it is cut into for the bed (one colour each), the clips on
 * the seams; and, underneath, one wall seen from the side with its
 * height, hole pattern and notches. Redraws as the specs change.
 */
export function TrayPreview({ preview, large = false }: { preview: TrayPreviewData; large?: boolean }) {
  const box = large ? { w: 920, top: 330, cap: 470 } : { w: 460, top: 150, cap: 230 }
  const { width, depth, cells, walls, tiles, joints, elevation } = preview
  const pad = 6
  const many = tiles.length > 1
  const topH = box.top
  const scale = Math.min(box.w / (width + 2 * pad), topH / (depth + 2 * pad))
  const px = (v: number) => (v + pad) * scale
  const w = (width + 2 * pad) * scale
  const h = (depth + 2 * pad) * scale
  const minWall = 1.5
  // Elevation under the plan, at its own scale.
  const elevGap = 10
  const ew = elevation ? Math.min(box.w, elevation.length * Math.min(scale, box.w / elevation.length)) : 0
  const es = elevation ? ew / elevation.length : 1
  const eh = elevation ? Math.max(14, Math.min(large ? 110 : 60, elevation.height * es)) : 0
  const esY = elevation ? eh / elevation.height : 1
  const total = h + (elevation ? elevGap + eh + 14 : 0)
  const holeDots = () => {
    if (!elevation?.holes) return null
    const { shape, size, spacing, inset } = elevation.holes
    const dots = []
    const rowPitch = shape === 'hex' || shape === 'round' ? spacing * 0.866 : spacing
    let row = 0
    for (let y = inset + size / 2; y <= elevation.height - inset - size / 2; y += rowPitch, row++) {
      const shift = (shape === 'hex' || shape === 'round') && row % 2 ? spacing / 2 : 0
      for (let x = inset + size / 2 + shift; x <= elevation.length - inset - size / 2; x += spacing) {
        const cx = x * es
        const cy = h + elevGap + eh - y * esY
        const r = Math.max(1, (size / 2) * es)
        if (shape === 'slot') dots.push(<rect key={`${x}-${y}`} x={cx - r / 2} y={cy - r * 1.5} width={r} height={r * 3} rx={r / 2} className="tray-preview__hole" />)
        else if (shape === 'square') dots.push(<rect key={`${x}-${y}`} x={cx - r} y={cy - r} width={2 * r} height={2 * r} className="tray-preview__hole" />)
        else if (shape === 'hex') dots.push(<polygon key={`${x}-${y}`} points={Array.from({ length: 6 }, (_, i) => `${cx + r * Math.cos((Math.PI / 3) * i)},${cy + r * Math.sin((Math.PI / 3) * i)}`).join(' ')} className="tray-preview__hole" />)
        else dots.push(<circle key={`${x}-${y}`} cx={cx} cy={cy} r={r} className="tray-preview__hole" />)
      }
    }
    return dots
  }
  return (
    <figure className="board-preview">
      <svg viewBox={`0 0 ${Math.max(w, ew)} ${total}`} style={{ width: '100%', height: Math.min(box.cap, total) }} role="img" aria-label={preview.caption ?? 'Tray preview'}>
        <rect x={0} y={0} width={w} height={h} className="board-preview__sheet" />
        {tiles.map((t, i) => (
          <rect key={`t${i}`} x={px(t.x)} y={px(t.y)} width={t.width * scale} height={t.height * scale} className={`tray-preview__tile ${many ? `tray-preview__tile--${i % 5}` : ''}`} />
        ))}
        {cells.map((c, i) => (
          <rect key={`c${i}`} x={px(c.x)} y={px(c.y)} width={c.width * scale} height={c.height * scale} className="tray-preview__floor" />
        ))}
        {walls.map((r, i) => (
          <rect key={`w${i}`} x={px(r.x) - (r.width * scale < minWall ? (minWall - r.width * scale) / 2 : 0)} y={px(r.y) - (r.height * scale < minWall ? (minWall - r.height * scale) / 2 : 0)} width={Math.max(minWall, r.width * scale)} height={Math.max(minWall, r.height * scale)} className="tray-preview__wall" />
        ))}
        {many &&
          tiles.map((t, i) => (
            <text key={`n${i}`} x={px(t.x + t.width / 2)} y={px(t.y + t.height / 2)} className="tray-preview__label" textAnchor="middle" dominantBaseline="middle">
              {i + 1}
            </text>
          ))}
        {(joints ?? []).map((j, i) => (
          <rect key={`j${i}`} x={px(j.x) - 4} y={px(j.y) - 4} width={8} height={8} rx={2} className="tray-preview__joint" />
        ))}
        {elevation && (
          <g>
            <rect x={0} y={h + elevGap} width={ew} height={eh} className="tray-preview__elev" />
            {holeDots()}
            {elevation.notches.map((n, i) => (
              <rect key={`k${i}`} x={n.x * es - (n.width * es) / 2} y={n.fromTop ? h + elevGap - 1 : h + elevGap + eh - n.depth * esY} width={Math.max(2, n.width * es)} height={n.depth * esY + 1} className="tray-preview__notch" />
            ))}
            <text x={0} y={h + elevGap + eh + 11} className="tray-preview__caption">
              {elevation.label} · {Math.round(elevation.length)} × {Math.round(elevation.height)} mm
            </text>
          </g>
        )}
      </svg>
      {preview.caption && <figcaption>{preview.caption}</figcaption>}
    </figure>
  )
}
