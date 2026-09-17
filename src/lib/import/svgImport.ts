import type { Point2, ShapeRegion } from '../../types/document'
import { signedArea } from '../geometry/offset'

/** One SVG element redrawn as a native shape: closed polygon regions in
 * mm, positioned relative to the import's top-left corner. */
export interface ImportedShape {
  name: string
  color: string
  regions: ShapeRegion[]
}

export interface SvgImportResult {
  shapes: ImportedShape[]
  widthMM: number
  heightMM: number
  /** Elements that could not be turned into geometry (text needs a font
   * to outline; gradients/images have no outline at all). */
  skippedText: number
  skippedOther: number
}

const DEFAULT_COLOR = '#4d8dff'
const PX_PER_INCH = 96
const MM_PER_INCH = 25.4
/** Chord tolerance the curve flattening aims for, in mm. */
const FLATTEN_TOLERANCE_MM = 0.05
const MIN_RING_AREA_MM2 = 0.01
const IGNORED_CONTAINERS = new Set(['defs', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'metadata', 'title', 'desc', 'style', 'script'])

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function apply(m: Matrix, p: Point2): Point2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }
}

function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

/** How much a unit-length local segment is stretched by a matrix — used
 * to pick curve subdivision counts in real mm. */
function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
}

/** Parses an SVG length into user units (px). */
function lengthToPx(raw: string | null): number | null {
  if (!raw) return null
  const match = raw.trim().match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*(px|mm|cm|in|pt|pc|%)?$/i)
  if (!match) return null
  const v = parseFloat(match[1])
  switch ((match[2] ?? 'px').toLowerCase()) {
    case 'mm':
      return (v / MM_PER_INCH) * PX_PER_INCH
    case 'cm':
      return (v / MM_PER_INCH) * PX_PER_INCH * 10
    case 'in':
      return v * PX_PER_INCH
    case 'pt':
      return (v / 72) * PX_PER_INCH
    case 'pc':
      return (v / 6) * PX_PER_INCH
    case '%':
      return null
    default:
      return v
  }
}

// ---------------------------------------------------------------- curves

function flattenCubic(p0: Point2, p1: Point2, p2: Point2, p3: Point2, scaleMM: number, out: Point2[]) {
  const len = (Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y)) * scaleMM
  const n = Math.min(64, Math.max(4, Math.ceil(Math.sqrt(len / FLATTEN_TOLERANCE_MM) * 0.6)))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    })
  }
}

function flattenQuadratic(p0: Point2, p1: Point2, p2: Point2, scaleMM: number, out: Point2[]) {
  // Elevate to a cubic and reuse the same subdivision rule.
  const c1 = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) }
  const c2 = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) }
  flattenCubic(p0, c1, c2, p2, scaleMM, out)
}

/** SVG elliptical arc (endpoint parameterization, spec appendix F.6.5)
 * sampled into line segments. */
function flattenArc(p0: Point2, rxIn: number, ryIn: number, rotationDeg: number, largeArc: boolean, sweep: boolean, p1: Point2, scaleMM: number, out: Point2[]) {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) {
    out.push(p1)
    return
  }
  const phi = (rotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1 = cosPhi * dx + sinPhi * dy
  const y1 = -sinPhi * dx + cosPhi * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let coef = Math.sqrt(Math.max(0, num / den))
  if (largeArc === sweep) coef = -coef
  const cx1 = (coef * rx * y1) / ry
  const cy1 = (-coef * ry * x1) / rx
  const cx = cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2
  const cy = sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dTheta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  const arcLen = Math.abs(dTheta) * Math.max(rx, ry) * scaleMM
  const n = Math.min(96, Math.max(4, Math.ceil(Math.sqrt(arcLen / FLATTEN_TOLERANCE_MM) * 0.8)))
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (dTheta * i) / n
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    out.push({ x: cosPhi * ex - sinPhi * ey + cx, y: sinPhi * ex + cosPhi * ey + cy })
  }
}

// ------------------------------------------------------------ path data

interface Subpath {
  points: Point2[]
  closed: boolean
}

