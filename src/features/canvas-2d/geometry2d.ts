import type { Bounds, Point2 } from '../../types/document'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Turns a free-form drag (start -> current, possibly negative in either
 * axis) into a normalized, positive-size Bounds. Shift constrains it to a
 * square using the larger of the two axes, keeping the drag's direction. */
export function normalizeDraftBounds(start: Point2, current: Point2, square: boolean): Bounds {
  let w = current.x - start.x
  let h = current.y - start.y
  if (square) {
    const size = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * size
    h = Math.sign(h || 1) * size
  }
  return {
    x: Math.min(start.x, start.x + w),
    y: Math.min(start.y, start.y + h),
    width: Math.abs(w),
    height: Math.abs(h),
  }
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

const MIN_SHAPE_SIZE = 2

/** `uniform` (held with Shift) locks the resize to the shape's original
 * aspect ratio using the larger of the two proposed dimensions, keeping
 * the corner opposite the dragged handle fixed as the anchor — same
 * convention as every design tool's Shift-resize. */
export function computeResizedBounds(start: Bounds, handle: ResizeHandle, dx: number, dy: number, uniform = false): Bounds {
  let { x, y, width, height } = start
  if (handle === 'se') {
    width = start.width + dx
    height = start.height + dy
  } else if (handle === 'nw') {
    x = start.x + dx
    y = start.y + dy
    width = start.width - dx
    height = start.height - dy
  } else if (handle === 'ne') {
    y = start.y + dy
    width = start.width + dx
    height = start.height - dy
  } else {
    x = start.x + dx
    width = start.width - dx
    height = start.height + dy
  }

  if (uniform) {
    const size = Math.max(width, height, MIN_SHAPE_SIZE)
    if (handle === 'nw' || handle === 'sw') x = start.x + start.width - size
    if (handle === 'nw' || handle === 'ne') y = start.y + start.height - size
    return { x, y, width: size, height: size }
  }

  if (width < MIN_SHAPE_SIZE) {
    if (handle === 'nw' || handle === 'sw') x = start.x + start.width - MIN_SHAPE_SIZE
    width = MIN_SHAPE_SIZE
  }
  if (height < MIN_SHAPE_SIZE) {
    if (handle === 'nw' || handle === 'ne') y = start.y + start.height - MIN_SHAPE_SIZE
    height = MIN_SHAPE_SIZE
  }
  return { x, y, width, height }
}

export function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of list) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
