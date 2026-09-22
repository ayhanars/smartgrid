import type { MountPreview } from '../../lib/products'
import { patternNodes } from '../../lib/products/boards'

/**
 * The fit simulator: the product seen from the back, drawn to scale on
 * a window of the pegboard, with its tabs/pegs where they meet the
 * sheet. The board is shifted so the first tab sits on a hole; the rest
 * then show whether they land on the pattern too. Redraws as the specs
 * change.
 */
export function BoardPreview({ preview, large = false }: { preview: MountPreview; large?: boolean }) {
  const box = large ? { w: 920, h: 460, cap: 440 } : { w: 460, h: 220, cap: 200 }
  const { pattern, silhouette, anchors } = preview
  const margin = Math.max(pattern.pitchX, pattern.pitchY)
  const win = { x: -margin, y: -margin, width: silhouette.width + 2 * margin, height: silhouette.height + 2 * margin }
  const first = anchors[0]
  // Grid offset so the first anchor's centre is a node.
  const offset = first ? { x: first.x + first.width / 2, y: first.y + first.height / 2 } : { x: 0, y: 0 }
  const nodes = patternNodes(pattern, win, offset)
  const onNode = (a: MountPreview['anchors'][number]) => {
    const cx = a.x + a.width / 2
    const cy = a.y + a.height / 2
    return nodes.some((n) => Math.abs(n.x - cx) < 0.5 && Math.abs(n.y - cy) < 0.5)
  }
  const scale = Math.min(box.w / win.width, box.h / win.height)
  const w = win.width * scale
  const h = win.height * scale
  const px = (v: number) => v * scale
  return (
    <figure className="board-preview">
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: Math.min(box.cap, h) }} role="img" aria-label={preview.caption ?? 'Fit preview'}>
        <rect x={0} y={0} width={w} height={h} className="board-preview__sheet" />
        {nodes.map((n, i) =>
          pattern.kind === 'round' ? (
            <circle key={i} cx={px(n.x - win.x)} cy={px(n.y - win.y)} r={px(pattern.diameter / 2)} className="board-preview__hole" />
          ) : (
            <rect
              key={i}
              x={px(n.x - win.x - pattern.slotWidth / 2)}
              y={px(n.y - win.y - pattern.slotHeight / 2)}
              width={px(pattern.slotWidth)}
              height={px(pattern.slotHeight)}
              rx={px(pattern.slotWidth / 2)}
              className="board-preview__hole"
            />
          ),
        )}
        <rect x={px(-win.x)} y={px(-win.y)} width={px(silhouette.width)} height={px(silhouette.height)} rx={px(2)} className="board-preview__silhouette" />
        {anchors.map((a, i) => {
          // The tab itself, and a ring around it so a 4 mm peg still reads.
          const cx = px(a.x + a.width / 2 - win.x)
          const cy = px(a.y + a.height / 2 - win.y)
          const cls = `board-preview__anchor ${onNode(a) ? '' : 'board-preview__anchor--off'}`
          return (
            <g key={i} className={cls}>
              <circle cx={cx} cy={cy} r={Math.max(px(Math.max(a.width, a.height) / 2) + 3, 6)} className="board-preview__anchor-ring" />
              <rect x={px(a.x - win.x)} y={px(a.y - win.y)} width={px(a.width)} height={px(a.height)} />
            </g>
          )
        })}
      </svg>
      {preview.caption && <figcaption>{preview.caption}</figcaption>}
    </figure>
  )
}
