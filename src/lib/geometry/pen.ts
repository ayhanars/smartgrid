import type { Point2 } from '../../types/document'

export type PenAnchorType = 'corner' | 'smooth' | 'symmetric'

export interface PenAnchor {
  point: Point2
  /** Absolute position of the incoming/outgoing control point — undefined
   * means that side is a straight line, not a curve. */
  handleIn?: Point2
  handleOut?: Point2
  type: PenAnchorType
}

function cubicBezierPoint(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

const CURVE_SEGMENTS = 16

/** Flattens a pen path's anchors into a plain polygon point list, sampling
 * a cubic bezier between any pair of anchors where either side has a
 * handle, and just connecting the two points directly where neither does.
 * `closed` also flattens the segment from the last anchor back to the
 * first, for a finished shape; leave it false while still drafting an
 * open path. */
export function flattenPenAnchors(anchors: PenAnchor[], closed: boolean): Point2[] {
  if (anchors.length === 0) return []
  if (anchors.length === 1) return [anchors[0].point]

  const result: Point2[] = [anchors[0].point]
  const segmentCount = closed ? anchors.length : anchors.length - 1

  for (let i = 0; i < segmentCount; i++) {
    const a = anchors[i]
    const b = anchors[(i + 1) % anchors.length]
    if (!a.handleOut && !b.handleIn) {
      result.push(b.point)
    } else {
      const p1 = a.handleOut ?? a.point
      const p2 = b.handleIn ?? b.point
      for (let s = 1; s <= CURVE_SEGMENTS; s++) {
        result.push(cubicBezierPoint(a.point, p1, p2, b.point, s / CURVE_SEGMENTS))
      }
    }
  }

  return result
}
