import { difference, intersection, union, type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { ShapeLayer } from '../../types/document'
import { rotatedLocalPoints } from '../../state/documentStore'
import { layerZRange } from './layerGeometry'

export type SupportSeverity = 'critical' | 'partial'

export interface SupportWarning {
  id: string
  severity: SupportSeverity
  /** 0..1 share of the shape's own footprint that rests on real material. */
  supportedFraction: number
  supporterIds: string[]
}

/** Floating-point slack when deciding whether two Z values touch. */
const CONTACT_EPSILON_MM = 0.05
/** Below this share of its own area a shape is effectively floating. */
const NEGLIGIBLE_CONTACT = 0.03
/** At or above this share it counts as fully attached. */
const FULLY_SUPPORTED = 0.98
const MIN_FOOTPRINT_AREA = 1e-6

function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(sum) / 2
}

function area(mp: MultiPolygon): number {
  let total = 0
  for (const poly of mp) {
    total += ringArea(poly[0])
    for (let i = 1; i < poly.length; i++) total -= ringArea(poly[i])
  }
  return total
}

/** World-space 2D outline of a shape (with its Z-spin applied). */
function footprint(layer: ShapeLayer): MultiPolygon {
  const { x, y } = layer.transform
  const toRing = (pts: { x: number; y: number }[]): Ring => {
    const ring: Ring = rotatedLocalPoints(layer, pts).map((p) => [p.x + x, p.y + y])
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0])
    return ring
  }
  return layer.regions.map((r): Polygon => [toRing(r.outer.points), ...r.holes.map((h) => toRing(h.points))])
}

/**
 * Read-only check of whether each solid actually rests on material below
 * it, evaluated against every shape's real current position. Never moves
 * anything. A shape on the bed is always fine; otherwise it needs at least
 * one supporter whose own material spans the height where its bottom sits,
 * and enough of its footprint must land on those supporters' top surfaces
 * (with any hole that opens a supporter's top surface punched out first —
 * nothing rests inside empty space).
 */
export function analyzeSupport(layers: Record<string, ShapeLayer>, order: string[]): SupportWarning[] {
  const solids = order
    .map((id) => layers[id])
    .filter((l): l is ShapeLayer => !!l && !l.isHole && l.visible)
    .map((layer) => ({ layer, fp: footprint(layer), z: layerZRange(layer) }))
    .filter((s) => area(s.fp) > MIN_FOOTPRINT_AREA)
  const holes = order.map((id) => layers[id]).filter((l): l is ShapeLayer => !!l && l.isHole && l.visible)

  const warnings: SupportWarning[] = []
  for (const shape of solids) {
    if (shape.z.bottomZ <= CONTACT_EPSILON_MM) continue

    const supporters = solids.filter(
      (s) =>
        s !== shape &&
        s.z.bottomZ <= shape.z.bottomZ + CONTACT_EPSILON_MM &&
        s.z.topZ >= shape.z.bottomZ - CONTACT_EPSILON_MM,
    )
    if (supporters.length === 0) {
      warnings.push({ id: shape.layer.id, severity: 'critical', supportedFraction: 0, supporterIds: [] })
      continue
    }

    let contact: MultiPolygon = []
    for (const sup of supporters) {
      let top: MultiPolygon = sup.fp
      for (const hole of holes) {
        const holeBottom = hole.transform.z
        const holeTop = hole.transform.z + hole.extrusionDepth
        // Only a hole that actually reaches the supporter's top surface
        // opens it up; a pocket that stops short leaves the top intact.
        if (holeBottom <= sup.z.topZ + CONTACT_EPSILON_MM && holeTop >= sup.z.topZ - CONTACT_EPSILON_MM) {
          top = difference(top, footprint(hole))
        }
      }
      contact = contact.length ? union(contact, top) : top
    }
    const supported = area(intersection(contact, shape.fp))
    const fraction = supported / area(shape.fp)
    if (fraction < NEGLIGIBLE_CONTACT) {
      warnings.push({ id: shape.layer.id, severity: 'critical', supportedFraction: fraction, supporterIds: supporters.map((s) => s.layer.id) })
    } else if (fraction < FULLY_SUPPORTED) {
      warnings.push({ id: shape.layer.id, severity: 'partial', supportedFraction: fraction, supporterIds: supporters.map((s) => s.layer.id) })
    }
  }
  return warnings
}
