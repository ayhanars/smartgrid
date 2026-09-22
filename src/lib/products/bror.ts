import { bool, num, str, type PartRecipe, type ProductSpec, type ProductTemplate, type SpecField } from './types'
import { dividerParts } from './dividers'
import { binOutline, jHook, ROD_LIFT, rodParts, rodReach, type MountDims } from './mount'
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

/** A round rod that fills a round hole: the hole less 0.4 mm of play.
 * It is the rod of a printed BROR holder, copied 1:1: it sits on top of
 * the back wall and goes straight through the hole (see rodParts). */
function mountFrom(spec: ProductSpec): { dims: MountDims; pitch: number; pattern: PegPattern; reach: number } {
  const hole = num(spec, 'hole', 6)
  const sheet = num(spec, 'sheet', 1.5)
  const pitch = num(spec, 'pitch', 30)
  const peg = Math.max(2, Math.round((hole - 0.4) * 10) / 10)
  const gap = sheet + 0.6
  const hook = rodReach(peg)
  return {
    // lipThickness here is how far behind the sheet the peg reaches.
    dims: { tabThickness: peg, tabWidth: peg, lipThickness: hook.back, gap, lipDrop: 0, lipRise: hook.up, round: Math.round((peg / 2 - 0.1) * 10) / 10 },
    pitch,
    pattern: { kind: 'round', pitchX: pitch, pitchY: pitch, stagger: false, diameter: hole },
    reach: gap + hook.back,
  }
}

/** Height of the rods' centre: the rod rests on the bin's top edge, its
 * underside ROD_LIFT above it. */
function shankCenter(height: number, dims: MountDims): number {
  return height + ROD_LIFT + dims.tabThickness / 2
}

/** Rows of straight studs under the hook row: as many as fit and the
 * size asks for — one on any bin taller than a pitch and a half, two on
 * a big one (deep, or tall and wide, or over about half a litre). */
