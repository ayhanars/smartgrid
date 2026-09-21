import { bool, num, str, type PartRecipe, type ProductSpec, type ProductTemplate, type SpecField } from './types'
import { jHook, mountProfile, standingPath, type MountDims } from './mount'
import { BROR_BOARD, type PegPattern } from './boards'

/**
 * IKEA BROR pegboard: 840 × 450 mm galvanized steel with round holes on
 * a 30 mm grid. The hole diameter and the sheet thickness are still to
 * be verified on a board, so both are fields with starting values.
 */
const COLOR = '#4d8dff'

const MOUNT_FIELDS: SpecField[] = [
  { kind: 'number', id: 'hole', label: 'Hole diameter', unit: 'mm', min: 3, max: 15, step: 0.1, hint: 'Verify on the board; the peg is sized from it.' },
  { kind: 'number', id: 'pitch', label: 'Hole pitch', unit: 'mm', min: 10, max: 80, step: 0.5, hint: 'Centre to centre, both directions.' },
  { kind: 'number', id: 'sheet', label: 'Sheet thickness', unit: 'mm', min: 0.8, max: 5, step: 0.1, hint: 'Verify on the board.' },
]
const MOUNT_DEFAULTS: ProductSpec = { hole: BROR_BOARD.pattern.kind === 'round' ? BROR_BOARD.pattern.diameter : 6, pitch: BROR_BOARD.pattern.pitchX, sheet: BROR_BOARD.thickness }

/** A rounded peg that fills a round hole: as wide and as thick as the
 * hole less 0.4 mm of play, with its edges filleted to half that, so
 * the cross-section is close to a circle. The lip behind the sheet is
 * as thick as the peg. */
function mountFrom(spec: ProductSpec): { dims: MountDims; pitch: number; pattern: PegPattern } {
  const hole = num(spec, 'hole', 6)
  const sheet = num(spec, 'sheet', 1.5)
  const pitch = num(spec, 'pitch', 30)
  const peg = Math.max(2, Math.round((hole - 0.4) * 10) / 10)
  return {
    dims: { tabThickness: peg, tabWidth: peg, lipThickness: Math.max(3, peg), gap: sheet + 0.6, lipDrop: Math.max(8, hole + 4), round: Math.round((peg / 2 - 0.1) * 10) / 10 },
    pitch,
    pattern: { kind: 'round', pitchX: pitch, pitchY: pitch, stagger: false, diameter: hole },
  }
}

function hookCount(width: number, choice: string, pitch: number, peg: number): number {
  const most = Math.max(1, Math.floor((width - peg) / pitch) + 1)
  if (choice !== 'auto') return Math.min(most, Math.max(1, parseInt(choice, 10) || 1))
  return Math.min(most, Math.max(1, Math.round((width - 10) / pitch)))
}

