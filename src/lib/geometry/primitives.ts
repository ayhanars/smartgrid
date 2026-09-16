import type { Bounds, Point2, ShapeKind, ShapeRegion } from '../../types/document'

/** Regular N-gon, point-up, on the unit circle centered at the origin. */
export function regularPolygonPoints(sides: number): Point2[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + (i / sides) * Math.PI * 2
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })
}

/** A 2*points-vertex star, alternating outer (r=1) and inner (r=innerRatio)
 * vertices, point-up. */
export function starPolygonPoints(points: number, innerRatio: number): Point2[] {
  const n = points * 2
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2
    const r = i % 2 === 0 ? 1 : innerRatio
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
  })
}

export function contourBounds(points: Point2[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Remaps an arbitrary point set into a [0,w] x [0,h] box. */
export function normalizeToBounds(points: Point2[], width: number, height: number): Point2[] {
  const bounds = contourBounds(points)
  const spanX = bounds.width || 1
  const spanY = bounds.height || 1
  return points.map((p) => ({
    x: ((p.x - bounds.x) / spanX) * width,
    y: ((p.y - bounds.y) / spanY) * height,
  }))
}

const CIRCLE_SEGMENTS = 64
const DEFAULT_POLYGON_SIDES = 6
const DEFAULT_STAR_POINTS = 5
const DEFAULT_STAR_INNER_RATIO = 0.45

export function createShapeRegions(kind: ShapeKind, width: number, height: number): ShapeRegion[] {
  let points: Point2[]

  if (kind === 'rect') {
    points = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ]
  } else if (kind === 'polygon') {
    points = normalizeToBounds(regularPolygonPoints(DEFAULT_POLYGON_SIDES), width, height)
  } else if (kind === 'star') {
    points = normalizeToBounds(starPolygonPoints(DEFAULT_STAR_POINTS, DEFAULT_STAR_INNER_RATIO), width, height)
  } else {
    // circle / hole: an ellipse inscribed in width x height so a
    // Shift-constrained (square) drag still gives a perfect circle.
    const rx = width / 2
    const ry = height / 2
    points = Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      return { x: rx + Math.cos(a) * rx, y: ry + Math.sin(a) * ry }
    })
  }

  return [{ outer: { points }, holes: [] }]
}

export function pointsToSvgPath(points: Point2[]): string {
  if (!points.length) return ''
  const [first, ...rest] = points
  return `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ') + ' Z'
}

export function defaultShapeName(kind: ShapeKind): string {
  switch (kind) {
    case 'rect':
      return 'Rectangle'
    case 'circle':
      return 'Circle'
    case 'polygon':
      return 'Polygon'
    case 'star':
      return 'Star'
    case 'hole':
      return 'Hole'
  }
}
