import geoJson from './geo/countries.json'
import {
  CATEGORICAL_DARK,
  CATEGORICAL_LIGHT,
  hueAngle,
  inkOn,
  sequentialRamp,
} from './color'
import { classOf, linearBreaks, makeFormatter, quantileBreaks } from './format'
import type {
  CategoricalTheme,
  Country,
  CountryCode,
  GeoData,
  MapTheme,
  NumericTheme,
  WorldMapOptions,
} from './types'

export const GEO = geoJson as GeoData

const SVG_NS = 'http://www.w3.org/2000/svg'
const COMPACT_WIDTH = 640
const MIN_ZOOM = 1
const MAX_ZOOM = 10
const BADGE_PX = 11 // badge radius in CSS pixels, whatever the zoom or screen size
const DOT_PX = 3.5

type Paint = {
  fill: Map<CountryCode, string>
  rank: Map<CountryCode, number>
  legend: { swatch: string; label: string }[]
  legendTitle: string
  rows: { country: Country; value: number | string; display: string; rank: number }[]
  format: (v: number) => string
  isNumeric: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

function isDark(root: HTMLElement): boolean {
  const forced = document.documentElement.dataset.theme
  if (forced === 'dark') return true
  if (forced === 'light') return false
  const cs = getComputedStyle(root).colorScheme
  if (cs.includes('dark') && !cs.includes('light')) return true
  if (cs.includes('light') && !cs.includes('dark')) return false
  return matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * A responsive, themeable world map. One instance, any number of themes:
 * call `setTheme()` to repaint it for the next infographic.
 */
export class WorldMap {
  readonly root: HTMLElement
  private theme!: MapTheme
  private opts: WorldMapOptions
  private paint!: Paint

  private header: HTMLElement
  private stage: HTMLElement
  private svg: SVGSVGElement
  private zoomG: SVGGElement
  private countriesG: SVGGElement
  private marksG: SVGGElement
  private paths = new Map<CountryCode, SVGPathElement>()
  private byId = new Map<CountryCode, Country>()
  private legend: HTMLElement
  private tooltip: HTMLElement
  private list: HTMLElement
  private zoomBar: HTMLElement
  private below: HTMLElement
  private hint: HTMLElement
  private sourceEl: HTMLElement

  private k = 1
  private tx = 0
  private ty = 0
  private selected: CountryCode | null = null
  private hovered: CountryCode | null = null
  private lastPointer: PointerEvent | null = null
  private compact = false
  private listExpanded = false
  private ro: ResizeObserver
  private mq = matchMedia('(prefers-color-scheme: dark)')
  private themeObserver: MutationObserver
  private pointers = new Map<number, { x: number; y: number }>()
  private gesture: { k: number; tx: number; ty: number; dist: number; cx: number; cy: number; moved: boolean } | null = null

  constructor(container: HTMLElement, opts: WorldMapOptions) {
    this.opts = opts
    for (const c of GEO.countries) this.byId.set(c.id, c)

    this.root = el('div', 'wm')
    this.header = el('div', 'wm-header')
    this.stage = el('div', 'wm-stage')
    this.svg = svgEl('svg', {
      viewBox: `0 0 ${GEO.width} ${GEO.height}`,
      class: 'wm-svg',
      role: 'group',
      'aria-label': 'World map',
    })
    this.zoomG = svgEl('g', { class: 'wm-zoom' })
    this.countriesG = svgEl('g', { class: 'wm-countries' })
    this.marksG = svgEl('g', { class: 'wm-marks' })
    this.zoomG.append(this.countriesG, this.marksG)
    this.svg.append(this.zoomG)
    this.tooltip = el('div', 'wm-tooltip')
    this.tooltip.hidden = true
    this.tooltip.setAttribute('role', 'status')
    this.zoomBar = el('div', 'wm-zoombar')
    this.stage.append(this.svg, this.tooltip, this.zoomBar)
    this.below = el('div', 'wm-below')
    this.below.hidden = true
    this.hint = el('p', 'wm-hint', 'Tap a country for its value.')
    this.legend = el('div', 'wm-legend')
    this.list = el('div', 'wm-list')
    this.sourceEl = el('p', 'wm-source')
    this.root.append(this.header, this.stage, this.below, this.legend, this.list, this.sourceEl)
    container.append(this.root)

    this.buildCountries()
    this.buildZoomBar()
    this.bindPointer()

    this.ro = new ResizeObserver(() => this.onResize())
    this.ro.observe(this.root)
    this.mq.addEventListener('change', this.repaint)
    this.themeObserver = new MutationObserver(this.repaint)
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

    this.onResize()
    this.setTheme(opts.theme)
  }

  /** Swap the data and look of the map. Zoom and selection are kept. */
  setTheme(theme: MapTheme): void {
    this.theme = theme
    this.root.dataset.theme = theme.id
    this.root.dataset.mode = theme.mode ?? 'choropleth'
    this.repaint()
  }

  /** The theme currently shown. */
  getTheme(): MapTheme {
    return this.theme
  }

  /** Select (and show the tooltip for) a country, or `null` to clear. */
  select(code: CountryCode | null): void {
    if (this.selected && this.paths.get(this.selected)) {
      this.paths.get(this.selected)!.classList.remove('is-selected')
    }
    this.selected = code && this.byId.has(code) ? code : null
    if (this.selected) {
      const p = this.paths.get(this.selected)!
      p.classList.add('is-selected')
      p.parentElement?.append(p) // bring its stroke on top
      // pin the tooltip where the pointer is; keyboard and list selections anchor it
      const e = this.lastPointer && this.lastPointer.target === p ? this.lastPointer : null
      this.showTooltip(this.selected, e)
    } else {
      this.hideTooltip()
    }
    this.renderList()
    this.opts.onSelect?.(this.selected ? this.byId.get(this.selected)! : null)
  }

  /** Zoom in on a country by code. */
  focus(code: CountryCode): void {
    const c = this.byId.get(code)
    if (!c) return
    const k = Math.min(MAX_ZOOM, Math.max(2.5, Math.sqrt(12000 / Math.max(c.a, 40))))
    this.setZoom(k, GEO.width / 2 - c.c[0] * k, GEO.height / 2 - c.c[1] * k, true)
  }

  resetZoom(): void {
    this.setZoom(1, 0, 0, true)
  }

  destroy(): void {
    this.ro.disconnect()
    this.mq.removeEventListener('change', this.repaint)
    this.themeObserver.disconnect()
    this.root.remove()
  }

  // ---------- build ----------

  private buildCountries() {
    for (const c of GEO.countries) {
      const p = svgEl('path', { d: c.d, class: 'wm-country', tabindex: 0, role: 'button', 'data-id': c.id })
      p.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch') return
        this.lastPointer = e
        this.hover(c.id, e)
      })
      p.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return
        this.lastPointer = e
        if (!this.selected) this.positionTooltip(e)
      })
      p.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'touch') return
        this.hover(null, e)
      })
      p.addEventListener('focus', () => this.hover(c.id, null))
      p.addEventListener('blur', () => this.hover(null, null))
      p.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          this.select(this.selected === c.id ? null : c.id)
        }
      })
      this.countriesG.append(p)
      this.paths.set(c.id, p)
    }
  }

  private buildZoomBar() {
    const mk = (label: string, title: string, fn: () => void) => {
      const b = el('button', 'wm-zoombtn', label)
      b.type = 'button'
      b.title = title
      b.setAttribute('aria-label', title)
      b.addEventListener('click', fn)
      return b
    }
    this.zoomBar.append(
      mk('+', 'Zoom in', () => this.zoomBy(1.6)),
      mk('−', 'Zoom out', () => this.zoomBy(1 / 1.6)),
      mk('⟲', 'Reset view', () => this.resetZoom()),
    )
  }

  // ---------- paint ----------

  private repaint = () => {
    if (!this.theme) return
    const dark = isDark(this.root)
    this.paint = this.computePaint(this.theme, dark)
    this.renderHeader()
    this.renderCountries()
    this.renderMarks()
    this.renderLegend()
    this.renderList()
    this.renderSource()
    if (this.selected) this.showTooltip(this.selected, null)
  }

  private computePaint(theme: MapTheme, dark: boolean): Paint {
    const fill = new Map<CountryCode, string>()
    const rank = new Map<CountryCode, number>()
    const rows: Paint['rows'] = []

    if (theme.mode === 'categorical') {
      const t = theme as CategoricalTheme
      const keys = Object.keys(t.categories)
      const palette = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT
      const color = new Map(keys.map((k, i) => [k, palette[i % palette.length]]))
      for (const [code, key] of Object.entries(t.data)) {
        const c = this.byId.get(code)
        if (!c || !color.has(key)) continue
        fill.set(code, color.get(key)!)
        rows.push({ country: c, value: key, display: t.categories[key], rank: keys.indexOf(key) + 1 })
      }
      rows.sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name))
      return {
        fill,
        rank,
        legend: keys.map((k) => ({ swatch: color.get(k)!, label: t.categories[k] })),
        legendTitle: t.title,
        rows,
        format: String,
        isNumeric: false,
      }
    }

    const t = theme as NumericTheme
    const entries = Object.entries(t.data).filter(([code, v]) => this.byId.has(code) && Number.isFinite(v))
    entries.sort((a, b) => b[1] - a[1])
    const values = entries.map((e) => e[1])
    const format = makeFormatter(t.format, values)
    const hue = hueAngle(t.hue)
    entries.forEach(([code], i) => rank.set(code, i + 1))

    if ((t.mode ?? 'choropleth') === 'ranked') {
      const top = Math.max(1, Math.min(t.top ?? 10, entries.length))
      const ramp = sequentialRamp(hue, top, dark, 0.3).reverse() // rank 1 = strongest
      entries.forEach(([code, v], i) => {
        const c = this.byId.get(code)!
        if (i < top) fill.set(code, ramp[i])
        rows.push({ country: c, value: v, display: format(v), rank: i + 1 })
      })
      return {
        fill,
        rank,
        legend: [
          { swatch: ramp[0], label: '1st' },
          { swatch: ramp[Math.floor((top - 1) / 2)], label: `${ordinal(Math.floor((top - 1) / 2) + 1)}` },
          { swatch: ramp[top - 1], label: ordinal(top) },
          { swatch: 'nodata', label: entries.length > top ? 'Other / no data' : 'No data' },
        ],
        legendTitle: `Top ${top} · ${t.unit}`,
        rows,
        format,
        isNumeric: true,
      }
    }

    // choropleth
    const sorted = [...values].sort((a, b) => a - b)
    let breaks: number[]
    if (t.breaks?.length) breaks = [...t.breaks].sort((a, b) => a - b)
    else {
      const k = Math.max(2, Math.min(t.classes ?? 5, 9))
      breaks =
        t.scale === 'linear'
          ? linearBreaks(sorted[0], sorted[sorted.length - 1], k)
          : quantileBreaks(sorted, k)
    }
    const ramp = sequentialRamp(hue, breaks.length + 1, dark)
    entries.forEach(([code, v], i) => {
      const c = this.byId.get(code)!
      fill.set(code, ramp[classOf(v, breaks)])
      rows.push({ country: c, value: v, display: format(v), rank: i + 1 })
    })
    const legend = ramp.map((swatch, i) => {
      let label: string
      if (i === 0) label = `< ${format(breaks[0])}`
      else if (i === ramp.length - 1) label = `≥ ${format(breaks[i - 1])}`
      else label = `${format(breaks[i - 1])} – ${format(breaks[i])}`
      return { swatch, label }
    })
    legend.push({ swatch: 'nodata', label: 'No data' })
    return { fill, rank, legend, legendTitle: t.unit, rows, format, isNumeric: true }
  }

  private renderHeader() {
    this.header.replaceChildren()
    this.header.hidden = !!this.opts.hideHeader
    if (this.opts.hideHeader) return
    this.header.append(el('h2', 'wm-title', this.theme.title))
    if (this.theme.subtitle) this.header.append(el('p', 'wm-subtitle', this.theme.subtitle))
  }

  private renderCountries() {
    const names = this.opts.names
    for (const c of GEO.countries) {
      const p = this.paths.get(c.id)!
      const fill = this.paint.fill.get(c.id)
      if (fill) {
        p.style.fill = fill
        p.classList.add('has-data')
      } else {
        p.style.fill = ''
        p.classList.remove('has-data')
      }
      p.setAttribute('aria-label', this.describe(c.id, names?.[c.id] ?? c.name))
    }
  }

  /** Rank badges (ranked mode) and micro-state dots (any mode). */
  private renderMarks() {
    this.marksG.replaceChildren()
    // viewBox units per CSS pixel, so marks keep one size on screen at any zoom or width
    const unitsPerPx = GEO.width / (this.svg.clientWidth || GEO.width)
    const inv = unitsPerPx / this.k
    const isRanked = this.theme.mode === 'ranked'

    // Micro states: a country too small to see gets a dot in its colour.
    for (const c of GEO.countries) {
      const fill = this.paint.fill.get(c.id)
      if (!fill || c.a > 6) continue
      if (isRanked && (this.paint.rank.get(c.id) ?? Infinity) <= ((this.theme as NumericTheme).top ?? 10)) continue
      const g = svgEl('g', { class: 'wm-dot', transform: `translate(${c.c[0]} ${c.c[1]}) scale(${inv})` })
      g.append(svgEl('circle', { r: DOT_PX, fill, class: 'wm-dot-circle' }))
      g.style.pointerEvents = 'none'
      this.marksG.append(g)
    }

    if (!isRanked) return
    const top = (this.theme as NumericTheme).top ?? 10
    const placed: { x: number; y: number }[] = []
    const r = BADGE_PX * inv
    const badges = this.paint.rows.filter((row) => row.rank <= top)
    for (const row of badges) {
      const [cx, cy] = row.country.c
      const [bx, by] = placeBadge(cx, cy, r, placed, GEO.width, GEO.height)
      placed.push({ x: bx, y: by })
      const fill = this.paint.fill.get(row.country.id)!
      const g = svgEl('g', { class: 'wm-badge' })
      g.style.pointerEvents = 'none'
      if (Math.hypot(bx - cx, by - cy) > r * 1.2) {
        g.append(svgEl('line', { x1: cx, y1: cy, x2: bx, y2: by, class: 'wm-leader' }))
        g.append(svgEl('circle', { cx, cy, r: 1.6 * inv, class: 'wm-leader-dot' }))
      }
      const inner = svgEl('g', { transform: `translate(${bx} ${by}) scale(${inv})` })
      inner.append(svgEl('circle', { r: BADGE_PX, fill, class: 'wm-badge-circle' }))
      const t = svgEl('text', { 'text-anchor': 'middle', dy: '0.36em', class: 'wm-badge-text' })
      t.textContent = String(row.rank)
      t.style.fill = inkOn(fill)
      inner.append(t)
      g.append(inner)
      this.marksG.append(g)
    }
  }

  private renderLegend() {
    this.legend.replaceChildren()
    const title = el('span', 'wm-legend-title', this.paint.legendTitle)
    this.legend.append(title)
    const items = el('div', 'wm-legend-items')
    for (const item of this.paint.legend) {
      const it = el('span', 'wm-legend-item')
      const sw = el('i', 'wm-swatch' + (item.swatch === 'nodata' ? ' is-nodata' : ''))
      if (item.swatch !== 'nodata') sw.style.background = item.swatch
      it.append(sw, el('span', undefined, item.label))
      items.append(it)
    }
    this.legend.append(items)
  }

  private renderList() {
    this.list.replaceChildren()
    this.list.hidden = !!this.opts.hideList
    if (this.opts.hideList || this.paint.rows.length === 0) return
    const rows = this.paint.rows
    const theme = this.theme
    const defaultRows = theme.mode === 'categorical' ? 8 : ((theme as NumericTheme).listRows ?? (theme as NumericTheme).top ?? 10)
    const shown = this.listExpanded ? rows : rows.slice(0, defaultRows)
    const max = this.paint.isNumeric ? Math.max(...rows.map((r) => r.value as number)) : 1

    const table = el('table', 'wm-table')
    const cap = el('caption', 'wm-table-caption')
    cap.textContent = this.paint.isNumeric
      ? `${theme.title} — ${(theme as NumericTheme).unit}`
      : theme.title
    table.append(cap)
    const thead = el('thead')
    const hr = el('tr')
    for (const h of this.paint.isNumeric ? ['#', 'Country', 'Value'] : ['', 'Country', 'Category']) {
      const th = el('th', undefined, h)
      th.scope = 'col'
      hr.append(th)
    }
    thead.append(hr)
    table.append(thead)
    const tbody = el('tbody')
    for (const row of shown) {
      const tr = el('tr')
      tr.dataset.id = row.country.id
      if (row.country.id === this.selected) tr.classList.add('is-selected')
      const fill = this.paint.fill.get(row.country.id)
      const rankCell = el('td', 'wm-rank')
      const dot = el('i', 'wm-swatch' + (fill ? '' : ' is-nodata'))
      if (fill) dot.style.background = fill
      rankCell.append(dot)
      if (this.paint.isNumeric) rankCell.append(document.createTextNode(String(row.rank)))
      const nameCell = el('td', 'wm-name')
      nameCell.textContent = this.opts.names?.[row.country.id] ?? row.country.name
      if (this.paint.isNumeric) {
        const bar = el('span', 'wm-bar')
        bar.style.width = `${Math.max(1.5, ((row.value as number) / max) * 100)}%`
        if (fill) bar.style.background = fill
        nameCell.append(bar)
      }
      const valCell = el('td', 'wm-value', row.display)
      tr.append(rankCell, nameCell, valCell)
      tr.addEventListener('click', () => {
        this.select(this.selected === row.country.id ? null : row.country.id)
        if (this.selected) this.focus(row.country.id)
      })
      tbody.append(tr)
    }
    table.append(tbody)
    this.list.append(table)

    if (rows.length > defaultRows) {
      const btn = el('button', 'wm-more', this.listExpanded ? 'Show fewer' : `Show all ${rows.length}`)
      btn.type = 'button'
      btn.addEventListener('click', () => {
        this.listExpanded = !this.listExpanded
        this.renderList()
      })
      this.list.append(btn)
    }
  }

  private renderSource() {
    this.sourceEl.replaceChildren()
    const s = this.theme.source
    this.sourceEl.hidden = !s
    if (!s) return
    this.sourceEl.append('Source: ')
    if (s.url) {
      const a = el('a', undefined, s.label)
      a.href = s.url
      a.target = '_blank'
      a.rel = 'noopener'
      this.sourceEl.append(a)
    } else this.sourceEl.append(s.label)
    if (s.note) this.sourceEl.append(` · ${s.note}`)
  }

  // ---------- tooltip / hover ----------

  private describe(code: CountryCode, name: string): string {
    const row = this.paint.rows.find((r) => r.country.id === code)
    if (!row) return `${name}: no data`
    if (!this.paint.isNumeric) return `${name}: ${row.display}`
    return `${name}: ${row.display} ${(this.theme as NumericTheme).unit}, ranked ${row.rank} of ${this.paint.rows.length}`
  }

  private hover(code: CountryCode | null, e: PointerEvent | null) {
    if (this.hovered && this.hovered !== code) this.paths.get(this.hovered)?.classList.remove('is-hover')
    this.hovered = code
    if (code) {
      const p = this.paths.get(code)!
      p.classList.add('is-hover')
      if (!this.selected) this.showTooltip(code, e)
    } else if (!this.selected) this.hideTooltip()
  }

  private showTooltip(code: CountryCode, e: PointerEvent | null) {
    const c = this.byId.get(code)!
    const row = this.paint.rows.find((r) => r.country.id === code)
    const tip = this.tooltip
    tip.replaceChildren()
    const head = el('div', 'wm-tip-head')
    head.append(el('strong', 'wm-tip-name', this.opts.names?.[code] ?? c.name))
    if (row && this.paint.isNumeric) head.append(el('span', 'wm-tip-rank', `#${row.rank} of ${this.paint.rows.length}`))
    tip.append(head)
    if (row) {
      const v = el('div', 'wm-tip-value')
      const sw = el('i', 'wm-swatch')
      sw.style.background = this.paint.fill.get(code) ?? ''
      if (!this.paint.fill.get(code)) sw.classList.add('is-nodata')
      v.append(sw, el('b', undefined, row.display))
      if (this.paint.isNumeric) v.append(el('span', 'wm-tip-unit', (this.theme as NumericTheme).unit))
      tip.append(v)
    } else tip.append(el('div', 'wm-tip-value is-muted', 'No data'))
    const note = this.theme.notes?.[code]
    if (note) tip.append(el('p', 'wm-tip-note', note))
    if (this.selected === code) {
      const close = el('button', 'wm-tip-close', '×')
      close.type = 'button'
      close.setAttribute('aria-label', 'Close')
      close.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.select(null)
      })
      tip.append(close)
    }
    tip.hidden = false
    tip.classList.toggle('is-pinned', this.selected === code)
    this.positionTooltip(e)
  }

  private positionTooltip(e: PointerEvent | null) {
    const tip = this.tooltip
    if (tip.hidden) return
    tip.style.left = ''
    tip.style.top = ''
    if (this.compact) {
      this.hint.hidden = true
      return
    }
    if (!e) {
      // no pointer (keyboard, list click): anchor to the stage's bottom-left
      tip.classList.add('is-anchored')
      return
    }
    tip.classList.remove('is-anchored')
    const sr = this.stage.getBoundingClientRect()
    const x = e.clientX - sr.left
    const y = e.clientY - sr.top
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    let left = x + 14
    let top = y + 14
    if (left + tw > sr.width - 8) left = x - tw - 14
    if (top + th > sr.height - 8) top = y - th - 14
    tip.style.left = `${Math.max(8, left)}px`
    tip.style.top = `${Math.max(8, top)}px`
  }

  private hideTooltip() {
    this.tooltip.hidden = true
    this.hint.hidden = false
  }

  // ---------- zoom & pan ----------

  private setZoom(k: number, tx: number, ty: number, animate = false) {
    k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
    // keep the map covering the viewport
    const W = GEO.width
    const H = GEO.height
    tx = Math.min(0, Math.max(W - W * k, tx))
    ty = Math.min(0, Math.max(H - H * k, ty))
    if (k === 1) {
      tx = 0
      ty = 0
    }
    this.k = k
    this.tx = tx
    this.ty = ty
    this.zoomG.style.transition = animate ? 'transform 320ms ease' : ''
    this.zoomG.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`)
    this.root.classList.toggle('is-zoomed', k > 1)
    this.svg.style.touchAction = k > 1 ? 'none' : 'pan-y'
    this.renderMarks()
  }

  private zoomBy(f: number, cx = GEO.width / 2, cy = GEO.height / 2) {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.k * f))
    const s = k / this.k
    this.setZoom(k, cx - (cx - this.tx) * s, cy - (cy - this.ty) * s, true)
  }

  /** Client -> viewBox coordinates. */
  private toView(clientX: number, clientY: number): [number, number] {
    const r = this.svg.getBoundingClientRect()
    return [((clientX - r.left) / r.width) * GEO.width, ((clientY - r.top) / r.height) * GEO.height]
  }

  private bindPointer() {
    const svg = this.svg
    svg.style.touchAction = 'pan-y'

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pts = [...this.pointers.values()]
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
      const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
      this.gesture = { k: this.k, tx: this.tx, ty: this.ty, dist, cx, cy, moved: this.gesture?.moved ?? false }
      if (this.k > 1 || pts.length > 1) svg.setPointerCapture(e.pointerId)
    })

    svg.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId) || !this.gesture) return
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pts = [...this.pointers.values()]
      const g = this.gesture
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
      const r = svg.getBoundingClientRect()
      const scale = GEO.width / r.width
      const dx = (cx - g.cx) * scale
      const dy = (cy - g.cy) * scale
      if (Math.hypot(cx - g.cx, cy - g.cy) > 4) g.moved = true
      if (pts.length > 1) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        if (g.dist === 0) g.dist = dist
        const f = dist / g.dist
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.k * f))
        const s = k / g.k
        const [vx, vy] = this.toView(g.cx, g.cy)
        this.setZoom(k, vx - (vx - g.tx) * s + dx, vy - (vy - g.ty) * s + dy)
        g.moved = true
      } else if (this.k > 1 && g.moved) {
        this.setZoom(g.k, g.tx + dx, g.ty + dy)
      }
    })

    const end = (e: PointerEvent) => {
      const had = this.pointers.has(e.pointerId)
      this.pointers.delete(e.pointerId)
      if (!had) return
      if (this.pointers.size === 0) {
        const moved = this.gesture?.moved
        this.gesture = null
        if (!moved && e.type === 'pointerup') {
          const target = (e.target as Element).closest('.wm-country') as SVGPathElement | null
          const id = target?.dataset.id ?? null
          this.select(this.selected === id ? null : id)
        }
      } else {
        // one finger left: restart the gesture from the remaining pointer
        const pts = [...this.pointers.values()]
        this.gesture = { k: this.k, tx: this.tx, ty: this.ty, dist: 0, cx: pts[0].x, cy: pts[0].y, moved: true }
      }
    }
    svg.addEventListener('pointerup', end)
    svg.addEventListener('pointercancel', end)

    svg.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey && this.k === 1) return // let the page scroll
      e.preventDefault()
      const [vx, vy] = this.toView(e.clientX, e.clientY)
      this.zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, vx, vy)
    }, { passive: false })

    svg.addEventListener('dblclick', (e) => {
      const [vx, vy] = this.toView(e.clientX, e.clientY)
      if (this.k >= MAX_ZOOM / 2) this.resetZoom()
      else this.zoomBy(2.2, vx, vy)
    })

    // tap outside the map (but inside the component) clears the selection
    this.root.addEventListener('pointerdown', (e) => {
      const t = e.target as Element
      if (t.closest('.wm-svg') || t.closest('.wm-tooltip') || t.closest('.wm-table') || t.closest('button')) return
      if (this.selected) this.select(null)
    })
  }

  private onResize() {
    const w = this.root.clientWidth
    const compact = w > 0 && w < COMPACT_WIDTH
    if (compact !== this.compact) {
      this.compact = compact
      this.root.classList.toggle('is-compact', compact)
      this.below.hidden = !compact
      if (compact) {
        // tooltip and zoom controls leave the (small) map and sit under it
        this.below.replaceChildren(this.hint, this.tooltip, this.zoomBar)
        this.hint.hidden = !this.tooltip.hidden
      } else {
        this.stage.append(this.tooltip, this.zoomBar)
      }
      if (!this.tooltip.hidden) this.positionTooltip(null)
    }
    if (this.paint) this.renderMarks()
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Find a badge position near (cx, cy) that does not overlap already placed badges. */
function placeBadge(
  cx: number,
  cy: number,
  r: number,
  placed: { x: number; y: number }[],
  W: number,
  H: number,
): [number, number] {
  const gap = r * 2.15
  const clear = (x: number, y: number) =>
    x >= r && y >= r && x <= W - r && y <= H - r && placed.every((p) => Math.hypot(p.x - x, p.y - y) >= gap)
  if (clear(cx, cy)) return [cx, cy]
  for (let ring = 1; ring <= 8; ring++) {
    const rad = ring * gap * 0.9
    const steps = 8 * ring
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(a) * rad
      const y = cy + Math.sin(a) * rad
      if (clear(x, y)) return [x, y]
    }
  }
  return [cx, cy]
}
