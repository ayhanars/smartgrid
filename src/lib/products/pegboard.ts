import { bool, num, str, type MountPreview, type PartRecipe, type ProductBuild, type ProductSpec, type ProductTemplate, type SpecField } from './types'
import { dividerParts } from './dividers'
import { jHook, mountProfile, roundHookParts, roundHookReach, standingPath, type MountDims } from './mount'
import { BROR_BOARD, SKADIS_BOARD, type PegPattern } from './boards'

/**
 * Products for any pegboard: pick SKÅDIS or BROR, or describe your own
 * board (round holes or slots, their size, the grid, the sheet) and the
 * same bin and hook are laid out for it. Slots get a flat tab with a
 * lip that drops behind the sheet; round holes get a rounded peg that
 * turns up behind it, with straight studs underneath on a bin.
 */
const COLOR = '#4d8dff'

/** Everything a mount needs to know about the board. */
interface Board {
  pattern: PegPattern
  sheet: number
  dims: MountDims
  /** How far the mount reaches behind the part's face (room to leave on
   * the canvas). */
  reach: number
  /** Whether the lip rises (round peg) or drops (slot tab). */
  round: boolean
}

export const BOARD_FIELDS: SpecField[] = [
  {
    kind: 'select',
    id: 'board',
    label: 'Board',
    options: [
      { value: 'skadis', label: 'IKEA SKÅDIS (5 × 15 slots, 40 mm)' },
      { value: 'bror', label: 'IKEA BROR (Ø6 holes, 30 mm)' },
      { value: 'custom', label: 'Custom: my own board' },
    ],
  },
  {
    kind: 'select',
    id: 'holeKind',
    label: 'Custom holes',
    options: [
      { value: 'round', label: 'Round holes' },
      { value: 'slot', label: 'Slots' },
    ],
    hint: 'Used with a custom board.',
  },
  { kind: 'number', id: 'hole', label: 'Hole width / diameter', unit: 'mm', min: 3, max: 20, step: 0.1, hint: 'Custom board: diameter of a round hole, or the width of a slot.' },
  { kind: 'number', id: 'slotHeight', label: 'Slot height', unit: 'mm', min: 5, max: 40, step: 0.5, hint: 'Custom board with slots.' },
  { kind: 'number', id: 'pitchX', label: 'Pitch across', unit: 'mm', min: 10, max: 100, step: 0.5, hint: 'Custom board: hole centres, left to right.' },
  { kind: 'number', id: 'pitchY', label: 'Pitch down', unit: 'mm', min: 10, max: 100, step: 0.5, hint: 'Custom board: hole centres, top to bottom.' },
  { kind: 'boolean', id: 'stagger', label: 'Staggered rows (every other row shifted by half a pitch)' },
  { kind: 'number', id: 'sheet', label: 'Sheet thickness', unit: 'mm', min: 0.8, max: 12, step: 0.1, hint: 'Custom board.' },
]

export const BOARD_DEFAULTS: ProductSpec = { board: 'custom', holeKind: 'round', hole: 6, slotHeight: 15, pitchX: 25.4, pitchY: 25.4, stagger: false, sheet: 3.2 }

/** The tab-and-lip mount for a slot of this size in this sheet. */
function slotMount(slotWidth: number, slotHeight: number, sheet: number): MountDims {
  const tabWidth = Math.max(2, Math.round((slotWidth - 0.4) * 10) / 10)
  const tabThickness = Math.max(2.5, Math.min(5, Math.round(slotHeight * 0.27 * 10) / 10))
  return { tabThickness, lipThickness: tabWidth, gap: sheet + 0.6, lipDrop: Math.max(8, slotHeight - 3), tabWidth }
}

/** The rounded peg that turns up behind a round hole of this size. */
function roundMount(hole: number, sheet: number): MountDims {
  const peg = Math.max(2, Math.round((hole - 0.4) * 10) / 10)
  const lipRise = Math.max(2, Math.round(hole * 0.5 * 10) / 10)
  return { tabThickness: peg, tabWidth: peg, lipThickness: roundHookReach(peg, lipRise).back, gap: sheet + 0.6, lipDrop: 0, lipRise, round: Math.round((peg / 2 - 0.1) * 10) / 10 }
}

