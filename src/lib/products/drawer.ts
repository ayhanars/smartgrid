import { bool, num, str, type BuildContext, type PartRecipe, type ProductBuild, type ProductSpec, type ProductTemplate, type TrayPreview } from './types'
import type { HoleShape, Perforation } from '../../types/document'

/**
 * Drawer organizers: a tray with a grid of compartments, built as one
 * joined tray or as separate boxes, that splits itself into tiles (one
 * per plate) when bigger than the bed, joined by clips that slide over
 * two neighbouring walls; and a grid of vertical divider plates, plain
 * or patterned, that slot into each other (top notches meet bottom
 * notches), no glue.
 */
const COLOR = '#e0a84a'

/** Clip that straddles two neighbouring tray walls, mm. */
const CLIP = { length: 14, thick: 2.4, height: 12, play: 0.4 }

type Layout = 'even' | 'first-half' | 'last-half'

/** Boundaries of a `count`-way split of `size`: even parts, or the
 * first part half the size of the others. */
function splits(size: number, count: number, firstHalf: boolean): number[] {
  const n = Math.max(1, Math.round(count))
  if (n === 1 || !firstHalf) return Array.from({ length: n + 1 }, (_, i) => (size * i) / n)
  const unit = size / (n - 0.5)
  const out = [0]
  for (let i = 1; i < n; i++) out.push(unit / 2 + unit * (i - 1))
  out.push(size)
  return out
}

/** Cuts for `n` tiles across `size`, snapped to the nearest compartment
 * line when one is within a third of a tile, so no compartment is
 * halved by a seam. */
function tileCuts(size: number, n: number, bounds: number[], wall: number): number[] {
  const cuts = [0]
  for (let k = 1; k < n; k++) {
    const ideal = (size * k) / n
    let best = ideal
    let dist = size / n / 3
    for (const b of bounds) {
      if (b > wall * 4 && b < size - wall * 4 && Math.abs(b - ideal) < dist) {
        dist = Math.abs(b - ideal)
        best = b
      }
    }
    cuts.push(best)
  }
  cuts.push(size)
  return cuts
}

const PATTERN_SHAPES: Record<string, HoleShape> = { round: 'round', hex: 'hex', slots: 'slot-v', square: 'square' }
const ELEVATION_SHAPES: Record<string, 'round' | 'hex' | 'slot' | 'square'> = { round: 'round', hex: 'hex', slots: 'slot', square: 'square' }

function patternFrom(spec: ProductSpec, target: Perforation['target'], inset: number): { perforation: Perforation | undefined; elevation: NonNullable<TrayPreview['elevation']>['holes'] } {
  const id = str(spec, 'pattern', 'none')
  const shape = PATTERN_SHAPES[id]
  if (!shape) return { perforation: undefined, elevation: null }
  const size = num(spec, 'patternSize', 5)
  const spacing = Math.round(size * 1.6 * 10) / 10
  const staggered = shape === 'hex' || shape === 'round'
  return {
    perforation: { shape, pattern: staggered ? 'staggered' : 'grid', size, spacing, target, depth: null, wallFrom: inset, wallTopMargin: inset, topInset: inset },
    elevation: { shape: ELEVATION_SHAPES[id], size, spacing, inset },
  }
}

const PATTERN_FIELDS = [
  {
    kind: 'select' as const,
    id: 'pattern',
    label: 'Pattern',
    options: [
      { value: 'none', label: 'Plain' },
      { value: 'round', label: 'Round holes' },
      { value: 'hex', label: 'Honeycomb' },
      { value: 'slots', label: 'Slots' },
      { value: 'square', label: 'Square grid' },
    ],
    hint: 'Perforates the walls: lighter, faster to print, and it shows what is inside.',
  },
  { kind: 'number' as const, id: 'patternSize', label: 'Pattern size', unit: 'mm' as const, min: 2, max: 20, step: 0.5, hint: 'Hole size; the spacing follows it.' },
]

// ---------------------------------------------------------------------------
// Drawer tray
// ---------------------------------------------------------------------------

