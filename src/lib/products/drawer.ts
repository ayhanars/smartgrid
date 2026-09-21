import { bool, num, str, type BuildContext, type PartRecipe, type ProductBuild, type ProductSpec, type ProductTemplate, type TrayPreview } from './types'
import type { HoleShape } from '../../types/document'

/**
 * Drawer organizers: a tray with a grid of compartments that, when it
 * is bigger than the printer's bed, splits itself into tiles (one per
 * plate) joined by clips that slide over two neighbouring walls; and
 * notched divider strips that cross each other to make a grid on their
 * own.
 */
const COLOR = '#e0a84a'

/** Clip that straddles two neighbouring tray walls, mm. */
const CLIP = { length: 14, thick: 2.4, height: 12, play: 0.4 }

/** Boundaries of a `count`-way split of `size`, by layout: even parts,
 * or the first part half the size of the others. */
function splits(size: number, count: number, layout: 'even' | 'first-half' | 'last-half'): number[] {
  const n = Math.max(1, Math.round(count))
  if (n === 1 || layout === 'even') return Array.from({ length: n + 1 }, (_, i) => (size * i) / n)
  // n − 1 whole parts and one half part: n − 0.5 units.
  const unit = size / (n - 0.5)
  const out = [0]
  for (let i = 1; i < n; i++) out.push(layout === 'first-half' ? unit / 2 + unit * (i - 1) : unit * i)
  out.push(size)
  return out
}

interface TrayLayout {
  width: number
  depth: number
  height: number
  wall: number
  floor: number
  corner: number
  colBounds: number[]
  rowBounds: number[]
  tiles: { x: number; y: number; width: number; height: number; name: string; col: number; row: number }[]
  nx: number
  ny: number
  clips: boolean
}

function layoutFrom(spec: ProductSpec, ctx: BuildContext): TrayLayout {
  const width = num(spec, 'width', 200)
  const depth = num(spec, 'depth', 150)
  const height = num(spec, 'height', 50)
  const wall = num(spec, 'wall', 1.6)
  const floor = num(spec, 'floor', 1.6)
  const corner = Math.max(0, Math.min(num(spec, 'corner', 3), 12))
  const layout = str(spec, 'layout', 'even') as 'even' | 'first-half' | 'last-half'
  const colBounds = splits(width, num(spec, 'columns', 3), layout === 'even' ? 'even' : layout === 'first-half' ? 'first-half' : 'even')
  const rowBounds = splits(depth, num(spec, 'rows', 2), layout === 'last-half' ? 'first-half' : 'even')
  const split = str(spec, 'split', 'auto')
  const margin = 4
  const fitsW = ctx.bed.width - margin
  const fitsD = ctx.bed.height - margin
  const nx = split === 'none' ? 1 : Math.max(1, Math.ceil(width / fitsW - 1e-6))
  const ny = split === 'none' ? 1 : Math.max(1, Math.ceil(depth / fitsD - 1e-6))
  // Tiles cut on compartment lines where possible: the boundary nearest
  // to an even split, so no compartment is halved by a seam.
  const cutsX = tileCuts(width, nx, colBounds, wall)
  const cutsY = tileCuts(depth, ny, rowBounds, wall)
  const tiles: TrayLayout['tiles'] = []
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      tiles.push({ x: cutsX[c], y: cutsY[r], width: cutsX[c + 1] - cutsX[c], height: cutsY[r + 1] - cutsY[r], name: nx * ny === 1 ? 'Tray' : `Tray ${r * nx + c + 1}`, col: c, row: r })
    }
  }
  return { width, depth, height, wall, floor, corner, colBounds, rowBounds, tiles, nx, ny, clips: nx * ny > 1 && bool(spec, 'clips', true) }
}

