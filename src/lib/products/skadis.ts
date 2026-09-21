import type { Point2 } from '../../types/document'
import { bool, num, str, type PartRecipe, type ProductSpec, type ProductTemplate } from './types'

/**
 * IKEA SKÅDIS pegboard, as measured on the boards: 5 × 15 mm slots on a
 * 40 mm grid, every other row shifted by 20 mm, board about 5 mm thick.
 * A hook is a tab that goes through a slot and drops behind the board.
 */
export const SKADIS = {
  slotWidth: 5,
  slotHeight: 15,
  pitch: 40,
  board: 5.2,
  /** Tab width: the slot minus print clearance. */
  tabWidth: 4.6,
  /** Tab thickness (vertical), also the lip thickness behind the board. */
  tabThickness: 4,
  lipThickness: 4.6,
  /** Room for the board between the part and the lip. */
  gap: 5.6,
  /** How far the lip drops behind the board. */
  lipDrop: 12,
}

const COLOR = '#4d8dff'

/**
 * Side profile of a mounting tab, as (h, b): h up from the tab's own
 * bottom, b backward from the mounting face (negative = into the part).
 * The lip's underside and the tab's underside are 45° so the part
 * prints standing up with no support.
 */
function tabProfile(embed: number): { points: { h: number; b: number }[]; height: number } {
  const { tabThickness: t, lipThickness: lt, gap, lipDrop } = SKADIS
  const height = t + Math.max(lipDrop, gap + embed)
  const top = height
  const back = gap + lt
  const points = [
    { h: top, b: -embed },
    { h: top, b: back },
    { h: top - t - lipDrop, b: back },
    // Chamfer under the lip, up toward the board.
    { h: top - t - lipDrop + lt, b: gap },
    { h: top - t, b: gap },
    // Gusset under the tab, down to the part.
    { h: top - t - (gap + embed), b: -embed },
  ]
  return { points, height }
}

/** Side profile → canvas path standing up (rotation y 90°): canvas x
 * becomes height, canvas y stays depth; the extrusion becomes the width,
 * centred on the profile's x centre. */
function standingPath(points: { h: number; b: number }[], centerX: number, height: number, faceY: number): Point2[] {
  return points.map((p) => ({ x: centerX - height / 2 + p.h, y: faceY - p.b }))
}

function hookCount(width: number, choice: string): number {
  if (choice !== 'auto') return Math.max(1, parseInt(choice, 10) || 1)
  return Math.max(1, Math.round((width - 10) / SKADIS.pitch))
}

export const skadisContainer: ProductTemplate = {
  id: 'skadis-container',
  name: 'SKÅDIS container',
  tagline: 'Open box that hangs on the pegboard',
  category: 'IKEA SKÅDIS',
  keywords: ['box', 'basket', 'cup', 'bin', 'pegboard', 'ikea', 'skadis'],
  fields: [
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 30, max: 240, step: 1 },
    { kind: 'number', id: 'depth', label: 'Depth', unit: 'mm', min: 20, max: 150, step: 1 },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 20, max: 200, step: 1 },
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1.2, max: 4, step: 0.2 },
    { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 30, step: 1 },
    {
      kind: 'select',
      id: 'hooks',
      label: 'Hooks',
      options: [
        { value: 'auto', label: 'Auto (one per 40 mm)' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
    },
    { kind: 'boolean', id: 'drain', label: 'Drain hole in the floor' },
  ],
  defaults: { width: 80, depth: 50, height: 60, wall: 2, corner: 6, hooks: 'auto', drain: false },
  notes: 'Prints standing up, hooks at the back top edge; the tab and lip undersides are 45° so no support is needed. Hooks sit 40 mm apart to match the pegboard. The parts export as one body.',
  build: (spec: ProductSpec) => {
    const width = num(spec, 'width', 80)
    const depth = num(spec, 'depth', 50)
    const height = num(spec, 'height', 60)
    const wall = num(spec, 'wall', 2)
    const corner = Math.min(num(spec, 'corner', 6), Math.min(width, depth) / 2 - wall)
    const hooks = Math.min(hookCount(width, str(spec, 'hooks', 'auto')), Math.max(1, Math.floor((width - SKADIS.tabWidth) / SKADIS.pitch) + 1))
    const drain = bool(spec, 'drain', false)

    // The board is behind the box: toward the top of the canvas. Leave
    // room above the box outline for the hooks.
    const { points: profile, height: hookHeight } = tabProfile(Math.min(1, wall / 2))
    const hookReach = SKADIS.gap + SKADIS.lipThickness
    const boxY = hookReach
    const parts: PartRecipe[] = [
      {
        name: 'Box',
        color: COLOR,
        outline: { kind: 'rect', x: 0, y: boxY, width, height: depth },
        depth: height,
        cornerRadius: Math.max(0, corner),
        hollow: { wall, floor: Math.max(wall, 1.6), openFrom: 'top' },
      },
    ]
    if (drain) {
      const d = Math.min(8, Math.max(3, Math.min(width, depth) / 4))
      parts.push({ name: 'Drain', outline: { kind: 'circle', x: width / 2 - d / 2, y: boxY + depth / 2 - d / 2, width: d, height: d }, depth: Math.max(wall, 1.6) + 2, z: -1, isHole: true })
    }
    const span = (hooks - 1) * SKADIS.pitch
    for (let i = 0; i < hooks; i++) {
      const cx = width / 2 - span / 2 + i * SKADIS.pitch
      parts.push({
        name: hooks === 1 ? 'Hook' : `Hook ${i + 1}`,
        color: COLOR,
        outline: { kind: 'path', points: standingPath(profile, cx, hookHeight, boxY) },
        depth: SKADIS.tabWidth,
        rotation: { y: 90 },
        z: height - hookHeight,
      })
    }
    return { width, height: boxY + depth, parts, fuse: true }
  },
}

