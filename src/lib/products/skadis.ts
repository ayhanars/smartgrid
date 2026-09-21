import { bool, num, str, type PartRecipe, type ProductSpec, type ProductTemplate } from './types'
import { jHook, mountProfile, standingPath, type MountDims } from './mount'
import { SKADIS_BOARD } from './boards'

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

/** The SKÅDIS tab in the shared mount-profile terms. */
const SKADIS_MOUNT: MountDims = { tabThickness: SKADIS.tabThickness, lipThickness: SKADIS.lipThickness, gap: SKADIS.gap, lipDrop: SKADIS.lipDrop, tabWidth: SKADIS.tabWidth }

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
  preview: (spec: ProductSpec) => {
    const width = num(spec, 'width', 80)
    const height = num(spec, 'height', 60)
    const hooks = Math.min(hookCount(width, str(spec, 'hooks', 'auto')), Math.max(1, Math.floor((width - SKADIS.tabWidth) / SKADIS.pitch) + 1))
    const span = (hooks - 1) * SKADIS.pitch
    return {
      pattern: SKADIS_BOARD.pattern,
      silhouette: { width, height },
      anchors: Array.from({ length: hooks }, (_, i) => ({ x: width / 2 - span / 2 + i * SKADIS.pitch - SKADIS.tabWidth / 2, y: 0, width: SKADIS.tabWidth, height: SKADIS.tabThickness })),
      caption: `Back view · ${hooks} hook${hooks === 1 ? '' : 's'} on the 40 mm grid`,
    }
  },
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
    const { points: profile, height: hookHeight } = mountProfile(SKADIS_MOUNT, Math.min(1, wall / 2))
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
  notes: 'Prints lying on its side, so the layers run along the hook for strength. The tab at the top goes through a slot and its lip drops behind the board; a hook wider than the slot gets a narrower tab, fused at export.',
  preview: (spec: ProductSpec) => {
    const width = num(spec, 'width', 10)
    const plateH = num(spec, 'plate', 20)
    const peg = Math.min(width, SKADIS.tabWidth)
    return {
      pattern: SKADIS_BOARD.pattern,
      silhouette: { width, height: plateH + SKADIS.tabThickness },
      anchors: [{ x: width / 2 - peg / 2, y: 0, width: peg, height: SKADIS.tabThickness }],
      caption: 'Back view · one slot',
    }
  },
  build: (spec: ProductSpec) => {
    const reach = num(spec, 'reach', 30)
    const width = num(spec, 'width', 10)
    const arm = num(spec, 'arm', 4)
    const tip = num(spec, 'tip', 8)
    const plateH = num(spec, 'plate', 20)
    return jHook({ mount: SKADIS_MOUNT, reach, width, arm, tip, plateH, color: COLOR })
  },
}