interface TrayLayout {
  width: number
  depth: number
  height: number
  wall: number
  floor: number
  corner: number
  separate: boolean
  colBounds: number[]
  rowBounds: number[]
  tiles: { x: number; y: number; width: number; height: number; name: string; col: number; row: number }[]
  nx: number
  ny: number
  clips: boolean
}

function trayLayout(spec: ProductSpec, ctx: BuildContext): TrayLayout {
  const width = num(spec, 'width', 200)
  const depth = num(spec, 'depth', 150)
  const height = num(spec, 'height', 50)
  const wall = num(spec, 'wall', 1.6)
  const floor = num(spec, 'floor', 1.6)
  const corner = Math.max(0, Math.min(num(spec, 'corner', 3), 12))
  const separate = str(spec, 'build', 'joined') === 'separate'
  const layout = str(spec, 'layout', 'even') as Layout
  const colBounds = splits(width, num(spec, 'columns', 3), layout === 'first-half')
  const rowBounds = splits(depth, num(spec, 'rows', 2), layout === 'last-half')
  const split = str(spec, 'split', 'auto')
  const fitsW = ctx.bed.width - 4
  const fitsD = ctx.bed.height - 4
  const nx = split === 'none' ? 1 : Math.max(1, Math.ceil(width / fitsW - 1e-6))
  const ny = split === 'none' ? 1 : Math.max(1, Math.ceil(depth / fitsD - 1e-6))
  const cutsX = tileCuts(width, nx, colBounds, wall)
  const cutsY = tileCuts(depth, ny, rowBounds, wall)
  const tiles: TrayLayout['tiles'] = []
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      tiles.push({ x: cutsX[c], y: cutsY[r], width: cutsX[c + 1] - cutsX[c], height: cutsY[r + 1] - cutsY[r], name: nx * ny === 1 ? 'Tray' : `Tray ${r * nx + c + 1}`, col: c, row: r })
    }
  }
  return { width, depth, height, wall, floor, corner, separate, colBounds, rowBounds, tiles, nx, ny, clips: !separate && nx * ny > 1 && bool(spec, 'clips', true) }
}

/** Clip positions along a shared edge: two near the ends, one more per
 * 120 mm in between. */
function clipPositions(edge: number): number[] {
  const inset = Math.min(20, edge / 4)
  if (edge < 60) return [edge / 2]
  const n = Math.max(2, Math.round((edge - 2 * inset) / 120) + 1)
  return Array.from({ length: n }, (_, i) => inset + ((edge - 2 * inset) * i) / (n - 1))
}

/** The compartments as rectangles: whole cells, or (separate boxes)
 * each cell less a small gap so the boxes stay apart. */
function trayCells(l: TrayLayout): { x: number; y: number; width: number; height: number; col: number; row: number }[] {
  const cells = []
  for (let r = 0; r < l.rowBounds.length - 1; r++) {
    for (let c = 0; c < l.colBounds.length - 1; c++) {
      cells.push({ x: l.colBounds[c], y: l.rowBounds[r], width: l.colBounds[c + 1] - l.colBounds[c], height: l.rowBounds[r + 1] - l.rowBounds[r], col: c, row: r })
    }
  }
  return cells
}

const GAP = 1

