/**
 * The pegboards products mount on: the sheet and its hole pattern, as
 * measured (SKÅDIS) or as given with what still has to be checked on a
 * physical board (BROR). A pattern is a grid of nodes, each carrying one
 * opening; a staggered pattern adds a second grid offset by half a pitch.
 */
export interface Pegboard {
  id: string
  name: string
  /** Sheet size, mm (the smallest of the family where several exist). */
  width: number
  height: number
  /** Sheet thickness, mm. */
  thickness: number
  cornerRadius: number
  pattern: PegPattern
}

export type PegPattern =
  | { kind: 'slot'; pitchX: number; pitchY: number; stagger: boolean; slotWidth: number; slotHeight: number }
  | { kind: 'round'; pitchX: number; pitchY: number; stagger: boolean; diameter: number }

export const SKADIS_BOARD: Pegboard = {
  id: 'skadis',
  name: 'IKEA SKÅDIS',
  width: 560,
  height: 560,
  thickness: 5,
  cornerRadius: 9.5,
  pattern: { kind: 'slot', pitchX: 40, pitchY: 40, stagger: true, slotWidth: 5, slotHeight: 15 },
}

/** Hole diameter and thickness are to be verified on the board; the
 * products expose both as fields with these as starting values. */
export const BROR_BOARD: Pegboard = {
  id: 'bror',
  name: 'IKEA BROR',
  width: 840,
  height: 450,
  thickness: 1.5,
  cornerRadius: 8,
  pattern: { kind: 'round', pitchX: 30, pitchY: 30, stagger: false, diameter: 6 },
}

/** Every node of the pattern inside a window (mm), as centres. */
export function patternNodes(pattern: PegPattern, window: { x: number; y: number; width: number; height: number }, offset: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  const grids = pattern.stagger
    ? [
        { dx: 0, dy: 0 },
        { dx: pattern.pitchX / 2, dy: pattern.pitchY / 2 },
      ]
    : [{ dx: 0, dy: 0 }]
  for (const g of grids) {
    const x0 = Math.floor((window.x - offset.x - g.dx) / pattern.pitchX) * pattern.pitchX + offset.x + g.dx
    const y0 = Math.floor((window.y - offset.y - g.dy) / pattern.pitchY) * pattern.pitchY + offset.y + g.dy
    for (let y = y0; y <= window.y + window.height; y += pattern.pitchY) {
      for (let x = x0; x <= window.x + window.width; x += pattern.pitchX) {
        if (x >= window.x && y >= window.y) out.push({ x, y })
      }
    }
  }
  return out
}
