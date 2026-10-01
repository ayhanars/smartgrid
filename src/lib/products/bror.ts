import { num, type ProductSpec, type ProductTemplate, type SpecField } from './types'
import { brorHookParts, HOOK_CLEAR, HOOK_PLAY, hookReach, jHook, type MountDims } from './mount'
import { scoopAnchors, scoopBinParts, scoopBinSpec } from './scoopBin'
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

/** The mounts, sized from the hole: a hook 1.2 mm thinner than the
 * hole and a stud 0.5 mm thinner (see brorHookParts). */
function mountFrom(spec: ProductSpec): { dims: MountDims; pitch: number; pattern: PegPattern; reach: number } {
  const hole = num(spec, 'hole', 6)
  const sheet = num(spec, 'sheet', 1.5)
  const pitch = num(spec, 'pitch', 30)
  const d = Math.max(2, Math.round((hole - HOOK_PLAY) * 10) / 10)
  const gap = sheet + HOOK_CLEAR
  const hook = hookReach(d)
  return {
    // lipThickness here is how far behind the sheet the hook reaches.
    dims: { tabThickness: d, tabWidth: d, lipThickness: hook.back, gap, lipDrop: 0, lipRise: hook.up - d / 2, round: Math.round((d / 2 - 0.1) * 10) / 10 },
    pitch,
    pattern: { kind: 'round', pitchX: pitch, pitchY: pitch, stagger: false, diameter: hole },
    reach: gap + hook.back,
  }
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
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 20, max: 200, step: 1, hint: 'At the back, where it hangs.' },
    { kind: 'number', id: 'front', label: 'Front height', unit: 'mm', min: 10, max: 200, step: 1, hint: 'Lower than the height makes a scoop: the sides slope down to it at 33°.' },
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1.2, max: 4, step: 0.1 },
    { kind: 'number', id: 'floor', label: 'Floor', unit: 'mm', min: 1.2, max: 10, step: 0.5 },
    { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 30, step: 0.5 },
    {
      kind: 'select',
      id: 'hooks',
      label: 'Hooks across',
      options: [
        { value: 'auto', label: 'Auto (30 mm in from each side)' },
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
        { value: 'auto', label: 'Auto (one)' },
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
  defaults: { width: 120, depth: 80, height: 70, front: 38, wall: 2.5, floor: 5, corner: 2.5, hooks: 'auto', rows: 'auto', dividers: 0, drain: false, ...MOUNT_DEFAULTS },
  notes: 'A printed BROR bin, copied 1:1. Prints standing up, no support. Each hook goes through its hole and bends 50° up behind the sheet, with a domed end; the stud one hole below sits straight in its hole so the bin cannot tilt. The parts export as one body. Check hole diameter and sheet thickness on your board first.',
  preview: (spec: ProductSpec) => {
    const { pitch, pattern } = mountFrom(spec)
    const s = scoopBinSpec(spec, { hole: num(spec, 'hole', 6), sheet: num(spec, 'sheet', 1.5), pitch })
    const studs = s.columns.length * s.studRows
    return { pattern, silhouette: { width: s.width, height: s.height }, anchors: scoopAnchors(s), caption: `Back view · ${s.columns.length} hook${s.columns.length === 1 ? '' : 's'}${studs ? ` + ${studs} stud${studs === 1 ? '' : 's'}` : ''} on the ${pitch} mm grid` }
  },
  build: (spec: ProductSpec) => {
    const { pitch } = mountFrom(spec)
    const s = scoopBinSpec(spec, { hole: num(spec, 'hole', 6), sheet: num(spec, 'sheet', 1.5), pitch })
    const { parts, boxY } = scoopBinParts(s, COLOR)
    return { width: s.width, height: boxY + s.depth, parts, fuse: true }
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
    // Shank centre: the hook's tip rises `lipRise` above the plate's top
    // (base.height already includes it). The hook is centred across the
    // plate's width, resting on the bed when the plate is thinner than it.
    const peg = brorHookParts({ standing: false, d, gap: dims.gap, embed: plateT - 0.5, color: COLOR, name: 'Hook', faceX: offset, shankY: hookReach(d).up, zc: Math.max(d / 2, width / 2) })
    return { width: base.width, height: base.height, parts: [plate, ...peg], fuse: true }
  },
}