export function boardFrom(spec: ProductSpec): Board {
  const choice = str(spec, 'board', 'custom')
  let pattern: PegPattern
  let sheet: number
  if (choice === 'skadis') {
    pattern = SKADIS_BOARD.pattern
    sheet = SKADIS_BOARD.thickness
  } else if (choice === 'bror') {
    pattern = BROR_BOARD.pattern
    sheet = BROR_BOARD.thickness
  } else {
    const hole = num(spec, 'hole', 6)
    const pitchX = num(spec, 'pitchX', 25.4)
    const pitchY = num(spec, 'pitchY', 25.4)
    const stagger = bool(spec, 'stagger', false)
    pattern = str(spec, 'holeKind', 'round') === 'slot' ? { kind: 'slot', pitchX, pitchY, stagger, slotWidth: hole, slotHeight: Math.max(hole + 2, num(spec, 'slotHeight', 15)) } : { kind: 'round', pitchX, pitchY, stagger, diameter: hole }
    sheet = num(spec, 'sheet', 3.2)
  }
  if (pattern.kind === 'slot') {
    const dims = slotMount(pattern.slotWidth, pattern.slotHeight, sheet)
    return { pattern, sheet, dims, reach: dims.gap + dims.lipThickness, round: false }
  }
  const dims = roundMount(pattern.diameter, sheet)
  return { pattern, sheet, dims, reach: dims.gap + dims.lipThickness, round: true }
}

const hookCount = (width: number, choice: string, pitch: number, tabWidth: number) => {
  const most = Math.max(1, Math.floor((width - tabWidth) / pitch) + 1)
  if (choice !== 'auto') return Math.min(most, Math.max(1, parseInt(choice, 10) || 1))
  return Math.min(most, Math.max(1, Math.round((width - 10) / pitch)))
}

/** Extra rows of mounts under the top row: none on a small bin, one on
 * anything taller than a pitch and a half, two on a big one. */
function extraRows(spec: ProductSpec, height: number, pitchY: number, board: Board): number {
  const top = board.round ? height - 2 - roundHookReach(board.dims.tabThickness, board.dims.lipRise ?? 0).up : height - board.dims.tabThickness
  const most = Math.max(0, Math.floor((top - board.dims.tabThickness / 2 - (board.round ? 3 : board.dims.lipDrop)) / pitchY))
  const choice = str(spec, 'rows', 'auto')
  if (choice !== 'auto') return Math.min(most, Math.max(0, parseInt(choice, 10) || 0))
  const width = num(spec, 'width', 90)
  const depth = num(spec, 'depth', 60)
  const big = depth >= 80 || (height >= 100 && width >= 120) || width * depth * height >= 480000
  return Math.min(most, big ? 2 : 1)
}

