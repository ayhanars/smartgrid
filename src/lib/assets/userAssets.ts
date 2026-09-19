import type { ShapeLayer } from '../../types/document'
import { contourBounds } from '../geometry/primitives'
import type { AssetDefinition, AssetPart } from './types'

const STORAGE_KEY = 'smartgrid:assets'

export function loadUserAssets(): AssetDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AssetDefinition[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveUserAssets(assets: AssetDefinition[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assets))
  } catch {
    /* quota or private mode: the asset just won't persist */
  }
}

/**
 * Turns the selected layers into an asset: every shape keeps its exact
 * outline and settings, positions become relative to the selection's
 * top-left, and a hollowed shape's cavity is folded back into a `hollow`
 * setting on its solid so it regenerates when the asset is placed.
 */
export function captureAsset(name: string, layers: Record<string, ShapeLayer>, order: string[], selection: string[]): AssetDefinition | null {
  const picked = order.filter((id) => selection.includes(id) && layers[id])
  if (picked.length === 0) return null
  const cavities = new Map<string, ShapeLayer>()
  for (const id of picked) {
    const l = layers[id]
    if (l.shellOf && picked.includes(l.shellOf.solidId)) cavities.set(l.shellOf.solidId, l)
  }
  const bounds = picked
    .filter((id) => !cavities.has(layers[id].shellOf?.solidId ?? '') || !layers[id].shellOf)
    .map((id) => {
      const l = layers[id]
      const b = contourBounds(l.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)]))
      return { x: l.transform.x + b.x, y: l.transform.y + b.y, w: b.width, h: b.height }
    })
  const minX = Math.min(...bounds.map((b) => b.x))
  const minY = Math.min(...bounds.map((b) => b.y))
  const maxX = Math.max(...bounds.map((b) => b.x + b.w))
  const maxY = Math.max(...bounds.map((b) => b.y + b.h))

  const parts: AssetPart[] = []
  for (const id of picked) {
    const l = layers[id]
    if (l.shellOf && cavities.get(l.shellOf.solidId) === l) continue
    const b = contourBounds(l.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)]))
    const cavity = cavities.get(id)
    parts.push({
      kind: l.kind,
      name: l.name,
      x: l.transform.x + b.x - minX,
      y: l.transform.y + b.y - minY,
      width: b.width,
      height: b.height,
      depth: l.extrusionDepth,
      z: l.transform.z,
      rotation: l.transform.rotation || undefined,
      color: l.color,
      cornerRadius: l.cornerRadius || undefined,
      smartPolish: l.smartPolish || undefined,
      bevelBottom: l.bevelBottom || undefined,
      bevelTop: l.bevelTop || undefined,
      polygonSides: l.polygonSides,
      starPoints: l.starPoints,
      starInnerRatio: l.starInnerRatio,
      isHole: l.isHole || undefined,
      bevelMode: l.bevelMode,
      texture: l.texture,
      perforation: l.perforation,
      hollow: cavity?.shellOf ? { wall: cavity.shellOf.wall, floor: cavity.shellOf.floor, openFrom: cavity.shellOf.openFrom } : undefined,
      regions: l.regions.map((r) => ({ outer: { points: r.outer.points.map((p) => ({ x: p.x - b.x, y: p.y - b.y })) }, holes: r.holes.map((h) => ({ points: h.points.map((p) => ({ x: p.x - b.x, y: p.y - b.y })) })) })),
    })
  }
  return {
    id: `user-${Date.now().toString(36)}`,
    name: name.trim() || 'My asset',
    category: 'My assets',
    description: `${parts.length} shape${parts.length === 1 ? '' : 's'}, saved from a selection.`,
    width: Math.round((maxX - minX) * 10) / 10,
    height: Math.round((maxY - minY) * 10) / 10,
    parts,
  }
}