export const drawerTray: ProductTemplate = {
  id: 'drawer-tray',
  name: 'Drawer tray',
  tagline: 'Compartment tray sized to your drawer',
  category: 'Drawers',
  keywords: ['drawer', 'tray', 'organizer', 'organiser', 'compartment', 'cutlery', 'desk', 'insert', 'grid', 'box', 'boxes'],
  fields: [
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 40, max: 900, step: 1, hint: 'Left to right in the drawer.' },
    { kind: 'number', id: 'depth', label: 'Depth', unit: 'mm', min: 40, max: 900, step: 1, hint: 'Front to back in the drawer.' },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 15, max: 150, step: 1 },
    { kind: 'number', id: 'columns', label: 'Columns', min: 1, max: 10, step: 1 },
    { kind: 'number', id: 'rows', label: 'Rows', min: 1, max: 10, step: 1 },
    {
      kind: 'select',
      id: 'layout',
      label: 'Layout',
      options: [
        { value: 'even', label: 'Even compartments' },
        { value: 'first-half', label: 'Narrow first column (pens, small bits)' },
        { value: 'last-half', label: 'Shallow front row' },
      ],
    },
    {
      kind: 'select',
      id: 'build',
      label: 'Build as',
      options: [
        { value: 'joined', label: 'One tray (shared walls)' },
        { value: 'separate', label: 'Separate boxes, one per compartment' },
      ],
      hint: 'Separate boxes can be rearranged in the drawer and printed a few at a time.',
    },
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1, max: 4, step: 0.2 },
    { kind: 'number', id: 'floor', label: 'Floor', unit: 'mm', min: 0.8, max: 4, step: 0.2 },
    { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 12, step: 0.5 },
    ...PATTERN_FIELDS,
    {
      kind: 'select',
      id: 'split',
      label: 'Bigger than the bed',
      options: [
        { value: 'auto', label: 'Split into tiles, one per plate' },
        { value: 'none', label: 'Keep whole (it will not fit)' },
      ],
    },
    { kind: 'boolean', id: 'clips', label: 'Clips to join the tiles (slide over the shared walls)' },
  ],
  defaults: { width: 200, depth: 150, height: 50, columns: 3, rows: 2, layout: 'even', build: 'joined', wall: 1.6, floor: 1.6, corner: 3, pattern: 'none', patternSize: 5, split: 'auto', clips: true },
  notes: 'Prints as an open tray, or as separate boxes. A tray wider or deeper than the bed is cut into tiles along compartment lines, each on its own plate, plus clips that slide down over two neighbouring walls to hold the tiles together in the drawer.',
  preview: (spec: ProductSpec, ctx: BuildContext): TrayPreview => {
    const l = trayLayout(spec, ctx)
    const cells = trayCells(l)
    const walls: TrayPreview['walls'] = []
    const open: TrayPreview['cells'] = []
    if (l.separate) {
      for (const c of cells) {
        const bx = c.x + GAP / 2, by = c.y + GAP / 2, bw = c.width - GAP, bh = c.height - GAP
        walls.push({ x: bx, y: by, width: bw, height: l.wall }, { x: bx, y: by + bh - l.wall, width: bw, height: l.wall }, { x: bx, y: by, width: l.wall, height: bh }, { x: bx + bw - l.wall, y: by, width: l.wall, height: bh })
        open.push({ x: bx + l.wall, y: by + l.wall, width: bw - 2 * l.wall, height: bh - 2 * l.wall })
      }
    } else {
      for (const t of l.tiles) {
        walls.push({ x: t.x, y: t.y, width: t.width, height: l.wall }, { x: t.x, y: t.y + t.height - l.wall, width: t.width, height: l.wall }, { x: t.x, y: t.y, width: l.wall, height: t.height }, { x: t.x + t.width - l.wall, y: t.y, width: l.wall, height: t.height })
        for (const b of l.colBounds.slice(1, -1)) if (b > t.x + l.wall * 2 && b < t.x + t.width - l.wall * 2) walls.push({ x: b - l.wall / 2, y: t.y, width: l.wall, height: t.height })
        for (const b of l.rowBounds.slice(1, -1)) if (b > t.y + l.wall * 2 && b < t.y + t.height - l.wall * 2) walls.push({ x: t.x, y: b - l.wall / 2, width: t.width, height: l.wall })
      }
      for (const c of cells) open.push({ x: c.x + l.wall / 2, y: c.y + l.wall / 2, width: c.width - l.wall, height: c.height - l.wall })
    }
    const joints: { x: number; y: number }[] = []
    if (l.clips) {
      for (const t of l.tiles) {
        if (t.col < l.nx - 1) for (const y of clipPositions(t.height)) joints.push({ x: t.x + t.width, y: t.y + y })
        if (t.row < l.ny - 1) for (const x of clipPositions(t.width)) joints.push({ x: t.x + x, y: t.y + t.height })
      }
    }
    const { elevation } = patternFrom(spec, 'walls', 3)
    const n = l.tiles.length
    const what = l.separate ? `${cells.length} box${cells.length === 1 ? '' : 'es'}` : `${cells.length} compartment${cells.length === 1 ? '' : 's'}`
    const caption = n === 1 ? `${l.width} × ${l.depth} × ${l.height} mm · ${what} · fits the ${ctx.bed.width} × ${ctx.bed.height} bed` : `${what} · ${n} plates for the ${ctx.bed.width} × ${ctx.bed.height} bed${l.clips ? ` · ${joints.length} clips` : ''}`
    return {
      kind: 'tray',
      width: l.width,
      depth: l.depth,
      height: l.height,
      cells: open,
      walls,
      tiles: l.tiles,
      bed: ctx.bed,
      joints,
      elevation: { length: l.separate ? cells[0].width - GAP : l.tiles[0].width, height: l.height, holes: elevation, notches: [], label: l.separate ? 'One box, front wall' : 'Front wall' },
      caption,
    }
  },
  build: (spec: ProductSpec, ctx: BuildContext): ProductBuild => {
    const l = trayLayout(spec, ctx)
    const parts: PartRecipe[] = []
    const { perforation } = patternFrom(spec, 'walls', 3)
    const hollow = { wall: l.wall, floor: l.floor, openFrom: 'top' as const }
    if (l.separate) {
      const cells = trayCells(l)
      const tileOf = (c: { x: number; y: number }) => l.tiles.findIndex((t) => c.x >= t.x - 1e-6 && c.x < t.x + t.width - 1e-6 && c.y >= t.y - 1e-6 && c.y < t.y + t.height - 1e-6)
      cells.forEach((c, i) => {
        const k = Math.max(0, tileOf(c))
        parts.push({ name: cells.length === 1 ? 'Box' : `Box ${i + 1}`, color: COLOR, outline: { kind: 'rect', x: c.x + GAP / 2, y: c.y + GAP / 2, width: c.width - GAP, height: c.height - GAP }, depth: l.height, cornerRadius: Math.min(l.corner, (Math.min(c.width, c.height) - GAP) / 2 - l.wall), hollow, perforation, tile: k })
      })
      return { width: l.width, height: l.depth, parts, fuse: false, tiles: l.tiles.length > 1 ? l.tiles.map((t) => t.name) : undefined }
    }
    l.tiles.forEach((t, k) => {
      parts.push({ name: t.name, color: COLOR, outline: { kind: 'rect', x: t.x, y: t.y, width: t.width, height: t.height }, depth: l.height, cornerRadius: l.corner, hollow, perforation, tile: k })
      let n = 0
      for (const b of l.colBounds.slice(1, -1)) {
        if (b <= t.x + l.wall * 2 || b >= t.x + t.width - l.wall * 2) continue
        parts.push({ name: `Divider ${++n}`, color: COLOR, outline: { kind: 'rect', x: b - l.wall / 2, y: t.y + l.wall - 0.5, width: l.wall, height: t.height - 2 * l.wall + 1 }, depth: Math.max(2, l.height - 1), z: 0, tile: k })
      }
      for (const b of l.rowBounds.slice(1, -1)) {
        if (b <= t.y + l.wall * 2 || b >= t.y + t.height - l.wall * 2) continue
        parts.push({ name: `Divider ${++n}`, color: COLOR, outline: { kind: 'rect', x: t.x + l.wall - 0.5, y: b - l.wall / 2, width: t.width - 2 * l.wall + 1, height: l.wall }, depth: Math.max(2, l.height - 1), z: 0, tile: k })
      }
    })
    if (l.clips) {
      let count = 0
      for (const t of l.tiles) {
        if (t.col < l.nx - 1) count += clipPositions(t.height).length
        if (t.row < l.ny - 1) count += clipPositions(t.width).length
      }
      const slot = l.wall + CLIP.play
      const clipW = 2 * slot + 3 * CLIP.thick
      const first = l.tiles[0]
      for (let i = 0; i < count; i++) {
        const cx = first.x + first.width + 6 + (i % 4) * (CLIP.length + 4)
        const cy = first.y + Math.floor(i / 4) * (clipW + 4)
        parts.push({ name: `Clip ${i + 1}`, color: COLOR, outline: { kind: 'rect', x: cx, y: cy, width: CLIP.length, height: clipW }, depth: CLIP.height, cornerRadius: 1, tile: 0 })
        // Two slots open at the top and both ends, closed by a base at
        // the bottom (an E profile), so the clip caps the two walls.
        for (const s of [0, 1]) {
          parts.push({ name: `Clip ${i + 1} slot`, outline: { kind: 'rect', x: cx - 1, y: cy + CLIP.thick + s * (slot + CLIP.thick), width: CLIP.length + 2, height: slot }, depth: CLIP.height - CLIP.thick + 1, z: CLIP.thick, isHole: true, tile: 0 })
        }
      }
    }
    const width = l.clips ? l.width + 6 + 4 * (CLIP.length + 4) : l.width
    return { width, height: l.depth, parts, fuse: true, tiles: l.tiles.length > 1 ? l.tiles.map((t) => t.name) : undefined }
  },
}

