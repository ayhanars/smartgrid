import { parse, type Font, type PathCommand } from 'opentype.js'
import { difference, union, type MultiPolygon, type Polygon } from 'polygon-clipping'
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

const signedArea = (ring: Point2[]) => ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0) / 2

/** A glyph's contours as filled regions. Fonts draw a letter from
 * overlapping strokes (an E is five contours here), with holes as
 * contours running the other way, so the contours are resolved like
 * the font does: the strokes, all wound like the biggest one, are
 * united, the counter-wound contours are the holes taken out of them. */
function regionsOf(rings: Point2[][]): ShapeRegion[] {
  if (rings.length === 0) return []
  const biggest = rings.reduce((best, r) => (Math.abs(signedArea(r)) > Math.abs(signedArea(best)) ? r : best), rings[0])
  const outerSign = Math.sign(signedArea(biggest)) || 1
  const asPoly = (r: Point2[]): Polygon => [r.map((p) => [p.x, p.y] as [number, number])]
  const strokes = rings.filter((r) => Math.sign(signedArea(r)) === outerSign).map(asPoly)
  const holes = rings.filter((r) => Math.sign(signedArea(r)) !== outerSign).map(asPoly)
  let filled: MultiPolygon
  try {
    filled = union(strokes[0], ...strokes.slice(1))
    if (holes.length) filled = difference(filled, holes[0], ...holes.slice(1))
  } catch {
    return rings.map((r) => ({ outer: { points: r }, holes: [] }))
  }
  const toRing = (ring: [number, number][]): Point2[] => {
    const pts = ring.map(([x, y]) => ({ x, y }))
    const first = pts[0], last = pts[pts.length - 1]
    return first && last && Math.hypot(first.x - last.x, first.y - last.y) < 1e-9 ? pts.slice(0, -1) : pts
  }
  return filled.map((poly) => ({ outer: { points: toRing(poly[0]) }, holes: poly.slice(1).map((h) => ({ points: toRing(h) })) }))
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
