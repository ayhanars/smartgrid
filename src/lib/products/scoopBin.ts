import type { PartRecipe, ProductSpec } from './types'
import { num, str } from './types'
import { dividerParts } from './dividers'
import { brorHookParts, brorStudParts, HOOK_CLEAR, HOOK_PLAY, hookReach, STUD_CLEAR, STUD_PLAY, standingPath } from './mount'

/**
 * The bin of a round-hole board, copied 1:1 off a printed BROR bin (the
 * reference STL): a box with rounded vertical corners, a front wall
 * lower than the back and the side walls sloping between the two at
 * `SCOOP_SLOPE`, so it is a scoop you can see and reach into. On the
 * back, one hook per column `HOOK_DROP` under the rim and a straight
 * stud one pitch under each hook (see brorHookParts). Prints standing
 * on its floor, no support.
 */
/** Rise per mm of the side walls' top edge, front to back (33°). */
export const SCOOP_SLOPE = Math.tan((33.3 * Math.PI) / 180)
/** The hook's centre this far under the rim. */
export const HOOK_DROP = 7

export interface ScoopBinSpec {
  width: number
  depth: number
  height: number
  /** Height of the front wall; the sides slope up from it. */
  front: number
  wall: number
  floor: number
  corner: number
  hole: number
  sheet: number
  pitch: number
  /** Hook columns, x from the bin's left edge. */
  columns: number[]
  studRows: number
  dividers: number
  drain: boolean
}

export function scoopBinSpec(spec: ProductSpec, pattern: { hole: number; sheet: number; pitch: number }): ScoopBinSpec {
  const width = num(spec, 'width', 120)
  const depth = num(spec, 'depth', 80)
  const height = num(spec, 'height', 70)
  const wall = num(spec, 'wall', 2.5)
  // The slope may not reach the back wall, where the hooks are.
  const front = Math.max(Math.min(num(spec, 'front', height), height), height - (depth - wall) * SCOOP_SLOPE, 10)
  const hookD = Math.max(2, Math.round((pattern.hole - HOOK_PLAY) * 10) / 10)
  const columns = hookColumns(width, str(spec, 'hooks', 'auto'), pattern.pitch)
  const floor = num(spec, 'floor', 5)
  const most = Math.max(0, Math.floor((height - HOOK_DROP - hookD / 2 - floor - 3) / pattern.pitch))
  const rows = str(spec, 'rows', 'auto')
  const studRows = rows === 'auto' ? Math.min(most, 1) : Math.min(most, Math.max(0, parseInt(rows, 10) || 0))
  return { width, depth, height, front, wall, floor, corner: Math.max(0, Math.min(num(spec, 'corner', wall), Math.min(width, depth) / 2 - 0.1)), hole: pattern.hole, sheet: pattern.sheet, pitch: pattern.pitch, columns, studRows, dividers: num(spec, 'dividers', 0), drain: !!spec.drain }
}

/** Hook columns across the width: by default one 30 mm in from each
 * side (snapped to the pitch), as the reference bin has; a chosen count
 * is spread one pitch apart around the middle. */
export function hookColumns(width: number, choice: string, pitch: number): number[] {
  const most = Math.max(1, Math.floor((width - 10) / pitch) + 1)
  let count: number
  let span: number
  if (choice === 'auto') {
    span = Math.max(0, Math.floor((width - 60) / pitch)) * pitch
    count = span >= pitch ? 2 : 1
  } else {
    count = Math.min(most, Math.max(1, parseInt(choice, 10) || 1))
    span = (count - 1) * pitch
  }
  const step = count > 1 ? span / (count - 1) : 0
  return Array.from({ length: count }, (_, i) => width / 2 - span / 2 + i * step)
}

export function scoopMounts(s: ScoopBinSpec): { hookD: number; studD: number; hookGap: number; studStraight: number; reach: number } {
  const hookD = Math.max(2, Math.round((s.hole - HOOK_PLAY) * 10) / 10)
  const studD = Math.max(2, Math.round((s.hole - STUD_PLAY) * 10) / 10)
  const hookGap = s.sheet + HOOK_CLEAR
  const studStraight = s.sheet + STUD_CLEAR
  const reach = Math.max(hookGap + hookReach(hookD).back, studStraight + studD / 2)
  return { hookD, studD, hookGap, studStraight, reach }
}

/** Back-view anchors (from the rim down) for the fit preview. */
export function scoopAnchors(s: ScoopBinSpec): { x: number; y: number; width: number; height: number }[] {
  const { hookD, studD } = scoopMounts(s)
  const anchors: { x: number; y: number; width: number; height: number }[] = []
  for (const cx of s.columns) {
    anchors.push({ x: cx - hookD / 2, y: HOOK_DROP - hookD / 2, width: hookD, height: hookD })
    for (let r = 1; r <= s.studRows; r++) anchors.push({ x: cx - studD / 2, y: HOOK_DROP + r * s.pitch - studD / 2, width: studD, height: studD })
  }
  return anchors
}

export function scoopBinParts(s: ScoopBinSpec, color: string): { parts: PartRecipe[]; boxY: number } {
  const { width, depth, height, front, wall, floor, corner } = s
  const { hookD, studD, hookGap, studStraight, reach } = scoopMounts(s)
  const boxY = reach
  const embed = Math.min(1, wall / 2)
  const parts: PartRecipe[] = [
    { name: 'Bin', color, outline: { kind: 'rect', x: 0, y: boxY, width, height: depth }, depth: height, cornerRadius: corner, hollow: { wall, floor: Math.max(floor, 1.2), openFrom: 'top' } },
  ]
  if (front < height - 0.05) {
    // Everything above the slope goes: a triangle in the side view
    // (canvas y, height), stood up across the whole width. It also trims
    // the dividers.
    const yFront = boxY + depth
    const zTop = height + 2
    const yEnd = yFront - (zTop - (front - SCOOP_SLOPE)) / SCOOP_SLOPE
    const zLow = front - SCOOP_SLOPE
    const profile = [
      { b: -(yFront + 1), h: 0 },
      { b: -(yFront + 1), h: zTop - zLow },
      { b: -yEnd, h: zTop - zLow },
    ]
    parts.push({ name: 'Scoop', outline: { kind: 'path', points: standingPath(profile, width / 2, zTop - zLow, 0) }, depth: width + 2, rotation: { y: 90 }, z: zLow, isHole: true })
  }
  if (s.drain) {
    const d = Math.min(8, Math.max(3, Math.min(width, depth) / 4))
    parts.push({ name: 'Drain', outline: { kind: 'circle', x: width / 2 - d / 2, y: boxY + depth / 2 - d / 2, width: d, height: d }, depth: Math.max(floor, 1.2) + 2, z: -1, isHole: true })
  }
  parts.push(...dividerParts({ count: s.dividers, width, depth, height, wall, boxY, color }))
  const c = height - HOOK_DROP
  s.columns.forEach((cx, i) => {
    const n = s.columns.length === 1 ? '' : ` ${i + 1}`
    parts.push(...brorHookParts({ standing: true, d: hookD, gap: hookGap, embed, color, name: `Hook${n}`, cx, faceY: boxY, c }))
    for (let r = 1; r <= s.studRows; r++) {
      parts.push(...brorStudParts({ standing: true, d: studD, straight: studStraight, embed, color, name: `Stud${n}${s.studRows > 1 ? `.${r}` : ''}`, cx, faceY: boxY, c: c - r * s.pitch }))
    }
  })
  return { parts, boxY }
}