// ---------------------------------------------------------------------------
// Divider grid: vertical plates that slot into each other
// ---------------------------------------------------------------------------

interface GridLayout {
  width: number
  depth: number
  height: number
  thickness: number
  play: number
  cols: number
  rows: number
  /** Positions of the plates running front to back (across the width). */
  acrossX: number[]
  /** Positions of the plates running left to right (across the depth). */
  alongY: number[]
  /** Pieces a long plate is cut into for the bed. */
  piecesAlong: number
  piecesAcross: number
  pattern: ReturnType<typeof patternFrom>
}

function gridLayout(spec: ProductSpec, ctx: BuildContext): GridLayout {
  const width = num(spec, 'width', 300)
  const depth = num(spec, 'depth', 200)
  const height = num(spec, 'height', 40)
  const thickness = num(spec, 'thickness', 2)
  const cols = Math.max(1, Math.round(num(spec, 'columns', 3)))
  const rows = Math.max(1, Math.round(num(spec, 'rows', 2)))
  const acrossX = Array.from({ length: cols - 1 }, (_, i) => (width * (i + 1)) / cols)
  const alongY = Array.from({ length: rows - 1 }, (_, i) => (depth * (i + 1)) / rows)
  const fits = ctx.bed.width - 4
  return { width, depth, height, thickness, play: 0.3, cols, rows, acrossX, alongY, piecesAlong: Math.max(1, Math.ceil(width / fits - 1e-6)), piecesAcross: Math.max(1, Math.ceil(depth / fits - 1e-6)), pattern: patternFrom(spec, 'top', 4) }
}