export const skadisHook: ProductTemplate = {
  id: 'skadis-hook',
  name: 'SKÅDIS hook',
  tagline: 'J-hook for tools, cables, headphones',
  category: 'IKEA SKÅDIS',
  keywords: ['hook', 'hanger', 'pegboard', 'ikea', 'skadis'],
  fields: [
    { kind: 'number', id: 'reach', label: 'Arm length', unit: 'mm', min: 10, max: 80, step: 1 },
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 4.6, max: 40, step: 0.2, hint: 'Along the board. 4.6 mm fits inside one slot; wider hooks rest on the board.' },
    { kind: 'number', id: 'arm', label: 'Arm thickness', unit: 'mm', min: 3, max: 8, step: 0.5 },
    { kind: 'number', id: 'tip', label: 'Tip height', unit: 'mm', min: 0, max: 30, step: 1 },
    { kind: 'number', id: 'plate', label: 'Back plate height', unit: 'mm', min: 10, max: 60, step: 1 },
  ],
  defaults: { reach: 30, width: 10, arm: 4, tip: 8, plate: 20 },
  notes: 'Prints lying on its side, so the layers run along the hook for strength. The tab at the top goes through a slot and its lip drops behind the board.',
  build: (spec: ProductSpec) => {
    const reach = num(spec, 'reach', 30)
    const width = num(spec, 'width', 10)
    const arm = num(spec, 'arm', 4)
    const tip = num(spec, 'tip', 8)
    const plateH = num(spec, 'plate', 20)
    const plateT = 4
    const { tabThickness: t, lipThickness: lt, gap, lipDrop } = SKADIS
    const top = plateH + t
    const back = gap + lt
    // (b, h): b backward from the board face (negative = in front), h up.
    const profile: { b: number; h: number }[] = [
      { b: 0, h: top },
      { b: back, h: top },
      { b: back, h: top - t - lipDrop },
      { b: gap, h: top - t - lipDrop + lt },
      { b: gap, h: top - t },
      { b: 0, h: top - t },
      { b: 0, h: 0 },
      { b: -(plateT + reach), h: 0 },
      { b: -(plateT + reach), h: arm + tip },
      { b: -(plateT + reach) + Math.min(arm, reach), h: arm + tip },
      { b: -(plateT + reach) + Math.min(arm, reach), h: arm },
      { b: -plateT, h: arm },
      { b: -plateT, h: top },
    ]
    // Lying flat on the canvas: x is the depth axis (front to the left),
    // y is height (top of the hook toward the top of the canvas).
    const offset = plateT + reach
    const points: Point2[] = profile.map((p) => ({ x: p.b + offset, y: top - p.h }))
    return { width: offset + back, height: top, parts: [{ name: 'Hook', color: COLOR, outline: { kind: 'path', points }, depth: width }] }
  },
}
