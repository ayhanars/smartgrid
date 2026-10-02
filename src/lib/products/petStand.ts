import { bool, num, str, type PartRecipe, type ProductBuild, type ProductSpec, type ProductTemplate } from './types'
import type { Point2, ShapeRegion } from '../../types/document'
import { loadFont, textRegions } from '../text/textOutline'
import { standingPath } from './mount'

/**
 * A raised stand for a pet's bowl, with the pet's name in relief on the
 * front and a small figure over or under it. Two parts in two colours
 * that plug into each other and are glued: the body (a tapered shell
 * the bowl hangs in, resting on its rim) and the base band, whose
 * inner lip fits inside the body's open bottom. The body is modelled
 * rim-down, as it prints; turned over and set on the band it reads the
 * right way round.
 */
const BODY_COLOR = '#e9e3d7'
const BAND_COLOR = '#6f8161'

/** Walls lean out toward the base by this much per mm of height (8°). */
const TAPER = Math.tan((8 * Math.PI) / 180)
/** How far the bowl's rim overlaps the top, each side. */
const LEDGE = 6
const TOP_PLATE = 3
const LIP_H = 6
const LIP_T = 2
const PLAY = 0.3
const EMBOSS = 1.2
const EMBED = 2.5
const SLOT_W = 40
const SLOT_H = 14

/** A rounded square (`squircle`) or a circle of width `w` about (cx, cy). */
function footprint(shape: string, w: number, cx: number, cy: number): Point2[] {
  const pts: Point2[] = []
  if (shape === 'round') {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2
      pts.push({ x: cx + (w / 2) * Math.cos(a), y: cy + (w / 2) * Math.sin(a) })
    }
    return pts
  }
  const r = w * 0.26
  const h = w / 2 - r
  const corners = [
    { x: cx + h, y: cy + h, from: 0 },
    { x: cx - h, y: cy + h, from: Math.PI / 2 },
    { x: cx - h, y: cy - h, from: Math.PI },
    { x: cx + h, y: cy - h, from: (3 * Math.PI) / 2 },
  ]
  for (const c of corners) {
    for (let i = 0; i <= 10; i++) {
      const a = c.from + (i / 10) * (Math.PI / 2)
      pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })
    }
  }
  return pts
}

/** The figures, drawn in a 10 × 10 box (y up), as regions. */
function figureRegions(kind: string): ShapeRegion[] {
  const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 24): Point2[] => Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * Math.PI * 2), y: cy + ry * Math.sin((i / n) * Math.PI * 2) }))
  const region = (points: Point2[]): ShapeRegion => ({ outer: { points }, holes: [] })
  if (kind === 'paw') {
    // A big pad, three toes over it and one to the side.
    const pad = ellipse(5, 3.2, 3.2, 2.6)
    return [region(pad), region(ellipse(1.6, 6.2, 1.2, 1.5)), region(ellipse(4.0, 8.2, 1.25, 1.6)), region(ellipse(6.6, 8.1, 1.25, 1.6)), region(ellipse(8.8, 5.9, 1.2, 1.5))]
  }
  if (kind === 'bone') {
    // A shaft with a knob at each corner; the pieces overlap and fuse.
    const shaft: Point2[] = [
      { x: 2.2, y: 3.6 },
      { x: 7.8, y: 3.6 },
      { x: 7.8, y: 6.4 },
      { x: 2.2, y: 6.4 },
    ]
    return [region(shaft), region(ellipse(1.9, 3.3, 1.7, 1.7)), region(ellipse(1.9, 6.7, 1.7, 1.7)), region(ellipse(8.1, 3.3, 1.7, 1.7)), region(ellipse(8.1, 6.7, 1.7, 1.7))]
  }
  if (kind === 'fish') {
    const body = ellipse(4.2, 5, 3.6, 2.3, 30)
    const tail: Point2[] = [
      { x: 7.0, y: 5 },
      { x: 9.8, y: 7.6 },
      { x: 9.2, y: 5 },
      { x: 9.8, y: 2.4 },
    ]
    return [region(body), region(tail)]
  }
  if (kind === 'heart') {
    const pts: Point2[] = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2
      pts.push({ x: 5 + 0.28 * 16 * Math.sin(t) ** 3, y: 5.2 + 0.28 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) })
    }
    return [region(pts)]
  }
  return []
}