export const brorBin: ProductTemplate = {
  id: 'bror-bin',
  name: 'BROR bin',
  tagline: 'Open bin that hangs on the pegboard',
  category: 'IKEA BROR',
  keywords: ['box', 'basket', 'bin', 'container', 'pegboard', 'ikea', 'bror'],
  fields: [
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 30, max: 240, step: 1 },
    { kind: 'number', id: 'depth', label: 'Depth', unit: 'mm', min: 20, max: 150, step: 1 },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 20, max: 200, step: 1 },
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1.2, max: 4, step: 0.2 },
    { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 30, step: 1 },
    {
      kind: 'select',
      id: 'hooks',
      label: 'Pegs across',
      options: [
        { value: 'auto', label: 'Auto (one per 30 mm)' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
      ],
    },
    {
      kind: 'select',
      id: 'rows',
      label: 'Peg rows',
      options: [
        { value: '1', label: '1 (top edge)' },
        { value: '2', label: '2 (one pitch lower too)' },
      ],
    },
    { kind: 'boolean', id: 'drain', label: 'Drain hole in the floor' },
    ...MOUNT_FIELDS,
  ],
  defaults: { width: 90, depth: 60, height: 80, wall: 2, corner: 6, hooks: 'auto', rows: '1', drain: false, ...MOUNT_DEFAULTS },
  notes: 'Prints standing up; rounded pegs at the back top edge go through the round holes and drop behind the sheet. Peg and lip undersides are 45°, no support needed. The parts export as one body. Check hole diameter and sheet thickness on your board first.',
  preview: (spec: ProductSpec) => {
    const width = num(spec, 'width', 90)
    const height = num(spec, 'height', 80)
    const { dims, pitch, pattern } = mountFrom(spec)
    const hooks = hookCount(width, str(spec, 'hooks', 'auto'), pitch, dims.tabWidth)
    const rows = str(spec, 'rows', '1') === '2' ? 2 : 1
    const span = (hooks - 1) * pitch
    const anchors = []
    for (let r = 0; r < rows; r++) for (let i = 0; i < hooks; i++) anchors.push({ x: width / 2 - span / 2 + i * pitch - dims.tabWidth / 2, y: r * pitch, width: dims.tabWidth, height: dims.tabThickness })
    return { pattern, silhouette: { width, height }, anchors, caption: `Back view · ${hooks * rows} peg${hooks * rows === 1 ? '' : 's'} on the ${pitch} mm grid` }
  },
  build: (spec: ProductSpec) => {
    const width = num(spec, 'width', 90)
    const depth = num(spec, 'depth', 60)
    const height = num(spec, 'height', 80)
    const wall = num(spec, 'wall', 2)
    const corner = Math.max(0, Math.min(num(spec, 'corner', 6), Math.min(width, depth) / 2 - wall))
    const drain = bool(spec, 'drain', false)
    const { dims, pitch } = mountFrom(spec)
    const hooks = hookCount(width, str(spec, 'hooks', 'auto'), pitch, dims.tabWidth)
    const rows = str(spec, 'rows', '1') === '2' && height - pitch > dims.lipDrop + dims.tabThickness ? 2 : 1
    const { points: profile, height: tabHeight } = mountProfile(dims, Math.min(1, wall / 2))
    const boxY = dims.gap + dims.lipThickness
    const parts: PartRecipe[] = [
      { name: 'Bin', color: COLOR, outline: { kind: 'rect', x: 0, y: boxY, width, height: depth }, depth: height, cornerRadius: corner, hollow: { wall, floor: Math.max(wall, 1.6), openFrom: 'top' } },
    ]
    if (drain) {
      const d = Math.min(8, Math.max(3, Math.min(width, depth) / 4))
      parts.push({ name: 'Drain', outline: { kind: 'circle', x: width / 2 - d / 2, y: boxY + depth / 2 - d / 2, width: d, height: d }, depth: Math.max(wall, 1.6) + 2, z: -1, isHole: true })
    }
    const span = (hooks - 1) * pitch
    let n = 0
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < hooks; i++) {
        n++
        parts.push({
          name: hooks * rows === 1 ? 'Peg' : `Peg ${n}`,
          color: COLOR,
          outline: { kind: 'path', points: standingPath(profile, width / 2 - span / 2 + i * pitch, tabHeight, boxY) },
          depth: dims.tabWidth,
          bevel: dims.round,
          rotation: { y: 90 },
          z: height - tabHeight - r * pitch,
        })
      }
    }
    return { width, height: boxY + depth, parts, fuse: true }
  },
}

export const brorHook: ProductTemplate = {
  id: 'bror-hook',
  name: 'BROR hook',
  tagline: 'J-hook for the round-hole pegboard',
  category: 'IKEA BROR',
  keywords: ['hook', 'hanger', 'pegboard', 'ikea', 'bror'],
  fields: [
    { kind: 'number', id: 'reach', label: 'Arm length', unit: 'mm', min: 10, max: 100, step: 1 },
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 3, max: 40, step: 0.5, hint: 'Along the board; the peg stays as wide as the hole allows.' },
    { kind: 'number', id: 'arm', label: 'Arm thickness', unit: 'mm', min: 3, max: 10, step: 0.5 },
    { kind: 'number', id: 'tip', label: 'Tip height', unit: 'mm', min: 0, max: 40, step: 1 },
    { kind: 'number', id: 'plate', label: 'Back plate height', unit: 'mm', min: 10, max: 80, step: 1 },
    ...MOUNT_FIELDS,
  ],
  defaults: { reach: 40, width: 12, arm: 5, tip: 10, plate: 30, ...MOUNT_DEFAULTS },
  notes: 'Prints lying on its side. A rounded peg sized to the hole goes through it and its lip drops behind the sheet; a hook wider than the peg gets the peg as a fused centre piece. Check hole diameter and sheet thickness on your board first.',
  preview: (spec: ProductSpec) => {
    const width = num(spec, 'width', 12)
    const plateH = num(spec, 'plate', 30)
    const { dims, pattern } = mountFrom(spec)
    const peg = Math.min(width, dims.tabWidth)
    return { pattern, silhouette: { width, height: plateH + dims.tabThickness }, anchors: [{ x: width / 2 - peg / 2, y: 0, width: peg, height: dims.tabThickness }], caption: 'Back view · one hole' }
  },
  build: (spec: ProductSpec) => {
    const { dims } = mountFrom(spec)
    return jHook({ mount: dims, reach: num(spec, 'reach', 40), width: num(spec, 'width', 12), arm: num(spec, 'arm', 5), tip: num(spec, 'tip', 10), plateH: num(spec, 'plate', 30), color: COLOR })
  },
}
