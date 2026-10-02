import { parse, type Font, type PathCommand } from 'opentype.js'
import type { Point2, ShapeRegion } from '../../types/document'
import fontUrl from '@expo-google-fonts/baloo-2/800ExtraBold/Baloo2_800ExtraBold.ttf?url'

/**
 * Text as shape regions: letters outlined from a bundled font (Baloo 2
 * ExtraBold: round, friendly, with the Turkish letters; SIL Open Font
 * License), so a product can carry a name in
 * relief. The font is fetched once and kept; `textRegions` then works
 * synchronously, which is what the product builders need.
 */

let font: Font | null = null
let loading: Promise<Font> | null = null

export function loadFont(): Promise<Font> {
  if (font) return Promise.resolve(font)
  if (!loading) {
    loading = fetch(fontUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        font = parse(buf)
        return font
      })
      .catch((err) => {
        loading = null
        throw err
      })
  }
  return loading
}

export const fontReady = () => font !== null

export interface TextOutline {
  regions: ShapeRegion[]
  /** Advance width of the whole text, mm. */
  width: number
  /** Cap height, mm (what `size` asks for). */
  height: number
  /** How far below the baseline the text reaches (descenders), mm. */
  descent: number
}

const CURVE_STEPS = 6

/** Flattens a glyph path into closed contours (mm, y up, baseline at 0). */
function contoursOf(commands: PathCommand[]): Point2[][] {
  const out: Point2[][] = []
  let cur: Point2[] = []
  let last: Point2 = { x: 0, y: 0 }
  const push = (x: number, y: number) => {
    const p = { x, y: -y }
    cur.push(p)
    last = { x, y }
  }
  for (const c of commands) {
    if (c.type === 'M') {
      if (cur.length > 2) out.push(cur)
      cur = []
      push(c.x!, c.y!)
    } else if (c.type === 'L') push(c.x!, c.y!)
    else if (c.type === 'Q') {
      const { x: x0, y: y0 } = last
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS
        const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t
        push(a * x0 + b * c.x1! + d * c.x!, a * y0 + b * c.y1! + d * c.y!)
      }
    } else if (c.type === 'C') {
      const { x: x0, y: y0 } = last
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS
        const a = (1 - t) ** 3, b = 3 * (1 - t) * (1 - t) * t, d = 3 * (1 - t) * t * t, e = t ** 3
        push(a * x0 + b * c.x1! + d * c.x2! + e * c.x!, a * y0 + b * c.y1! + d * c.y2! + e * c.y!)
      }
    } else if (c.type === 'Z') {
      if (cur.length > 2) out.push(cur)
      cur = []
    }
  }
  if (cur.length > 2) out.push(cur)
  // Drop a closing point that repeats the first.
  return out.map((ring) => {
    const a = ring[0], b = ring[ring.length - 1]
    return Math.hypot(a.x - b.x, a.y - b.y) < 1e-6 ? ring.slice(0, -1) : ring
  })
}

function pointInRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const area = (ring: Point2[]) => Math.abs(ring.reduce((s, p, i) => s + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0) / 2)

/** Outer contours and the holes inside them, by nesting depth: a ring
 * inside an odd number of others is a hole of the smallest one around it. */
function regionsOf(rings: Point2[][]): ShapeRegion[] {
  const depth = rings.map((r, i) => rings.filter((o, j) => j !== i && pointInRing(r[0], o)).length)
  const regions: { outer: Point2[]; holes: Point2[][]; area: number }[] = []
  rings.forEach((r, i) => {
    if (depth[i] % 2 === 0) regions.push({ outer: r, holes: [], area: area(r) })
  })
  rings.forEach((r, i) => {
    if (depth[i] % 2 === 1) {
      const owners = regions.filter((g) => pointInRing(r[0], g.outer)).sort((a, b) => a.area - b.area)
      if (owners[0]) owners[0].holes.push(r)
    }
  })
  return regions.map((g) => ({ outer: { points: g.outer }, holes: g.holes.map((points) => ({ points })) }))
}

/** `text` with capitals `size` mm tall, left edge at x = 0, baseline at
 * y = 0 (y up). Null until the font has loaded. */
export function textRegions(text: string, size: number, letterSpacing = 0): TextOutline | null {
  if (!font) return null
  const capUnits = font.tables.os2?.sCapHeight ?? font.unitsPerEm * 0.7
  const fontSize = (size * font.unitsPerEm) / capUnits
  const scale = fontSize / font.unitsPerEm
  let x = 0
  let prev: ReturnType<Font['charToGlyph']> | null = null
  const rings: Point2[][] = []
  let descent = 0
  for (const ch of text) {
    const g = font.charToGlyph(ch)
    if (prev) x += font.getKerningValue(prev, g) * scale
    for (const ring of contoursOf(g.getPath(x, 0, fontSize).commands)) {
      rings.push(ring)
      for (const p of ring) descent = Math.max(descent, -p.y)
    }
    x += (g.advanceWidth ?? 0) * scale + letterSpacing
    prev = g
  }
  if (text.length > 0) x -= letterSpacing
  return { regions: regionsOf(rings), width: x, height: size, descent }
}