/** One plate lying flat (canvas x along it, y its height), cut into
 * pieces for the bed, with its notches and half-laps. */
function platePart(o: { name: string; length: number; y0: number; l: GridLayout; notchAt: number[]; fromTop: boolean; pieces: number; tileBase: number; feet: boolean }): PartRecipe[] {
  const { name, length, y0, l, notchAt, fromTop, pieces, tileBase, feet } = o
  const parts: PartRecipe[] = []
  const slot = l.thickness + l.play
  const pieceLen = length / pieces
  const footLen = feet ? Math.max(8, l.height / 3) : 0
  for (let p = 0; p < pieces; p++) {
    const x0 = pieceLen * p
    const tile = tileBase + p
    parts.push({ name: pieces > 1 ? `${name} piece ${p + 1}` : name, color: COLOR, outline: { kind: 'rect', x: x0, y: y0, width: pieceLen, height: l.height }, depth: l.thickness, cornerRadius: 0.5, perforation: l.pattern.perforation, tile })
    for (const cx of notchAt) {
      if (cx < x0 + slot || cx > x0 + pieceLen - slot) continue
      parts.push({ name: 'Notch', outline: { kind: 'rect', x: cx - slot / 2, y: fromTop ? y0 - 1 : y0 + l.height / 2, width: slot, height: l.height / 2 + 1 }, depth: l.thickness + 2, z: -1, isHole: true, tile })
    }
    if (pieces > 1) {
      const lap = 10
      // The cutters run 1 mm past the end so no face is coplanar with it.
      if (p > 0) parts.push({ name: 'Lap', outline: { kind: 'rect', x: x0 - 1, y: y0 - 1, width: lap + 1, height: l.height + 2 }, depth: l.thickness / 2 + 1, z: l.thickness / 2, isHole: true, tile })
      if (p < pieces - 1) parts.push({ name: 'Lap', outline: { kind: 'rect', x: x0 + pieceLen - lap, y: y0 - 1, width: lap + 1, height: l.height + 2 }, depth: l.thickness / 2 + 1, z: -1, isHole: true, tile })
    }
    if (feet) {
      for (const end of [0, 1]) {
        if ((end === 0 && p > 0) || (end === 1 && p < pieces - 1)) continue
        const fx = end === 0 ? x0 : x0 + pieceLen - l.thickness
        parts.push({ name: 'Foot', color: COLOR, outline: { kind: 'rect', x: fx, y: y0 + l.height - 0.5, width: l.thickness, height: footLen + 0.5 }, depth: l.thickness, tile })
      }
    }
  }
  return parts
}