const BIN_FIELDS: SpecField[] = [
  { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 30, max: 240, step: 1 },
  { kind: 'number', id: 'depth', label: 'Depth', unit: 'mm', min: 20, max: 150, step: 1 },
  { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 20, max: 200, step: 1 },
  { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1.2, max: 4, step: 0.2 },
  { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 30, step: 1 },
  {
    kind: 'select',
    id: 'hooks',
    label: 'Mounts across',
    options: [
      { value: 'auto', label: 'Auto (one per pitch)' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
    ],
  },
  {
    kind: 'select',
    id: 'rows',
    label: 'Rows below the top',
    options: [
      { value: 'auto', label: 'Auto (by size)' },
      { value: '0', label: 'None' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
    ],
    hint: 'Extra rows one pitch under the top one: hooks on a slot board, straight studs on a round-hole board.',
  },
  { kind: 'number', id: 'dividers', label: 'Dividers', min: 0, max: 6, step: 1, hint: 'Walls across the inside, evenly spaced.' },
  { kind: 'boolean', id: 'drain', label: 'Drain hole in the floor' },
]

export const pegboardBin: ProductTemplate = {
  id: 'pegboard-bin',
  name: 'Pegboard bin',
  tagline: 'Open bin for any pegboard, yours included',
  category: 'Any pegboard',
  keywords: ['box', 'basket', 'bin', 'container', 'pegboard', 'custom', 'hole', 'slot', 'wall'],
  fields: [...BIN_FIELDS, ...BOARD_FIELDS],
  defaults: { width: 90, depth: 60, height: 80, wall: 2, corner: 6, hooks: 'auto', rows: 'auto', dividers: 0, drain: false, ...BOARD_DEFAULTS },
  notes: 'Prints standing up; the parts export as one body. On a slot board the tabs drop a lip behind the sheet (45° undersides, no support). On a round-hole board rounded pegs turn up behind the sheet and straight studs below keep the bin from tilting. Measure a hole, the pitch and the sheet on your board first.',
  preview: (spec: ProductSpec): MountPreview => {
    const width = num(spec, 'width', 90)
    const height = num(spec, 'height', 80)
    const board = boardFrom(spec)
    const { dims, pattern } = board
    const hooks = hookCount(width, str(spec, 'hooks', 'auto'), pattern.pitchX, dims.tabWidth)
    const rows = extraRows(spec, height, pattern.pitchY, board)
    const span = (hooks - 1) * pattern.pitchX
    const top = board.round ? 2 + roundHookReach(dims.tabThickness, dims.lipRise ?? 0).up - dims.tabThickness / 2 : 0
    const anchors = []
    for (let r = 0; r <= rows; r++) for (let i = 0; i < hooks; i++) anchors.push({ x: width / 2 - span / 2 + i * pattern.pitchX - dims.tabWidth / 2, y: top + r * pattern.pitchY, width: dims.tabWidth, height: dims.tabThickness })
    const below = rows > 0 ? ` + ${hooks * rows} ${board.round ? 'stud' : 'hook'}${hooks * rows === 1 ? '' : 's'} below` : ''
    return { kind: 'mount', pattern, silhouette: { width, height }, anchors, caption: `Back view · ${hooks} ${board.round ? 'peg' : 'hook'}${hooks === 1 ? '' : 's'}${below} on the ${pattern.pitchX} mm grid` }
  },
  build: (spec: ProductSpec): ProductBuild => {
    const width = num(spec, 'width', 90)
    const depth = num(spec, 'depth', 60)
    const height = num(spec, 'height', 80)
    const wall = num(spec, 'wall', 2)
    const corner = Math.max(0, Math.min(num(spec, 'corner', 6), Math.min(width, depth) / 2 - wall))
    const board = boardFrom(spec)
    const { dims, pattern } = board
    const hooks = hookCount(width, str(spec, 'hooks', 'auto'), pattern.pitchX, dims.tabWidth)
    const rows = extraRows(spec, height, pattern.pitchY, board)
    const embed = Math.min(1, wall / 2)
    const boxY = board.reach
    const parts: PartRecipe[] = [
      { name: 'Bin', color: COLOR, outline: { kind: 'rect', x: 0, y: boxY, width, height: depth }, depth: height, cornerRadius: corner, hollow: { wall, floor: Math.max(wall, 1.6), openFrom: 'top' } },
    ]
    if (bool(spec, 'drain', false)) {
      const d = Math.min(8, Math.max(3, Math.min(width, depth) / 4))
      parts.push({ name: 'Drain', outline: { kind: 'circle', x: width / 2 - d / 2, y: boxY + depth / 2 - d / 2, width: d, height: d }, depth: Math.max(wall, 1.6) + 2, z: -1, isHole: true })
    }
    parts.push(...dividerParts({ count: num(spec, 'dividers', 0), width, depth, height, wall, boxY, color: COLOR }))
    const span = (hooks - 1) * pattern.pitchX
    const cxOf = (i: number) => width / 2 - span / 2 + i * pattern.pitchX
    if (board.round) {
      const center = height - 2 - roundHookReach(dims.tabThickness, dims.lipRise ?? 0).up
      for (let i = 0; i < hooks; i++) parts.push(...roundHookParts({ standing: true, d: dims.tabThickness, gap: dims.gap, rise: dims.lipRise ?? 8, embed, color: COLOR, name: hooks === 1 ? 'Hook' : `Hook ${i + 1}`, cx: cxOf(i), faceY: boxY, c: center }))
      const d = dims.tabThickness
      const studLength = embed + dims.gap + d
      const centerB = (dims.gap + d - embed) / 2
      let n = 0
      for (let r = 1; r <= rows; r++) {
        for (let i = 0; i < hooks; i++) {
          n++
          parts.push({ name: hooks * rows === 1 ? 'Stud' : `Stud ${n}`, color: COLOR, outline: { kind: 'circle', x: cxOf(i) - d / 2, y: boxY - centerB - d / 2, width: d, height: d }, depth: studLength, rotation: { x: 90 }, z: center - r * pattern.pitchY - d / 2 })
        }
      }
    } else {
      const { points: profile, height: hookHeight } = mountProfile(dims, embed)
      let n = 0
      for (let r = 0; r <= rows; r++) {
        for (let i = 0; i < hooks; i++) {
          n++
          parts.push({ name: hooks * (rows + 1) === 1 ? 'Hook' : `Hook ${n}`, color: COLOR, outline: { kind: 'path', points: standingPath(profile, cxOf(i), hookHeight, boxY) }, depth: dims.tabWidth, rotation: { y: 90 }, z: height - hookHeight - r * pattern.pitchY })
        }
      }
    }
    return { width, height: boxY + depth, parts, fuse: true }
  },
}

export const pegboardHook: ProductTemplate = {
  id: 'pegboard-hook',
  name: 'Pegboard hook',
  tagline: 'J-hook for any pegboard, yours included',
  category: 'Any pegboard',
  keywords: ['hook', 'hanger', 'pegboard', 'custom', 'hole', 'slot', 'wall'],
  fields: [
    { kind: 'number', id: 'reach', label: 'Arm length', unit: 'mm', min: 10, max: 100, step: 1 },
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 3, max: 40, step: 0.5, hint: 'Along the board; the tab or peg stays as wide as the hole allows.' },
    { kind: 'number', id: 'arm', label: 'Arm thickness', unit: 'mm', min: 3, max: 10, step: 0.5 },
    { kind: 'number', id: 'tip', label: 'Tip height', unit: 'mm', min: 0, max: 40, step: 1 },
    { kind: 'number', id: 'plate', label: 'Back plate height', unit: 'mm', min: 10, max: 80, step: 1 },
    ...BOARD_FIELDS,
  ],
  defaults: { reach: 40, width: 12, arm: 5, tip: 10, plate: 30, ...BOARD_DEFAULTS },
  notes: 'Prints lying on its side, so the layers run along the hook. A slot board gets a flat tab with a lip behind the sheet; a round-hole board gets a rounded peg that turns up behind it. A hook wider than the opening gets the tab as a fused centre piece.',
  preview: (spec: ProductSpec): MountPreview => {
    const width = num(spec, 'width', 12)
    const plateH = num(spec, 'plate', 30)
    const { dims, pattern, round } = boardFrom(spec)
    const peg = Math.min(width, dims.tabWidth)
    const rise = round ? (dims.lipRise ?? 0) : 0
    return { kind: 'mount', pattern, silhouette: { width, height: plateH + dims.tabThickness + rise }, anchors: [{ x: width / 2 - peg / 2, y: rise, width: peg, height: dims.tabThickness }], caption: `Back view · one ${round ? 'hole' : 'slot'}` }
  },
  build: (spec: ProductSpec): ProductBuild => {
    const { dims, round } = boardFrom(spec)
    const reach = num(spec, 'reach', 40)
    const width = num(spec, 'width', 12)
    const arm = num(spec, 'arm', 5)
    const tip = num(spec, 'tip', 10)
    const plateH = num(spec, 'plate', 30)
    if (!round) return jHook({ mount: dims, reach, width, arm, tip, plateH, color: COLOR })
    const d = dims.tabThickness
    const rise = dims.lipRise ?? 8
    const base = jHook({ mount: { ...dims, tabWidth: 0 }, reach, width, arm, tip, plateH, color: COLOR })
    const plateT = 4
    const peg = roundHookParts({ standing: false, d, gap: dims.gap, rise, embed: plateT - 0.5, color: COLOR, name: 'Peg', faceX: plateT + reach, shankY: rise + d / 2, zc: Math.max(d / 2, width / 2) })
    return { width: base.width, height: base.height, parts: [base.parts[0], ...peg], fuse: true }
  },
}
