import { bool, num, type PartRecipe, type ProductSpec, type ProductTemplate, type SpecField } from './types'
import { jHook, mountProfile, standingPath, type MountDims } from './mount'

/**
 * IKEA BROR: the perforated steel uprights and posts with a column of
 * slots. Unlike SKÅDIS the slot size and pitch are not something we
 * could verify against a drawing, so the mounting dimensions are fields
 * with starting values — measure a slot on your rail and set them once;
 * a wrong guess costs one small test print, not a whole bin.
 */
export const BROR_DEFAULT = { slotWidth: 6, slotHeight: 18, pitch: 32, sheet: 1.5 }

const COLOR = '#4d8dff'

/** The mounting fields every BROR product shares. */
const MOUNT_FIELDS: SpecField[] = [
  { kind: 'number', id: 'slotWidth', label: 'Slot width', unit: 'mm', min: 3, max: 15, step: 0.1, hint: 'Across the slot (the narrow side). Measure your rail.' },
  { kind: 'number', id: 'slotHeight', label: 'Slot height', unit: 'mm', min: 6, max: 40, step: 0.5, hint: 'Along the rail (the long side).' },
  { kind: 'number', id: 'pitch', label: 'Slot pitch', unit: 'mm', min: 10, max: 80, step: 0.5, hint: 'Centre to centre between slots along the rail.' },
  { kind: 'number', id: 'sheet', label: 'Sheet thickness', unit: 'mm', min: 0.8, max: 4, step: 0.1 },
]
const MOUNT_DEFAULTS: ProductSpec = { ...BROR_DEFAULT }

/** The tab that fits the slots described by the spec: 0.4 mm of play
 * across the slot, 1 mm along it, 0.6 mm of room for the sheet. */
function mountFrom(spec: ProductSpec): { dims: MountDims; tabWidth: number; pitch: number } {
  const slotWidth = num(spec, 'slotWidth', BROR_DEFAULT.slotWidth)
  const slotHeight = num(spec, 'slotHeight', BROR_DEFAULT.slotHeight)
  const sheet = num(spec, 'sheet', BROR_DEFAULT.sheet)
  const tabThickness = Math.max(2, slotWidth - 0.4)
  return {
    dims: { tabThickness, lipThickness: Math.max(3, tabThickness), gap: sheet + 0.6, lipDrop: Math.max(8, slotHeight * 0.7) },
    tabWidth: Math.max(3, slotHeight - 1),
    pitch: num(spec, 'pitch', BROR_DEFAULT.pitch),
  }
}

export const brorHook: ProductTemplate = {
  id: 'bror-hook',
  name: 'BROR hook',
  tagline: 'J-hook for the perforated upright',
  category: 'IKEA BROR',
  keywords: ['hook', 'hanger', 'rail', 'upright', 'post', 'ikea', 'bror'],
  fields: [
    { kind: 'number', id: 'reach', label: 'Arm length', unit: 'mm', min: 10, max: 100, step: 1 },
    { kind: 'number', id: 'arm', label: 'Arm thickness', unit: 'mm', min: 3, max: 10, step: 0.5 },
    { kind: 'number', id: 'tip', label: 'Tip height', unit: 'mm', min: 0, max: 40, step: 1 },
    { kind: 'number', id: 'plate', label: 'Back plate height', unit: 'mm', min: 10, max: 80, step: 1 },
    ...MOUNT_FIELDS,
  ],
  defaults: { reach: 40, arm: 5, tip: 10, plate: 30, ...MOUNT_DEFAULTS },
  notes: 'Prints lying on its side. The hook is as wide as the slot is long, so it fills one slot; the tab goes through and its lip drops behind the sheet. Check the mounting fields against your rail before printing.',
  build: (spec: ProductSpec) => {
    const { dims, tabWidth } = mountFrom(spec)
    return jHook({ mount: dims, reach: num(spec, 'reach', 40), width: tabWidth, arm: num(spec, 'arm', 5), tip: num(spec, 'tip', 10), plateH: num(spec, 'plate', 30), color: COLOR })
  },
}

export const brorBin: ProductTemplate = {
  id: 'bror-bin',
  name: 'BROR bin',
  tagline: 'Open bin hanging from one upright',
  category: 'IKEA BROR',
  keywords: ['box', 'basket', 'bin', 'container', 'rail', 'upright', 'ikea', 'bror'],
  fields: [
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 30, max: 240, step: 1 },
    { kind: 'number', id: 'depth', label: 'Depth', unit: 'mm', min: 20, max: 150, step: 1 },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 20, max: 200, step: 1 },
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1.2, max: 4, step: 0.2 },
    { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 30, step: 1 },
    { kind: 'number', id: 'tabs', label: 'Tabs (stacked)', min: 1, max: 4, step: 1, hint: 'Tabs one above the other, one slot pitch apart, all in the same column.' },
    { kind: 'boolean', id: 'drain', label: 'Drain hole in the floor' },
    ...MOUNT_FIELDS,
  ],
  defaults: { width: 100, depth: 60, height: 80, wall: 2, corner: 6, tabs: 2, drain: false, ...MOUNT_DEFAULTS },
  notes: 'Prints standing up. The tabs sit in one column on the back, one slot pitch apart, so the bin hangs from a single upright. Tab and lip undersides are 45°, no support needed. The parts export as one body.',
  build: (spec: ProductSpec) => {
    const width = num(spec, 'width', 100)
    const depth = num(spec, 'depth', 60)
    const height = num(spec, 'height', 80)
    const wall = num(spec, 'wall', 2)
    const corner = Math.max(0, Math.min(num(spec, 'corner', 6), Math.min(width, depth) / 2 - wall))
    const drain = bool(spec, 'drain', false)
    const { dims, tabWidth, pitch } = mountFrom(spec)
    const { points: profile, height: tabHeight } = mountProfile(dims, Math.min(1, wall / 2))
    const tabs = Math.max(1, Math.min(num(spec, 'tabs', 2), Math.floor((height - tabHeight) / pitch) + 1))
    const boxY = dims.gap + dims.lipThickness
    const parts: PartRecipe[] = [
      { name: 'Bin', color: COLOR, outline: { kind: 'rect', x: 0, y: boxY, width, height: depth }, depth: height, cornerRadius: corner, hollow: { wall, floor: Math.max(wall, 1.6), openFrom: 'top' } },
    ]
    if (drain) {
      const d = Math.min(8, Math.max(3, Math.min(width, depth) / 4))
      parts.push({ name: 'Drain', outline: { kind: 'circle', x: width / 2 - d / 2, y: boxY + depth / 2 - d / 2, width: d, height: d }, depth: Math.max(wall, 1.6) + 2, z: -1, isHole: true })
    }
    for (let i = 0; i < tabs; i++) {
      parts.push({
        name: tabs === 1 ? 'Tab' : `Tab ${i + 1}`,
        color: COLOR,
        outline: { kind: 'path', points: standingPath(profile, width / 2, tabHeight, boxY) },
        depth: tabWidth,
        rotation: { y: 90 },
        z: height - tabHeight - i * pitch,
      })
    }
    return { width, height: boxY + depth, parts, fuse: true }
  },
}