function studRows(spec: ProductSpec, height: number, pitch: number, dims: MountDims): number {
  const most = Math.max(0, Math.floor((shankCenter(height, dims) - dims.tabThickness / 2 - 3) / pitch))
  const choice = str(spec, 'rows', 'auto')
  if (choice !== 'auto') return Math.min(most, Math.max(0, parseInt(choice, 10) || 0))
  const width = num(spec, 'width', 90)
  const depth = num(spec, 'depth', 60)
  const big = depth >= 80 || (height >= 100 && width >= 120) || width * depth * height >= 480000
  return Math.min(most, big ? 2 : 1)
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
      label: 'Stud rows below',
      options: [
        { value: 'auto', label: 'Auto (by size)' },
        { value: '0', label: 'None' },
        { value: '1', label: '1' },
        { value: '2', label: '2' },
      ],
      hint: 'Straight studs one pitch under the hooks: they sit in the holes so the bin cannot tilt or swing.',
    },
    { kind: 'number', id: 'dividers', label: 'Dividers', min: 0, max: 6, step: 1, hint: 'Walls across the inside, evenly spaced.' },
    { kind: 'boolean', id: 'drain', label: 'Drain hole in the floor' },
    ...MOUNT_FIELDS,
  ],
  defaults: { width: 90, depth: 60, height: 80, wall: 2, corner: 6, hooks: 'auto', rows: 'auto', dividers: 0, drain: false, ...MOUNT_DEFAULTS },
  notes: 'Prints standing up. The rods are a printed BROR holder\'s, copied 1:1: they rest on the back wall\'s top edge and go straight through the holes; straight studs below sit in the holes so it cannot tilt. The gusset under each rod prints it without support. The parts export as one body. Check hole diameter and sheet thickness on your board first.',
  preview: (spec: ProductSpec) => {
    const width = num(spec, 'width', 90)
    const height = num(spec, 'height', 80)
    const { dims, pitch, pattern } = mountFrom(spec)
    const hooks = hookCount(width, str(spec, 'hooks', 'auto'), pitch, dims.tabWidth)
    const studs = studRows(spec, height, pitch, dims)
    const span = (hooks - 1) * pitch
    const top = height - shankCenter(height, dims) - dims.tabThickness / 2
    const anchors = []
    for (let r = 0; r <= studs; r++) for (let i = 0; i < hooks; i++) anchors.push({ x: width / 2 - span / 2 + i * pitch - dims.tabWidth / 2, y: top + r * pitch, width: dims.tabWidth, height: dims.tabThickness })
    const studNote = studs > 0 ? ` + ${hooks * studs} stud${hooks * studs === 1 ? '' : 's'}` : ''
    return { pattern, silhouette: { width, height }, anchors, caption: `Back view · ${hooks} hook${hooks === 1 ? '' : 's'}${studNote} on the ${pitch} mm grid` }
  },
  build: (spec: ProductSpec) => {
    const width = num(spec, 'width', 90)
    const depth = num(spec, 'depth', 60)
    const height = num(spec, 'height', 80)
    const wall = num(spec, 'wall', 2)
    const corner = Math.max(0, Math.min(num(spec, 'corner', 6), Math.min(width, depth) / 2 - wall))
    const drain = bool(spec, 'drain', false)
    const { dims, pitch, reach } = mountFrom(spec)
    const hooks = hookCount(width, str(spec, 'hooks', 'auto'), pitch, dims.tabWidth)
    const studs = studRows(spec, height, pitch, dims)
    const embed = Math.min(1, wall / 2)
    const boxY = reach
    const center = shankCenter(height, dims)
    const parts: PartRecipe[] = [
      { name: 'Bin', color: COLOR, outline: { kind: 'path', points: binOutline(width, depth, corner, boxY) }, depth: height, hollow: { wall, floor: Math.max(wall, 1.6), openFrom: 'top' }, seam: 'back-left' },
    ]
    if (drain) {
      const d = Math.min(8, Math.max(3, Math.min(width, depth) / 4))
      parts.push({ name: 'Drain', outline: { kind: 'circle', x: width / 2 - d / 2, y: boxY + depth / 2 - d / 2, width: d, height: d }, depth: Math.max(wall, 1.6) + 2, z: -1, isHole: true })
    }
    parts.push(...dividerParts({ count: num(spec, 'dividers', 0), width, depth, height, wall, boxY, color: COLOR }))
    const span = (hooks - 1) * pitch
    for (let i = 0; i < hooks; i++) {
      parts.push(...rodParts({ standing: true, d: dims.tabThickness, gap: dims.gap, wall, color: COLOR, name: hooks === 1 ? 'Rod' : `Rod ${i + 1}`, cx: width / 2 - span / 2 + i * pitch, faceY: boxY, top: height }))
    }
    // Straight studs: a cylinder from inside the wall through the sheet
    // and one peg further (tilted 90° about x, a circle's extrusion runs
    // along depth).
    const studLength = embed + dims.gap + dims.tabThickness
    const d = dims.tabThickness
    let n = 0
    for (let r = 1; r <= studs; r++) {
      for (let i = 0; i < hooks; i++) {
        n++
        const cx = width / 2 - span / 2 + i * pitch
        const centerB = (dims.gap + dims.tabThickness - embed) / 2
        parts.push({
          name: hooks * studs === 1 ? 'Stud' : `Stud ${n}`,
          color: COLOR,
          outline: { kind: 'circle', x: cx - d / 2, y: boxY - centerB - d / 2, width: d, height: d },
          depth: studLength,
          rotation: { x: 90 },
          z: center - r * pitch - d / 2,
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
  notes: 'Prints lying on its side. A rounded peg sized to the hole goes through it and turns up behind the sheet; a hook wider than the peg gets the peg as a fused centre piece. Check hole diameter and sheet thickness on your board first.',
  preview: (spec: ProductSpec) => {
    const width = num(spec, 'width', 12)
    const plateH = num(spec, 'plate', 30)
    const { dims, pattern } = mountFrom(spec)
    const peg = Math.min(width, dims.tabWidth)
    const rise = dims.lipRise ?? 0
    return { pattern, silhouette: { width, height: plateH + dims.tabThickness + rise }, anchors: [{ x: width / 2 - peg / 2, y: rise, width: peg, height: dims.tabThickness }], caption: 'Back view · one hole' }
  },
  build: (spec: ProductSpec) => {
    const { dims } = mountFrom(spec)
    const width = num(spec, 'width', 12)
    const plateH = num(spec, 'plate', 30)
    const d = dims.tabThickness
    // The plate and arm from the shared J-hook (its own tab replaced by
    // a round peg): a wide-hook build gives the plate as the first part.
    const base = jHook({ mount: { ...dims, tabWidth: 0 }, reach: num(spec, 'reach', 40), width, arm: num(spec, 'arm', 5), tip: num(spec, 'tip', 10), plateH, color: COLOR })
    const plate = base.parts[0]
    const plateT = 4
    const offset = plateT + num(spec, 'reach', 40)
    // The rod sits above the plate's top edge (canvas y = lipRise, which
    // base.height already includes), centred across the plate's width
    // and resting on the bed when the plate is thinner than it.
    const peg = rodParts({ standing: false, d, gap: dims.gap, wall: plateT, color: COLOR, name: 'Rod', faceX: offset, topY: dims.lipRise ?? 0, zc: Math.max(d / 2, width / 2) })
    return { width: base.width, height: base.height, parts: [plate, ...peg], fuse: true }
  },
}