/** Tokenizes and flattens SVG path data into polylines (local units). */
function parsePathData(d: string, scaleMM: number): Subpath[] {
  const subpaths: Subpath[] = []
  let current: Subpath | null = null
  let pos = 0
  const len = d.length
  let cmd = ''
  let cur: Point2 = { x: 0, y: 0 }
  let start: Point2 = { x: 0, y: 0 }
  let lastCtrl: Point2 | null = null
  let lastCmd = ''

  const skipSep = () => {
    while (pos < len && /[\s,]/.test(d[pos])) pos++
  }
  const readNumber = (): number | null => {
    skipSep()
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(pos))
    if (!m) return null
    pos += m[0].length
    return parseFloat(m[0])
  }
  const readFlag = (): boolean | null => {
    skipSep()
    const ch = d[pos]
    if (ch === '0' || ch === '1') {
      pos++
      return ch === '1'
    }
    return null
  }
  const begin = (p: Point2) => {
    current = { points: [p], closed: false }
    subpaths.push(current)
    start = p
    cur = p
  }
  const lineTo = (p: Point2) => {
    if (!current) begin(cur)
    current!.points.push(p)
    cur = p
  }
  // Closures see the un-narrowed `current`, which is what the flatteners
  // below need to append to.
  const currentPoints = (): Point2[] => {
    if (!current) begin(cur)
    return current!.points
  }
  const closeCurrent = () => {
    if (current) current.closed = true
    current = null
  }

  while (pos < len) {
    skipSep()
    if (pos >= len) break
    const ch = d[pos]
    if (/[a-zA-Z]/.test(ch)) {
      cmd = ch
      pos++
    } else if (!cmd) {
      break
    } else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'

    const rel = cmd === cmd.toLowerCase()
    const abs = (x: number, y: number): Point2 => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y })

    switch (cmd.toUpperCase()) {
      case 'M': {
        const x = readNumber()
        const y = readNumber()
        if (x == null || y == null) return subpaths
        begin(abs(x, y))
        lastCtrl = null
        break
      }
      case 'L': {
        const x = readNumber()
        const y = readNumber()
        if (x == null || y == null) return subpaths
        lineTo(abs(x, y))
        lastCtrl = null
        break
      }
      case 'H': {
        const x = readNumber()
        if (x == null) return subpaths
        lineTo({ x: rel ? cur.x + x : x, y: cur.y })
        lastCtrl = null
        break
      }
      case 'V': {
        const y = readNumber()
        if (y == null) return subpaths
        lineTo({ x: cur.x, y: rel ? cur.y + y : y })
        lastCtrl = null
        break
      }
      case 'C': {
        const v = [readNumber(), readNumber(), readNumber(), readNumber(), readNumber(), readNumber()]
        if (v.some((n) => n == null)) return subpaths
        const [x1, y1, x2, y2, x, y] = v as number[]
        const p1 = abs(x1, y1)
        const p2 = abs(x2, y2)
        const p = abs(x, y)
        flattenCubic(cur, p1, p2, p, scaleMM, currentPoints())
        lastCtrl = p2
        cur = p
        break
      }
      case 'S': {
        const v = [readNumber(), readNumber(), readNumber(), readNumber()]
        if (v.some((n) => n == null)) return subpaths
        const [x2, y2, x, y] = v as number[]
        const reflect = lastCtrl && /[CScs]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur
        const p2 = abs(x2, y2)
        const p = abs(x, y)
        flattenCubic(cur, reflect, p2, p, scaleMM, currentPoints())
        lastCtrl = p2
        cur = p
        break
      }
      case 'Q': {
        const v = [readNumber(), readNumber(), readNumber(), readNumber()]
        if (v.some((n) => n == null)) return subpaths
        const [x1, y1, x, y] = v as number[]
        const p1 = abs(x1, y1)
        const p = abs(x, y)
        flattenQuadratic(cur, p1, p, scaleMM, currentPoints())
        lastCtrl = p1
        cur = p
        break
      }
      case 'T': {
        const x = readNumber()
        const y = readNumber()
        if (x == null || y == null) return subpaths
        const reflect: Point2 = lastCtrl && /[QTqt]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur
        const p = abs(x, y)
        flattenQuadratic(cur, reflect, p, scaleMM, currentPoints())
        lastCtrl = reflect
        cur = p
        break
      }
      case 'A': {
        const rx = readNumber()
        const ry = readNumber()
        const rot = readNumber()
        const large = readFlag()
        const sweep = readFlag()
        const x = readNumber()
        const y = readNumber()
        if (rx == null || ry == null || rot == null || large == null || sweep == null || x == null || y == null) return subpaths
        const p = abs(x, y)
        flattenArc(cur, rx, ry, rot, large, sweep, p, scaleMM, currentPoints())
        lastCtrl = null
        cur = p
        break
      }
      case 'Z': {
        closeCurrent()
        cur = start
        lastCtrl = null
        break
      }
      default:
        return subpaths
    }
    lastCmd = cmd
  }
  return subpaths
}