const bounds = (regions: ShapeRegion[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of regions) for (const p of r.outer.points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

/** Relief on the body's front wall, which leans out 8° (the body is
 * modelled rim-down, so "up" on the finished stand is -z here, and the
 * print is turned over about its front-back axis: the art is therefore
 * rotated half a turn in its plane). The slab stands on the wall,
 * tilted with it, EMBED mm into the wall and EMBOSS mm proud. */
function relief(name: string, color: string, regions: ShapeRegion[], scale: number, opts: { cx: number; cy: number; wMid: number; wTop: number; bodyH: number; zc: number; engraved: boolean }): PartRecipe {
  const b = bounds(regions)
  const mx = b.x0 + b.w / 2
  const my = b.y0 + b.h / 2
  const turned: ShapeRegion[] = regions.map((r) => ({
    outer: { points: r.outer.points.map((p) => ({ x: -(p.x - mx) * scale, y: -(p.y - my) * scale })) },
    holes: r.holes.map((h) => ({ points: h.points.map((p) => ({ x: -(p.x - mx) * scale, y: -(p.y - my) * scale })) })),
  }))
  const h = b.h * scale
  const t = opts.engraved ? EMBED + 0.5 : EMBOSS + EMBED
  const tilt = 8
  // The wall's outer face at this height, and the slab's centre a hair
  // inside it (more in than out).
  const s = opts.wTop / opts.wMid + (1 - opts.wTop / opts.wMid) * (opts.zc / opts.bodyH)
  const face = opts.cy + (opts.wMid / 2) * s
  const centreY = face + (opts.engraved ? 0.5 - t / 2 : (EMBOSS - EMBED) / 2)
  const zExtent = h * Math.cos((tilt * Math.PI) / 180) + t * Math.sin((tilt * Math.PI) / 180)
  return {
    name,
    color,
    outline: { kind: 'regions', regions: turned.map((r) => ({ outer: { points: r.outer.points.map((p) => ({ x: p.x + opts.cx, y: p.y + centreY })) }, holes: r.holes.map((hh) => ({ points: hh.points.map((p) => ({ x: p.x + opts.cx, y: p.y + centreY })) })) })) },
    depth: t,
    rotation: { x: 90 + tilt },
    z: opts.zc - zExtent / 2,
    isHole: opts.engraved || undefined,
  }
}

export const petStand: ProductTemplate = {
  id: 'pet-stand',
  name: 'Pet bowl stand',
  tagline: 'Raised stand with the pet’s name on it',
  category: 'Pets',
  keywords: ['pet', 'dog', 'cat', 'bowl', 'stand', 'feeder', 'name', 'paw'],
  prepare: () => loadFont().then(() => undefined),
  fields: [
    { kind: 'text', id: 'name', label: 'Name', maxLength: 14, placeholder: 'THEO', hint: 'In relief on the front, in a round, friendly letter. Capitals read best.' },
    { kind: 'number', id: 'bowl', label: 'Bowl rim', unit: 'mm', min: 80, max: 230, step: 1, hint: 'Measure across the very top of the bowl, outside edge to outside edge (the widest point of the lip). The bowl rests on the stand by that lip.' },
    { kind: 'number', id: 'bowlDepth', label: 'Bowl depth', unit: 'mm', min: 20, max: 150, step: 1, hint: 'Measure from the top of the lip straight down to the outside of the bottom. The stand is made deep enough for the bowl to hang free.' },
    { kind: 'number', id: 'height', label: 'Height', unit: 'mm', min: 40, max: 260, step: 1, hint: 'Floor to the bowl’s rim.' },
    { kind: 'number', id: 'band', label: 'Base band', unit: 'mm', min: 15, max: 120, step: 1, hint: 'Height of the second-colour band at the bottom; it is its own part.' },
    { kind: 'select', id: 'shape', label: 'Shape', options: [{ value: 'squircle', label: 'Rounded square' }, { value: 'round', label: 'Round' }] },
    {
      kind: 'select',
      id: 'figure',
      label: 'Figure',
      options: [
        { value: 'paw', label: 'Paw' },
        { value: 'bone', label: 'Bone' },
        { value: 'fish', label: 'Fish' },
        { value: 'heart', label: 'Heart' },
        { value: 'none', label: 'None' },
      ],
    },
    { kind: 'select', id: 'figurePos', label: 'Figure goes', options: [{ value: 'above', label: 'Above the name' }, { value: 'below', label: 'Below the name' }] },
    { kind: 'select', id: 'emboss', label: 'Lettering', options: [{ value: 'raised', label: 'Raised 1.2 mm' }, { value: 'engraved', label: 'Engraved 1 mm' }] },
    { kind: 'boolean', id: 'slots', label: 'Lift slots on the sides', hint: 'A finger slot in each side wall to pick the stand up.' },
    { kind: 'number', id: 'wall', label: 'Wall', unit: 'mm', min: 2, max: 5, step: 0.5 },
  ],
  defaults: { name: 'THEO', bowl: 160, bowlDepth: 55, height: 120, band: 40, shape: 'squircle', figure: 'paw', figurePos: 'above', emboss: 'raised', slots: true, wall: 3 },
  notes: 'Two parts, two colours: the body prints rim-down with no support, the base band prints as it is. Turn the body over, push it onto the band’s lip and glue. The bowl rests on its rim in the top opening. Colour each part in the right panel.',
  build: (spec: ProductSpec): ProductBuild => {
    const name = str(spec, 'name', '').trim()
    const bowl = num(spec, 'bowl', 160)
    const bowlDepth = num(spec, 'bowlDepth', 55)
    const wall = num(spec, 'wall', 3)
    const shape = str(spec, 'shape', 'squircle')
    const height = Math.max(num(spec, 'height', 120), bowlDepth + 8)
    const band = Math.min(num(spec, 'band', 40), height - 30)
    const bodyH = height - band
    const dOpen = bowl - 2 * LEDGE
    const wTop = dOpen + 2 * wall
    const wMid = wTop + 2 * bodyH * TAPER
    const wBot = wTop + 2 * height * TAPER
    const engraved = str(spec, 'emboss', 'raised') === 'engraved'

    // Body, modelled rim-down: z = 0 is the top plate on the bed.
    const cx = wMid / 2
    const cy = wMid / 2
    const parts: PartRecipe[] = [
      {
        name: 'Stand body',
        color: BODY_COLOR,
        outline: { kind: 'path', points: footprint(shape, wMid, cx, cy) },
        depth: bodyH,
        profile: { points: [{ z: 0, scale: wTop / wMid }, { z: bodyH, scale: 1 }], smooth: false },
        hollow: { wall, floor: TOP_PLATE, openFrom: 'top' },
        tile: 0,
      },
      { name: 'Bowl opening', outline: { kind: 'circle', x: cx - dOpen / 2, y: cy - dOpen / 2, width: dOpen, height: dOpen }, depth: TOP_PLATE + 2, z: -1, isHole: true, tile: 0 },
    ]
    // Lettering: the name, and the figure over or under it, centred on
    // the visible front (between the band and the rim).
    const faceTop = height
    const faceBottom = band
    const faceMid = (faceTop + faceBottom) / 2
    const toModelZ = (actual: number) => height - actual
    const figureKind = str(spec, 'figure', 'paw')
    const above = str(spec, 'figurePos', 'above') === 'above'
    const text = name ? textRegions(name, 10) : null
    const textCap = text ? Math.max(8, Math.min(24, (0.68 * wTop * 10) / Math.max(text.width, 1), 0.3 * bodyH)) : 0
    const figures = figureKind === 'none' ? [] : figureRegions(figureKind)
    const figureSize = figures.length ? Math.max(6, Math.min(16, textCap * 0.8 || 12)) : 0
    const gap = 4
    const total = (text ? textCap : 0) + (figures.length ? figureSize : 0) + (text && figures.length ? gap : 0)
    // Stack from the top: the figure first when it goes above.
    let cursor = faceMid + total / 2
    const place = (what: 'text' | 'figure') => {
      const size = what === 'text' ? textCap : figureSize
      const zc = cursor - size / 2
      cursor -= size + gap
      return zc
    }
    const order: ('text' | 'figure')[] = above ? ['figure', 'text'] : ['text', 'figure']
    for (const what of order) {
      if (what === 'text' && text && textCap > 0) {
        const zc = place('text')
        parts.push({ ...relief('Name', BODY_COLOR, text.regions, textCap / 10, { cx, cy, wMid, wTop, bodyH, zc: toModelZ(zc), engraved }), tile: 0 })
      } else if (what === 'figure' && figures.length) {
        const zc = place('figure')
        parts.push({ ...relief('Figure', BODY_COLOR, figures, figureSize / 10, { cx, cy, wMid, wTop, bodyH, zc: toModelZ(zc), engraved }), tile: 0 })
      }
    }
    if (bool(spec, 'slots', true) && bodyH >= SLOT_H + 20) {
      // A stadium through each side wall, mid-height; the cutter is thick
      // enough to pass the leaning wall.
      const zMid = bodyH / 2
      const sMid = wTop / wMid + (1 - wTop / wMid) * (zMid / bodyH)
      const stadium: { h: number; b: number }[] = []
      for (let i = 0; i <= 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * Math.PI
        stadium.push({ h: SLOT_H / 2 + (SLOT_H / 2) * Math.sin(a), b: SLOT_W / 2 - SLOT_H / 2 + (SLOT_H / 2) * Math.cos(a) })
      }
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI / 2 + (i / 12) * Math.PI
        stadium.push({ h: SLOT_H / 2 + (SLOT_H / 2) * Math.sin(a), b: -(SLOT_W / 2 - SLOT_H / 2) + (SLOT_H / 2) * Math.cos(a) })
      }
      const thick = 2 * (wall + SLOT_H * TAPER) + 4
      for (const side of [-1, 1]) {
        const x = cx + side * (wMid / 2) * sMid
        parts.push({ name: side < 0 ? 'Left slot' : 'Right slot', outline: { kind: 'path', points: standingPath(stadium, x, SLOT_H, cy) }, depth: thick, rotation: { y: 90 }, z: zMid - SLOT_H / 2, isHole: true, tile: 0 })
      }
    }
    const bodyCount = parts.length

    // The base band, upright, with the lip the body plugs onto.
    const bx = wBot / 2
    const by = wBot / 2
    const wIn = wBot - 2 * wall
    const wLip = wMid - 2 * wall - 2 * PLAY
    parts.push(
      { name: 'Base band', color: BAND_COLOR, outline: { kind: 'path', points: footprint(shape, wBot, bx, by) }, depth: band, profile: { points: [{ z: 0, scale: 1 }, { z: band, scale: wMid / wBot }], smooth: false }, tile: 1 },
      { name: 'Band opening', outline: { kind: 'path', points: footprint(shape, wIn, bx, by) }, depth: band + 2, z: -1, profile: { points: [{ z: 0, scale: 1 }, { z: band + 2, scale: (wMid - 2 * wall) / wIn }], smooth: false }, isHole: true, tile: 1 },
      { name: 'Lip', color: BAND_COLOR, outline: { kind: 'path', points: footprint(shape, wLip, bx, by) }, depth: LIP_H, z: band, tile: 1 },
      { name: 'Lip opening', outline: { kind: 'path', points: footprint(shape, wLip - 2 * LIP_T, bx, by) }, depth: LIP_H + 2, z: band - 1, isHole: true, tile: 1 },
    )
    const bodyParts = Array.from({ length: bodyCount }, (_, i) => i)
    const bandParts = Array.from({ length: parts.length - bodyCount }, (_, i) => bodyCount + i)
    return {
      width: wBot,
      height: wBot,
      parts,
      fuse: true,
      tiles: ['Stand body', 'Base band'],
      groups: [
        { name: 'Stand body', spec, parts: bodyParts },
        { name: 'Base band', spec, parts: bandParts },
      ],
    }
  },
}
