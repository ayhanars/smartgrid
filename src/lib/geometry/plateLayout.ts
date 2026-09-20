/**
 * Where each build plate of a multi-plate project sits, in mm: the same
 * layout Bambu Studio uses — plates one fifth of a plate apart in a grid
 * of ceil(sqrt(n)) columns, filled left to right, then a row toward the
 * front. Positions depend only on creation order, so switching the active
 * plate never rearranges anything.
 */
export const PLATE_GAP_RATIO = 1 / 5

export function plateColumns(count: number): number {
  return Math.ceil(Math.sqrt(Math.max(1, count)))
}

/** Slot of plate `index` in document space (+y toward the front). */
export function plateSlot(index: number, count: number, bedWidth: number, bedDepth: number): { x: number; y: number } {
  const cols = plateColumns(count)
  const row = Math.floor(index / cols)
  const col = index % cols
  return { x: col * bedWidth * (1 + PLATE_GAP_RATIO), y: row * bedDepth * (1 + PLATE_GAP_RATIO) }
}

/** The same slot in slicer space (Z up, −y toward the front), as Bambu
 * Studio stores objects of its plates. */
export function plateOrigin(index: number, count: number, bedWidth: number, bedDepth: number): { x: number; y: number } {
  const slot = plateSlot(index, count, bedWidth, bedDepth)
  return { x: slot.x, y: -slot.y }
}