function tileCuts(size: number, n: number, bounds: number[], wall: number): number[] {
  const cuts = [0]
  for (let k = 1; k < n; k++) {
    const ideal = (size * k) / n
    const inner = bounds.filter((b) => b > wall * 4 && b < size - wall * 4)
    let best = ideal
    let dist = size / n / 3 // only snap to a line within a third of a tile
    for (const b of inner) {
      if (Math.abs(b - ideal) < dist) {
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

export const drawerTray: ProductTemplate = {
  id: 'drawer-tray',
  name: 'Drawer tray',
  tagline: 'Compartment tray sized to your drawer',
  category: 'Drawers',
  keywords: ['drawer', 'tray', 'organizer', 'organiser', 'compartment', 'cutlery', 'desk', 'insert', 'grid'],
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
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 1, max: 4, step: 0.2 },
    { kind: 'number', id: 'floor', label: 'Floor', unit: 'mm', min: 0.8, max: 4, step: 0.2 },
    { kind: 'number', id: 'corner', label: 'Corner radius', unit: 'mm', min: 0, max: 12, step: 0.5 },
    {
      kind: 'select',
      id: 'pattern',
      label: 'Pattern',
      options: [
        { value: 'none', label: 'Plain walls' },
        { value: 'round', label: 'Round holes' },
        { value: 'hex', label: 'Honeycomb' },
        { value: 'slots', label: 'Slots' },
        { value: 'square', label: 'Square grid' },
      ],
      hint: 'Perforates the outer walls: lighter, faster, and it shows what is inside.',
    },
    { kind: 'number', id: 'patternSize', label: 'Pattern size', unit: 'mm', min: 2, max: 20, step: 0.5, hint: 'Hole size; the spacing follows it.' },
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
  defaults: { width: 200, depth: 150, height: 50, columns: 3, rows: 2, layout: 'even', wall: 1.6, floor: 1.6, corner: 3, pattern: 'none', patternSize: 5, split: 'auto', clips: true },
  notes: 'Prints as an open tray. A tray wider or deeper than the bed is cut into tiles along compartment lines, each on its own plate, plus clips that slide down over two neighbouring walls to hold the tiles together in the drawer. Walls are full height; the parts of a tile export as one body.',
  preview: (spec: ProductSpec, ctx: BuildContext): TrayPreview => {
    const l = layoutFrom(spec, ctx)
    const cells = []
    for (let r = 0; r < l.rowBounds.length - 1; r++) for (let c = 0; c < l.colBounds.length - 1; c++) cells.push({ x: l.colBounds[c], y: l.rowBounds[r], width: l.colBounds[c + 1] - l.colBounds[c], height: l.rowBounds[r + 1] - l.rowBounds[r] })
    const joints: { x: number; y: number }[] = []
    if (l.clips) {
      for (const t of l.tiles) {
        if (t.col < l.nx - 1) for (const y of clipPositions(t.height)) joints.push({ x: t.x + t.width, y: t.y + y })
        if (t.row < l.ny - 1) for (const x of clipPositions(t.width)) joints.push({ x: t.x + x, y: t.y + t.height })
      }
    }
    const n = l.tiles.length
    const caption = n === 1 ? `${l.width} × ${l.depth} × ${l.height} mm · ${cells.length} compartment${cells.length === 1 ? '' : 's'} · fits the ${ctx.bed.width} × ${ctx.bed.height} bed` : `${n} tiles for the ${ctx.bed.width} × ${ctx.bed.height} bed, one per plate${l.clips ? ` · ${joints.length} clips` : ''} · ${cells.length} compartments`
    return { kind: 'tray', width: l.width, depth: l.depth, cells, tiles: l.tiles, bed: ctx.bed, joints, caption }
  },
  build: (spec: ProductSpec, ctx: BuildContext): ProductBuild => {
    const l = layoutFrom(spec, ctx)
    const parts: PartRecipe[] = []
    const shape = PATTERN_SHAPES[str(spec, 'pattern', 'none')]
    const size = num(spec, 'patternSize', 5)
    const perforation = shape ? { shape, pattern: shape === 'hex' || shape === 'round' ? ('staggered' as const) : ('grid' as const), size, spacing: Math.round(size * 1.6 * 10) / 10, target: 'walls' as const, depth: null } : undefined
    l.tiles.forEach((t, k) => {
      const tileHeight = l.height
      parts.push({
        name: t.name,
        color: COLOR,
        outline: { kind: 'rect', x: t.x, y: t.y, width: t.width, height: t.height },
        depth: tileHeight,
        cornerRadius: l.corner,
        hollow: { wall: l.wall, floor: l.floor, openFrom: 'top' },
        perforation,
        tile: k,
      })
      // Dividers on the compartment lines that fall inside this tile.
      let n = 0
      for (const b of l.colBounds.slice(1, -1)) {
        if (b <= t.x + l.wall * 2 || b >= t.x + t.width - l.wall * 2) continue
        parts.push({ name: `Divider ${++n}`, color: COLOR, outline: { kind: 'rect', x: b - l.wall / 2, y: t.y + l.wall - 0.5, width: l.wall, height: t.height - 2 * l.wall + 1 }, depth: Math.max(2, tileHeight - 1), z: 0, tile: k })
      }
      for (const b of l.rowBounds.slice(1, -1)) {
        if (b <= t.y + l.wall * 2 || b >= t.y + t.height - l.wall * 2) continue
        parts.push({ name: `Divider ${++n}`, color: COLOR, outline: { kind: 'rect', x: t.x + l.wall - 0.5, y: b - l.wall / 2, width: t.width - 2 * l.wall + 1, height: l.wall }, depth: Math.max(2, tileHeight - 1), z: 0, tile: k })
      }
    })
    // Clips: a block with two slots that slides over the two walls where
    // tiles meet. They print with the first tile, beside it.
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
    const width = l.tiles.length > 1 ? l.width + 6 + 4 * (CLIP.length + 4) : l.width
    return { width, height: l.depth, parts, fuse: true, tiles: l.tiles.map((t) => t.name) }
  },
}

/** Clip positions along a shared edge: two near the ends, one more per
 * 120 mm in between. */
function clipPositions(edge: number): number[] {
  const inset = Math.min(20, edge / 4)
  if (edge < 60) return [edge / 2]
  const n = Math.max(2, Math.round((edge - 2 * inset) / 120) + 1)
  return Array.from({ length: n }, (_, i) => inset + ((edge - 2 * inset) * i) / (n - 1))
}

export const drawerDivider: ProductTemplate = {
  id: 'drawer-divider',
  name: 'Notched divider',
  tagline: 'Strips that cross each other into a grid',
  category: 'Drawers',
  keywords: ['drawer', 'divider', 'strip', 'grid', 'egg crate', 'notch', 'organizer', 'organiser'],
  fields: [
    { kind: 'number', id: 'length', label: 'Length', unit: 'mm', min: 30, max: 900, step: 1 },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 10, max: 120, step: 1 },
    { kind: 'number', id: 'thickness', label: 'Thickness', unit: 'mm', min: 1.2, max: 6, step: 0.2 },
    { kind: 'number', id: 'notches', label: 'Notches', min: 0, max: 12, step: 1, hint: 'Slots for the crossing strips, evenly spaced. Make the crossing strips with the notches on the other edge.' },
    {
      kind: 'select',
      id: 'edge',
      label: 'Notches on',
      options: [
        { value: 'top', label: 'Top edge' },
        { value: 'bottom', label: 'Bottom edge' },
      ],
    },
    { kind: 'number', id: 'crossing', label: 'Crossing strip thickness', unit: 'mm', min: 1.2, max: 6, step: 0.2, hint: 'The notch is this plus 0.3 mm of play.' },
    { kind: 'boolean', id: 'feet', label: 'Feet at the ends (stands on its own)' },
    { kind: 'number', id: 'count', label: 'How many', min: 1, max: 12, step: 1 },
  ],
  defaults: { length: 200, height: 40, thickness: 2, notches: 2, edge: 'top', crossing: 2, feet: false, count: 1 },
  notes: 'Prints lying flat. Strips with top notches cross strips with bottom notches at the same spacing, no glue needed. Strips longer than the bed are cut in two with a half-lap joint.',
  preview: (spec: ProductSpec, ctx: BuildContext): TrayPreview => {
    const length = num(spec, 'length', 200)
    const height = num(spec, 'height', 40)
    const notches = num(spec, 'notches', 2)
    const thick = num(spec, 'crossing', 2) + 0.3
    const top = str(spec, 'edge', 'top') === 'top'
    const cells = Array.from({ length: notches }, (_, i) => ({ x: (length * (i + 1)) / (notches + 1) - thick / 2, y: top ? 0 : height / 2, width: thick, height: height / 2 }))
    const pieces = Math.max(1, Math.ceil(length / (ctx.bed.width - 4) - 1e-6))
    const tiles = Array.from({ length: pieces }, (_, i) => ({ x: (length * i) / pieces, y: 0, width: length / pieces, height, name: pieces === 1 ? 'Strip' : `Piece ${i + 1}` }))
    return { kind: 'tray', width: length, depth: height, cells, tiles, bed: ctx.bed, caption: `Side view · ${notches} notch${notches === 1 ? '' : 'es'} ${top ? 'from the top' : 'from the bottom'}${pieces > 1 ? ` · ${pieces} pieces for the bed` : ''}` }
  },
  build: (spec: ProductSpec, ctx: BuildContext): ProductBuild => {
    const length = num(spec, 'length', 200)
    const height = num(spec, 'height', 40)
    const thickness = num(spec, 'thickness', 2)
    const notches = num(spec, 'notches', 2)
    const slot = num(spec, 'crossing', 2) + 0.3
    const top = str(spec, 'edge', 'top') === 'top'
    const feet = bool(spec, 'feet', false)
    const count = num(spec, 'count', 1)
    const pieces = Math.max(1, Math.ceil(length / (ctx.bed.width - 4) - 1e-6))
    const parts: PartRecipe[] = []
    const gap = 4
    const footLen = feet ? Math.max(8, height / 3) : 0
    for (let n = 0; n < count; n++) {
      const y0 = n * (height + footLen + gap)
      for (let p = 0; p < pieces; p++) {
        const x0 = (length * p) / pieces
        const pieceLen = length / pieces
        const label = count > 1 ? `Strip ${n + 1}${pieces > 1 ? ` piece ${p + 1}` : ''}` : pieces > 1 ? `Piece ${p + 1}` : 'Strip'
        // Lying flat: canvas x along the strip, canvas y its height.
        parts.push({ name: label, color: COLOR, outline: { kind: 'rect', x: x0, y: y0, width: pieceLen, height }, depth: thickness, cornerRadius: 0.5, tile: p })
        for (let i = 0; i < notches; i++) {
          const cx = (length * (i + 1)) / (notches + 1)
          if (cx < x0 + slot || cx > x0 + pieceLen - slot) continue
          parts.push({ name: `Notch ${i + 1}`, outline: { kind: 'rect', x: cx - slot / 2, y: top ? y0 - 1 : y0 + height / 2, width: slot, height: height / 2 + 1 }, depth: thickness + 2, z: -1, isHole: true, tile: p })
        }
        // Half-lap where a strip was cut: each piece keeps half the
        // thickness over `lap` mm, one from the top half, one from the bottom.
        if (pieces > 1) {
          const lap = 10
          if (p > 0) parts.push({ name: `Lap ${p}`, outline: { kind: 'rect', x: x0, y: y0 - 1, width: lap, height: height + 2 }, depth: thickness / 2 + 1, z: thickness / 2, isHole: true, tile: p })
          if (p < pieces - 1) parts.push({ name: `Lap ${p + 1}`, outline: { kind: 'rect', x: x0 + pieceLen - lap, y: y0 - 1, width: lap, height: height + 2 }, depth: thickness / 2 + 1, z: -1, isHole: true, tile: p })
        }
        if (feet) {
          // An L-foot at each end of the first and last piece, standing
          // out of the strip's plane: a small block along the bottom edge.
          for (const end of [0, 1]) {
            if ((end === 0 && p > 0) || (end === 1 && p < pieces - 1)) continue
            const fx = end === 0 ? x0 : x0 + pieceLen - thickness
            parts.push({ name: `Foot ${end + 1}`, color: COLOR, outline: { kind: 'rect', x: fx, y: y0 + height - 0.5, width: thickness, height: footLen + 0.5 }, depth: thickness, tile: p })
          }
        }
      }
    }
    return { width: length, height: count * (height + footLen + gap), parts, fuse: true, tiles: pieces > 1 ? Array.from({ length: pieces }, (_, i) => `Piece ${i + 1}`) : undefined }
  },
}