// ------------------------------------------------------- basic shapes

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, scaleMM: number): Point2[] {
  const circumference = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) * scaleMM
  const n = Math.min(160, Math.max(16, Math.ceil(Math.sqrt(circumference / FLATTEN_TOLERANCE_MM) * 1.2)))
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }
  })
}

function roundedRectPoints(x: number, y: number, w: number, h: number, rxIn: number, ryIn: number, scaleMM: number): Point2[] {
  const rx = Math.min(Math.abs(rxIn), w / 2)
  const ry = Math.min(Math.abs(ryIn), h / 2)
  if (rx <= 0 || ry <= 0) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]
  }
  const out: Point2[] = []
  const corner = (cx: number, cy: number, from: number) => {
    const arcLen = ((Math.PI / 2) * (rx + ry)) / 2
    const n = Math.min(32, Math.max(4, Math.ceil(Math.sqrt((arcLen * scaleMM) / FLATTEN_TOLERANCE_MM))))
    for (let i = 0; i <= n; i++) {
      const a = from + ((Math.PI / 2) * i) / n
      out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
    }
  }
  corner(x + w - rx, y + ry, -Math.PI / 2)
  corner(x + w - rx, y + h - ry, 0)
  corner(x + rx, y + h - ry, Math.PI / 2)
  corner(x + rx, y + ry, Math.PI)
  return out
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const v = lengthToPx(el.getAttribute(name))
  return v == null ? fallback : v
}

function pointsAttr(el: Element): Point2[] {
  const nums = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(parseFloat).filter((n) => !Number.isNaN(n))
  const out: Point2[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] })
  return out
}

/** Local-space closed rings for one drawable element (before transform). */
function elementRings(el: Element, scaleMM: number): Point2[][] | null {
  switch (el.tagName.toLowerCase()) {
    case 'path': {
      const d = el.getAttribute('d')
      if (!d) return []
      // Every subpath is closed for our purposes — an open outline still
      // encloses the area between its ends once extruded.
      return parsePathData(d, scaleMM).map((s) => s.points)
    }
    case 'rect': {
      const w = numAttr(el, 'width')
      const h = numAttr(el, 'height')
      if (w <= 0 || h <= 0) return []
      const rx = el.hasAttribute('rx') ? numAttr(el, 'rx') : numAttr(el, 'ry')
      const ry = el.hasAttribute('ry') ? numAttr(el, 'ry') : rx
      return [roundedRectPoints(numAttr(el, 'x'), numAttr(el, 'y'), w, h, rx, ry, scaleMM)]
    }
    case 'circle': {
      const r = numAttr(el, 'r')
      return r > 0 ? [ellipsePoints(numAttr(el, 'cx'), numAttr(el, 'cy'), r, r, scaleMM)] : []
    }
    case 'ellipse': {
      const rx = numAttr(el, 'rx')
      const ry = numAttr(el, 'ry')
      return rx > 0 && ry > 0 ? [ellipsePoints(numAttr(el, 'cx'), numAttr(el, 'cy'), rx, ry, scaleMM)] : []
    }
    case 'polygon':
    case 'polyline':
      return [pointsAttr(el)]
    default:
      return null
  }
}

// ------------------------------------------------------ ring clean-up

function cleanRing(ring: Point2[]): Point2[] {
  const out: Point2[] = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-4) out.push(p)
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-4) out.pop()
  // Drop vertices that barely deviate from the line through their
  // neighbours — flattened curves produce many of them and every extra
  // vertex costs the bevel/offset passes later.
  const simplified: Point2[] = []
  const n = out.length
  for (let i = 0; i < n; i++) {
    const prev = out[(i - 1 + n) % n]
    const curr = out[i]
    const next = out[(i + 1) % n]
    const vx = next.x - prev.x
    const vy = next.y - prev.y
    const len = Math.hypot(vx, vy) || 1
    const deviation = Math.abs((curr.x - prev.x) * vy - (curr.y - prev.y) * vx) / len
    if (deviation > 0.005 || n < 4) simplified.push(curr)
  }
  return simplified.length >= 3 ? simplified : out
}

function pointInRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Turns an element's rings into outer/hole regions by nesting depth:
 * even depth = outer, odd depth = a hole of its nearest outer (the
 * even-odd reading, which matches how letters and icons are drawn). */
function ringsToRegions(rings: Point2[][]): ShapeRegion[] {
  const clean = rings.map(cleanRing).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) >= MIN_RING_AREA_MM2)
  const info = clean.map((ring) => ({ ring, area: Math.abs(signedArea(ring)), parents: [] as number[] }))
  info.forEach((ri, i) => {
    info.forEach((rj, j) => {
      if (i !== j && rj.area > ri.area && pointInRing(ri.ring[0], rj.ring)) ri.parents.push(j)
    })
  })
  const regions: ShapeRegion[] = []
  const outerIndex = new Map<number, number>()
  info.forEach((ri, i) => {
    if (ri.parents.length % 2 === 0) {
      const outer = signedArea(ri.ring) < 0 ? [...ri.ring].reverse() : ri.ring
      outerIndex.set(i, regions.length)
      regions.push({ outer: { points: outer }, holes: [] })
    }
  })
  info.forEach((ri) => {
    if (ri.parents.length % 2 === 1) {
      // Nearest enclosing outer = the smallest even-depth parent.
      const parent = ri.parents.filter((p) => info[p].parents.length % 2 === 0).sort((a, b) => info[a].area - info[b].area)[0]
      const target = parent == null ? undefined : outerIndex.get(parent)
      if (target != null) {
        const hole = signedArea(ri.ring) > 0 ? [...ri.ring].reverse() : ri.ring
        regions[target].holes.push({ points: hole })
      }
    }
  })
  return regions
}

// ---------------------------------------------------------------- color