export const drawerDivider: ProductTemplate = {
  id: 'drawer-divider',
  name: 'Divider grid',
  tagline: 'Vertical plates that slot into each other',
  category: 'Drawers',
  keywords: ['drawer', 'divider', 'strip', 'plate', 'grid', 'egg crate', 'notch', 'organizer', 'organiser', 'interlock'],
  fields: [
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 30, max: 900, step: 1, hint: 'Left to right in the drawer.' },
    { kind: 'number', id: 'depth', label: 'Depth', unit: 'mm', min: 30, max: 900, step: 1, hint: 'Front to back in the drawer.' },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 10, max: 120, step: 1 },
    { kind: 'number', id: 'columns', label: 'Columns', min: 1, max: 10, step: 1, hint: 'Plates running front to back: one less than the columns.' },
    { kind: 'number', id: 'rows', label: 'Rows', min: 1, max: 10, step: 1, hint: 'Plates running left to right: one less than the rows.' },
    { kind: 'number', id: 'thickness', label: 'Plate thickness', unit: 'mm', min: 1.2, max: 6, step: 0.2 },
    ...PATTERN_FIELDS,
    { kind: 'boolean', id: 'outer', label: 'Outer frame too (four plates around the grid)' },
    { kind: 'boolean', id: 'feet', label: 'Feet at the plate ends (a single plate stands on its own)' },
  ],
  defaults: { width: 300, depth: 200, height: 40, columns: 3, rows: 2, thickness: 2, pattern: 'none', patternSize: 5, outer: false, feet: false },
  notes: 'Prints lying flat. The plates running one way get notches from the top, the ones running the other way from the bottom, at the same spots, so they push together into a grid, no glue. A plate longer than the bed is cut in two with a half-lap joint.',
  preview: (spec: ProductSpec, ctx: BuildContext): TrayPreview => {
    const l = gridLayout(spec, ctx)
    const outer = bool(spec, 'outer', false)
    const t = l.thickness
    const walls: TrayPreview['walls'] = []
    for (const x of l.acrossX) walls.push({ x: x - t / 2, y: 0, width: t, height: l.depth })
    for (const y of l.alongY) walls.push({ x: 0, y: y - t / 2, width: l.width, height: t })
    if (outer) walls.push({ x: 0, y: 0, width: l.width, height: t }, { x: 0, y: l.depth - t, width: l.width, height: t }, { x: 0, y: 0, width: t, height: l.depth }, { x: l.width - t, y: 0, width: t, height: l.depth })
    const cells = []
    const xs = [0, ...l.acrossX, l.width]
    const ys = [0, ...l.alongY, l.depth]
    for (let r = 0; r < ys.length - 1; r++) for (let c = 0; c < xs.length - 1; c++) cells.push({ x: xs[c] + t / 2, y: ys[r] + t / 2, width: xs[c + 1] - xs[c] - t, height: ys[r + 1] - ys[r] - t })
    const plates = l.acrossX.length + l.alongY.length + (outer ? 4 : 0)
    const pieces = l.acrossX.length * l.piecesAcross + l.alongY.length * l.piecesAlong + (outer ? 2 * l.piecesAlong + 2 * l.piecesAcross : 0)
    const notches = l.alongY.length > 0 ? l.acrossX.map((x) => ({ x, width: t + l.play, depth: l.height / 2, fromTop: true })) : []
    return {
      kind: 'tray',
      width: l.width,
      depth: l.depth,
      height: l.height,
      cells,
      walls,
      tiles: [{ x: 0, y: 0, width: l.width, height: l.depth, name: 'Grid' }],
      bed: ctx.bed,
      elevation: { length: l.width, height: l.height, holes: l.pattern.elevation, notches, label: l.alongY.length > 0 ? 'A left-to-right plate, notched from the top' : 'A plate' },
      caption: `${plates} plate${plates === 1 ? '' : 's'}, ${cells.length} compartment${cells.length === 1 ? '' : 's'}${pieces > plates ? ` · ${pieces} pieces for the ${ctx.bed.width} mm bed` : ''}`,
    }
  },
  build: (spec: ProductSpec, ctx: BuildContext): ProductBuild => {
    const l = gridLayout(spec, ctx)
    const outer = bool(spec, 'outer', false)
    const feet = bool(spec, 'feet', false) && !outer
    const parts: PartRecipe[] = []
    const gap = 4
    let y0 = 0
    let tile = 0
    const perBed = Math.max(1, Math.floor((ctx.bed.height - 4) / (l.height + gap + (feet ? Math.max(8, l.height / 3) : 0))))
    let onThisTile = 0
    const next = (pieces: number) => {
      // A new plate row on the plate; a fresh tile when this one is full.
      if (onThisTile >= perBed) {
        onThisTile = 0
        tile += Math.max(1, pieces)
        y0 = 0
      }
    }
    const add = (name: string, length: number, notchAt: number[], fromTop: boolean, pieces: number) => {
      next(pieces)
      parts.push(...platePart({ name, length, y0, l, notchAt, fromTop, pieces, tileBase: tile, feet }))
      y0 += l.height + gap + (feet ? Math.max(8, l.height / 3) : 0)
      onThisTile++
    }
    // Left-to-right plates (along the width): notched from the top where
    // the front-to-back plates cross.
    l.alongY.forEach((_, i) => add(l.alongY.length === 1 ? 'Long plate' : `Long plate ${i + 1}`, l.width, l.acrossX, true, l.piecesAlong))
    // Front-to-back plates: notched from the bottom.
    l.acrossX.forEach((_, i) => add(l.acrossX.length === 1 ? 'Cross plate' : `Cross plate ${i + 1}`, l.depth, l.alongY, false, l.piecesAcross))
    if (outer) {
      add('Front', l.width, l.acrossX, true, l.piecesAlong)
      add('Back', l.width, l.acrossX, true, l.piecesAlong)
      add('Left', l.depth, l.alongY, false, l.piecesAcross)
      add('Right', l.depth, l.alongY, false, l.piecesAcross)
    }
    if (parts.length === 0) {
      // One column, one row: a single plain plate the width of the drawer.
      add('Plate', l.width, [], true, l.piecesAlong)
    }
    const tiles = tile > 0 || l.piecesAlong > 1 || l.piecesAcross > 1 ? Array.from({ length: Math.max(...parts.map((p) => (p.tile ?? 0) + 1)) }, (_, i) => `Plate set ${i + 1}`) : undefined
    return { width: Math.max(l.width, l.depth), height: y0, parts, fuse: true, tiles }
  },
}
