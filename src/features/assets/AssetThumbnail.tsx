import { useMemo } from 'react'
import type { AssetDefinition } from '../../lib/assets/types'
import { createShapeRegions, regionsToSvgPath } from '../../lib/geometry/primitives'
import { buildShellCavity } from '../../lib/geometry/shell'
import type { ShapeLayer } from '../../types/document'

/** A top-down drawing of an asset from its own parts: solids filled,
 * cutters as red outlines, cavities as a dashed inner line. */
export function AssetThumbnail({ asset }: { asset: AssetDefinition }) {
  const items = useMemo(() => {
    const out: { d: string; fill: string; stroke?: string; dashed?: boolean }[] = []
    for (const part of asset.parts) {
      const regions = part.regions ?? createShapeRegions(part.kind, part.width, part.height, { sides: part.polygonSides, starPoints: part.starPoints, starInnerRatio: part.starInnerRatio })
      const shifted = regions.map((r) => ({ outer: { points: r.outer.points.map((p) => ({ x: p.x + part.x, y: p.y + part.y })) }, holes: r.holes.map((h) => ({ points: h.points.map((p) => ({ x: p.x + part.x, y: p.y + part.y })) })) }))
      if (part.isHole) out.push({ d: regionsToSvgPath(shifted), fill: 'none', stroke: 'var(--danger)' })
      else out.push({ d: regionsToSvgPath(shifted), fill: part.color ?? '#4d8dff' })
      if (part.hollow && !part.isHole) {
        const fake: ShapeLayer = {
          id: 'preview',
          kind: part.kind,
          name: part.name,
          visible: true,
          locked: false,
          color: '#000',
          transform: { x: part.x, y: part.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
          regions,
          extrusionDepth: part.depth,
          cornerRadius: part.cornerRadius ?? 0,
          smartPolish: part.smartPolish ?? 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: false,
        }
        const cavity = buildShellCavity(fake, part.hollow)
        if (cavity) {
          const cav = cavity.regions.map((r) => ({ outer: { points: r.outer.points.map((p) => ({ x: p.x + cavity.x, y: p.y + cavity.y })) }, holes: [] }))
          out.push({ d: regionsToSvgPath(cav), fill: 'rgba(0,0,0,0.22)', stroke: 'rgba(255,255,255,0.35)', dashed: true })
        }
      }
    }
    return out
  }, [asset])
  const pad = Math.max(asset.width, asset.height) * 0.1
  const strokeW = Math.max(asset.width, asset.height) / 60
  return (
    <svg className="asset-card__thumb" viewBox={`${-pad} ${-pad} ${asset.width + pad * 2} ${asset.height + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {items.map((it, i) => (
        <path key={i} d={it.d} fillRule="evenodd" fill={it.fill} stroke={it.stroke} strokeWidth={it.stroke ? strokeW : 0} strokeDasharray={it.dashed ? `${strokeW * 2} ${strokeW * 2}` : undefined} />
      ))}
    </svg>
  )
}