function cssColorToHex(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === 'none' || v === 'transparent' || v.startsWith('url(')) return null
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return `#${h}`
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/)
  if (rgb) {
    const to = (s: string) => Math.max(0, Math.min(255, Math.round(parseFloat(s)))).toString(16).padStart(2, '0')
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`
  }
  return null
}

function toMatrix(m: DOMMatrix | null | undefined): Matrix {
  return m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : IDENTITY
}

// ---------------------------------------------------------------- main

/**
 * Redraws an SVG file as native shapes: every path/rect/circle/ellipse/
 * polygon becomes closed polygon regions in mm (curves flattened to a
 * 0.05 mm tolerance, nested subpaths resolved into outers and holes),
 * with all transforms baked in. The document is mounted invisibly so the
 * browser resolves transform chains and CSS colors for us.
 */
export function importSvg(svgText: string): SvgImportResult {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid SVG.')
  const source = doc.documentElement
  if (source.tagName.toLowerCase() !== 'svg') throw new Error('This file is not an SVG document.')

  // Scale: real-world units when the file states them, otherwise CSS
  // pixels at 96 dpi (what Figma/Illustrator export unitless).
  const vbRaw = (source.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(parseFloat)
  const widthPx = lengthToPx(source.getAttribute('width'))
  const heightPx = lengthToPx(source.getAttribute('height'))
  const viewBox =
    vbRaw.length === 4 && vbRaw.every((n) => !Number.isNaN(n)) && vbRaw[2] > 0 && vbRaw[3] > 0
      ? { x: vbRaw[0], y: vbRaw[1], w: vbRaw[2], h: vbRaw[3] }
      : { x: 0, y: 0, w: widthPx ?? 100, h: heightPx ?? 100 }
  const unitToPx = widthPx && viewBox.w ? widthPx / viewBox.w : heightPx && viewBox.h ? heightPx / viewBox.h : 1
  const mmPerUnit = (unitToPx * MM_PER_INCH) / PX_PER_INCH

  // Mount a copy sized 1:1 to its viewBox so getCTM() reports plain user
  // units relative to the viewBox origin.
  const host = document.createElement('div')
  // Off-screen rather than visibility:hidden — that would be inherited by
  // every element and read back as "hidden" below.
  host.style.cssText = 'position:absolute;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none'
  const svg = document.importNode(source, true) as unknown as SVGSVGElement
  svg.setAttribute('width', String(viewBox.w))
  svg.setAttribute('height', String(viewBox.h))
  svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  host.appendChild(svg)
  document.body.appendChild(host)

  const shapes: ImportedShape[] = []
  let skippedText = 0
  let skippedOther = 0

  try {
    const resolveUse = (use: Element): { target: Element; extra: Matrix } | null => {
      const href = use.getAttribute('href') ?? use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      if (!href || !href.startsWith('#')) return null
      const target = svg.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
      if (!target) return null
      const local = toMatrix((target as SVGGraphicsElement).transform?.baseVal?.consolidate()?.matrix)
      const shift: Matrix = { ...IDENTITY, e: numAttr(use, 'x'), f: numAttr(use, 'y') }
      return { target, extra: multiply(shift, local) }
    }

    const emit = (el: Element, matrix: Matrix, nameHint?: string, colorHint?: string | null) => {
      const scaleMM = matrixScale(matrix) * mmPerUnit
      const rings = elementRings(el, scaleMM)
      if (rings === null) return
      const style = getComputedStyle(el as Element)
      const fill = cssColorToHex(el.getAttribute('fill')) ?? colorHint ?? cssColorToHex(style.fill)
      const stroke = cssColorToHex(el.getAttribute('stroke')) ?? cssColorToHex(style.stroke)
      const transformed = rings.map((ring) =>
        ring.map((p) => {
          const q = apply(matrix, p)
          return { x: q.x * mmPerUnit, y: q.y * mmPerUnit }
        }),
      )
      const regions = ringsToRegions(transformed)
      if (regions.length === 0) return
      shapes.push({
        name: nameHint ?? el.getAttribute('id') ?? el.getAttribute('data-name') ?? el.tagName.toLowerCase(),
        color: fill ?? stroke ?? DEFAULT_COLOR,
        regions,
      })
    }

    const walk = (el: Element) => {
      const tag = el.tagName.toLowerCase()
      if (IGNORED_CONTAINERS.has(tag)) return
      const style = getComputedStyle(el)
      if (style.display === 'none' || el.getAttribute('visibility') === 'hidden') return
      if (tag === 'text' || tag === 'tspan') {
        skippedText++
        return
      }
      if (tag === 'image' || tag === 'foreignobject') {
        skippedOther++
        return
      }
      if (tag === 'use') {
        const resolved = resolveUse(el)
        const ctm = toMatrix((el as SVGGraphicsElement).getCTM())
        // A <use> passes its own fill down to what it instantiates.
        const useFill = cssColorToHex(el.getAttribute('fill')) ?? cssColorToHex(getComputedStyle(el).fill)
        if (resolved && elementRings(resolved.target, 1) !== null) emit(resolved.target, multiply(ctm, resolved.extra), el.getAttribute('id') ?? undefined, useFill)
        else if (resolved) for (const child of Array.from(resolved.target.children)) walkWith(child, multiply(ctm, resolved.extra))
        else skippedOther++
        return
      }
      if (elementRings(el, 1) !== null) {
        emit(el, toMatrix((el as SVGGraphicsElement).getCTM()))
        return
      }
      for (const child of Array.from(el.children)) walk(child)
    }

    // Children of a <use>d group have no CTM of their own in the used
    // context, so their local transforms are composed by hand.
    const walkWith = (el: Element, matrix: Matrix) => {
      const tag = el.tagName.toLowerCase()
      if (IGNORED_CONTAINERS.has(tag)) return
      const local = multiply(matrix, toMatrix((el as SVGGraphicsElement).transform?.baseVal?.consolidate()?.matrix))
      if (tag === 'text' || tag === 'tspan') {
        skippedText++
        return
      }
      if (elementRings(el, 1) !== null) {
        emit(el, local)
        return
      }
      for (const child of Array.from(el.children)) walkWith(child, local)
    }

    for (const child of Array.from(svg.children)) walk(child)
  } finally {
    host.remove()
  }

  // Re-origin everything to the content's top-left corner.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of shapes) {
    for (const r of s.regions) {
      for (const p of [...r.outer.points, ...r.holes.flatMap((h) => h.points)]) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
  }
  if (shapes.length > 0) {
    for (const s of shapes) {
      for (const r of s.regions) {
        r.outer.points = r.outer.points.map((p) => ({ x: p.x - minX, y: p.y - minY }))
        for (const h of r.holes) h.points = h.points.map((p) => ({ x: p.x - minX, y: p.y - minY }))
      }
    }
  }
  return {
    shapes,
    widthMM: shapes.length ? maxX - minX : 0,
    heightMM: shapes.length ? maxY - minY : 0,
    skippedText,
    skippedOther,
  }
}
