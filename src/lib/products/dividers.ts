import type { PartRecipe } from './types'

/** Evenly spaced walls across an open box's inside, floor to just under
 * the rim, each overlapping the box's walls and floor a little so they
 * fuse into one body. `boxY` is the box outline's top on the canvas. */
export function dividerParts(o: { count: number; width: number; depth: number; height: number; wall: number; boxY: number; color: string }): PartRecipe[] {
  const { count, width, depth, height, wall, boxY, color } = o
  const inner = width - 2 * wall
  if (count <= 0 || inner < wall * 3) return []
  const parts: PartRecipe[] = []
  for (let k = 1; k <= count; k++) {
    const cx = wall + (inner * k) / (count + 1)
    parts.push({
      name: count === 1 ? 'Divider' : `Divider ${k}`,
      color,
      outline: { kind: 'rect', x: cx - wall / 2, y: boxY + wall - 0.5, width: wall, height: depth - 2 * wall + 1 },
      depth: Math.max(2, height - 2),
      z: 0,
    })
  }
  return parts
}
