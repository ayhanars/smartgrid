import Matter, { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint, Query, Vertices } from 'matter-js'
import decomp from 'poly-decomp'
import { hueAngle, inkOn, oklchToHex, sequentialRamp } from '../lib/color'
import { makeFormatter } from '../lib/format'
import type { Country, NumericTheme } from '../lib/types'
import { GEO } from '../lib/worldmap'
import { mainOutline, type Pt } from './outline'

Matter.Common.setDecomp(decomp)

export interface JellyOptions {
  theme: NumericTheme
  /** How many countries drop in (default: theme.top or 12). */
  count?: number
  onSelect?: (jelly: Jelly | null) => void
  /** Space (px) between the canvas edge and the glass panel: room for the page's chrome. */
  inset?: { top?: number; right?: number; bottom?: number; left?: number }
}

export interface Jelly {
  country: Country
  rank: number
  value: number
  display: string
  color: string
  ink: string
  body: Body
  /** Outline in body-local coordinates (pixels, centre of mass at 0,0). */
  local: Pt[]
  w: number
  h: number
  /** Squash-and-stretch state. */
  amp: number
  phase: number
  axis: number
}

const MAX_DPR = 2
const GRAVITY = 1.1
const PANEL_RADIUS = 22

/**
 * A full-screen glass panel into which the top countries of a theme drop as
 * translucent jellies, each scaled by its value. Drag, throw, drop again.
 */
export class JellyScene {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private engine: Engine
  private mouse: Mouse
  private mouseConstraint: MouseConstraint
  private jellies: Jelly[] = []
  private walls: Body[] = []
  private theme!: NumericTheme
  private opts: JellyOptions
  private W = 0
  private H = 0
  /** The glass panel: the jellies live inside it. */
  private box = { x: 0, y: 0, w: 0, h: 0 }
  private dpr = 1
  private raf = 0
  private last = 0
  private spawnTimers: number[] = []
  private ro: ResizeObserver
  private selected: Jelly | null = null
  private pressed: { x: number; y: number; t: number } | null = null
  private hue = 255
  private running = true
  private labelRects: { x: number; y: number; w: number; h: number }[] = []

  constructor(container: HTMLElement, opts: JellyOptions) {
    this.opts = opts
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'jelly-canvas'
    this.canvas.style.touchAction = 'none'
    container.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')!

    this.engine = Engine.create({ enableSleeping: true })
    this.engine.gravity.y = GRAVITY

    this.mouse = Mouse.create(this.canvas)
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: { stiffness: 0.12, damping: 0.08, render: { visible: false } },
    })
    Composite.add(this.engine.world, this.mouseConstraint)
    // Matter's mouse swallows wheel events; the page does not scroll anyway
    this.canvas.removeEventListener('mousewheel', (this.mouse as unknown as { mousewheel: EventListener }).mousewheel)
    this.canvas.removeEventListener('DOMMouseScroll', (this.mouse as unknown as { mousewheel: EventListener }).mousewheel)

    Events.on(this.engine, 'collisionStart', (e) => {
      for (const pair of e.pairs) {
        const a = pair.bodyA.parent
        const b = pair.bodyB.parent
        const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y)
        const amp = Math.min(0.28, rel * 0.022)
        if (amp < 0.015) continue
        const n = pair.collision.normal
        const axis = Math.atan2(n.y, n.x)
        for (const body of [a, b]) {
          const j = this.jellies.find((x) => x.body === body)
          if (!j) continue
          j.amp = Math.max(j.amp, amp * (body.isStatic ? 0 : 1))
          j.phase = 0
          j.axis = axis
        }
      }
    })

    // tap (press and release without moving) selects a jelly
    this.canvas.addEventListener('pointerdown', (e) => {
      this.pressed = { x: e.clientX, y: e.clientY, t: performance.now() }
      const j = this.hit(e)
      if (j) {
        // wake and give a little wobble so it feels grabbed
        Matter.Sleeping.set(j.body, false)
        j.amp = Math.max(j.amp, 0.12)
        j.phase = 0
        j.axis = Math.PI / 2
      }
    })
    this.canvas.addEventListener('pointerup', (e) => {
      const p = this.pressed
      this.pressed = null
      if (!p) return
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
      if (moved > 8 || performance.now() - p.t > 400) return
      const j = this.hit(e)
      this.select(j && j !== this.selected ? j : null)
    })

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.setTheme(opts.theme)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  /** Load another theme: the jellies are rebuilt and drop in again. */
  setTheme(theme: NumericTheme): void {
    this.theme = theme
    this.hue = hueAngle(theme.hue)
    this.drop()
  }

  getTheme(): NumericTheme {
    return this.theme
  }

  /** Lift every jelly back above the glass and let it fall again. */
  drop(): void {
    this.clearJellies()
    this.select(null)
    const t = this.theme
    const entries = Object.entries(t.data)
      .filter(([code, v]) => GEO.countries.some((c) => c.id === code) && Number.isFinite(v))
      .sort((a, b) => b[1] - a[1])
    const n = Math.max(1, Math.min(this.opts.count ?? t.top ?? 12, entries.length))
    const top = entries.slice(0, n)
    const format = makeFormatter(t.format, entries.map((e) => e[1]))
    const ramp = sequentialRamp(this.hue, n, true, 0.35).reverse()
    const vmax = top[0][1]

    // Each jelly's area is proportional to its value, with a floor so the small
    // ones stay readable and draggable. Together they fill a share of the glass.
    const ratios = top.map(([, v]) => Math.max(0.07, v / vmax))
    const glassArea = this.box.w * this.box.h
    let aMax = (glassArea * 0.62) / ratios.reduce((s, r) => s + r, 0)
    const outlines = top.map(([code]) => mainOutline(GEO.countries.find((c) => c.id === code)!))
    // keep the biggest one inside the glass with room to move
    const o0 = outlines[0]
    const fitW = (this.box.w * 0.8) / o0.w
    const fitH = (this.box.h * 0.5) / o0.h
    aMax = Math.min(aMax, Math.min(fitW, fitH) ** 2)

    top.forEach(([code, value], i) => {
      const country = GEO.countries.find((c) => c.id === code)!
      const o = outlines[i]
      const scale = Math.sqrt(aMax * ratios[i])
      const pts: Pt[] = o.pts.map(([x, y]) => [x * scale, y * scale])
      const w = o.w * scale
      const h = o.h * scale
      const color = ramp[i]
      const delay = 140 * i + 60
      const timer = window.setTimeout(() => {
        const x = this.box.x + w / 2 + 12 + Math.random() * Math.max(1, this.box.w - w - 24)
        const y = -h / 2 - 20 - Math.random() * 60
        const jelly = this.makeJelly(country, i + 1, value, format(value), color, pts, w, h, x, y)
        this.jellies.push(jelly)
        Composite.add(this.engine.world, jelly.body)
      }, delay)
      this.spawnTimers.push(timer)
    })
  }

  select(j: Jelly | null): void {
    this.selected = j
    this.opts.onSelect?.(j)
  }

  getSelected(): Jelly | null {
    return this.selected
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.clearJellies()
    this.ro.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    Mouse.clearSourceEvents(this.mouse)
    this.canvas.remove()
  }

  // ---------- internals ----------

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
    } else {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private hit(e: PointerEvent): Jelly | null {
    const r = this.canvas.getBoundingClientRect()
    const p = { x: e.clientX - r.left, y: e.clientY - r.top }
    const bodies = Query.point(this.jellies.map((j) => j.body), p)
    if (!bodies.length) return null
    const body = bodies[0].parent
    return this.jellies.find((j) => j.body === body) ?? null
  }

  private clearJellies() {
    for (const t of this.spawnTimers) clearTimeout(t)
    this.spawnTimers = []
    for (const j of this.jellies) Composite.remove(this.engine.world, j.body)
    this.jellies = []
  }

  private makeJelly(
    country: Country,
    rank: number,
    value: number,
    display: string,
    color: string,
    pts: Pt[],
    w: number,
    h: number,
    x: number,
    y: number,
  ): Jelly {
    const poly = pts.map(([px, py]) => [px, py] as Pt)
    decomp.makeCCW(poly)
    const simple = decomp.isSimple(poly)
    const verts = (simple ? poly : hullOf(poly)).map(([px, py]) => ({ x: px, y: py }))
    const body = Bodies.fromVertices(x, y, [verts], {
      restitution: 0.32,
      friction: 0.55,
      frictionStatic: 0.7,
      frictionAir: 0.018,
      density: 0.0022,
      angle: (Math.random() - 0.5) * 0.5,
      angularVelocity: (Math.random() - 0.5) * 0.04,
      sleepThreshold: 90,
    }, true, 0.01, 2)
    // The drawn outline is the original polygon placed so that its convex hull's
    // centroid matches the body hull's centroid: that aligns it with the centre of
    // mass Matter chose, and survives Matter dropping near-collinear points.
    const ringHull = hullOf(pts)
    const rh = Vertices.centre(ringHull.map(([px, py]) => ({ x: px, y: py })))
    const bh = Vertices.centre(body.vertices)
    // body vertices are already rotated by `angle`; undo it to compare in local space
    const cos = Math.cos(-body.angle)
    const sin = Math.sin(-body.angle)
    const dx = bh.x - body.position.x
    const dy = bh.y - body.position.y
    const bhl = { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
    const off = { x: bhl.x - rh.x, y: bhl.y - rh.y }
    const local: Pt[] = pts.map(([px, py]) => [px + off.x, py + off.y])
    return { country, rank, value, display, color, ink: inkOn(color), body, local, w, h, amp: 0, phase: 0, axis: Math.PI / 2 }
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect()
    const W = Math.max(1, Math.round(r.width))
    const H = Math.max(1, Math.round(r.height))
    const dpr = Math.min(MAX_DPR, devicePixelRatio || 1)
    if (W === this.W && H === this.H && dpr === this.dpr) return
    const sizeChanged = this.W > 0 && (Math.abs(W - this.W) > 80 || Math.abs(H - this.H) > 120)
    this.W = W
    this.H = H
    this.dpr = dpr
    this.canvas.width = W * dpr
    this.canvas.height = H * dpr
    this.canvas.style.width = `${W}px`
    this.canvas.style.height = `${H}px`
    Mouse.setScale(this.mouse, { x: 1, y: 1 })
    const ins = this.opts.inset ?? {}
    const x0 = ins.left ?? 8
    const y0 = ins.top ?? 8
    this.box = { x: x0, y: y0, w: W - x0 - (ins.right ?? 8), h: H - y0 - (ins.bottom ?? 8) }
    const { box } = this

    for (const w of this.walls) Composite.remove(this.engine.world, w)
    const t = 200
    const opt = { isStatic: true, friction: 0.6, restitution: 0.2 }
    const floorY = box.y + box.h
    this.walls = [
      Bodies.rectangle(W / 2, floorY + t / 2, W + 2 * t, t, opt), // floor
      Bodies.rectangle(box.x - t / 2, H / 2 - H, t, H * 4, opt), // left
      Bodies.rectangle(box.x + box.w + t / 2, H / 2 - H, t, H * 4, opt), // right
      Bodies.rectangle(W / 2, -H * 2 - t / 2, W + 2 * t, t, opt), // ceiling, far above
    ]
    Composite.add(this.engine.world, this.walls)
    if (sizeChanged && this.theme) this.drop()
  }

  private frame = (now: number) => {
    if (!this.running) return
    const dt = Math.min(32, now - this.last)
    this.last = now
    Engine.update(this.engine, dt)
    for (const j of this.jellies) {
      if (j.amp > 0.002) {
        j.phase += dt * 0.022
        j.amp *= Math.pow(0.9, dt / 16)
      } else j.amp = 0
      // a dragged jelly stretches along its velocity
      if (this.mouseConstraint.body === j.body) {
        const sp = Math.hypot(j.body.velocity.x, j.body.velocity.y)
        if (sp > 2) {
          j.amp = Math.max(j.amp, Math.min(0.18, sp * 0.012))
          j.axis = Math.atan2(j.body.velocity.y, j.body.velocity.x)
          j.phase = Math.PI / 2
        }
      }
    }
    this.draw()
    this.raf = requestAnimationFrame(this.frame)
  }

  private draw() {
    const { ctx, W, H, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    this.drawGlass()

    // soft shadows first, then the bodies, so shadows never sit on top of a neighbour
    for (const j of this.jellies) this.drawJelly(j, true)
    this.labelRects = []
    for (const j of this.jellies) {
      this.drawJelly(j, false)
      this.drawLabel(j) // with its jelly, so a jelly on top covers the label beneath it
    }
    this.drawGlassFront()
  }

  private drawGlass() {
    const { ctx, W, H } = this
    // backdrop: deep ground with two coloured glows in the theme's hue
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0c0f1a')
    g.addColorStop(1, '#05060b')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    const glow = (x: number, y: number, r: number, c: string, a: number) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
      rg.addColorStop(0, hexA(c, a))
      rg.addColorStop(1, hexA(c, 0))
      ctx.fillStyle = rg
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    glow(W * 0.2, H * 0.85, Math.max(W, H) * 0.55, oklchToHex(0.6, 0.16, this.hue), 0.35)
    glow(W * 0.85, H * 0.15, Math.max(W, H) * 0.45, oklchToHex(0.65, 0.14, (this.hue + 60) % 360), 0.22)

    // the glass panel: a faint tint, a diagonal sheen and a lit floor, clipped to a rounded pane
    const { box } = this
    ctx.save()
    roundRect(ctx, box.x, box.y, box.w, box.h, PANEL_RADIUS)
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fillRect(box.x, box.y, box.w, box.h)
    const sheen = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h)
    sheen.addColorStop(0, 'rgba(255,255,255,0.00)')
    sheen.addColorStop(0.3, 'rgba(255,255,255,0.07)')
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.00)')
    sheen.addColorStop(0.7, 'rgba(255,255,255,0.045)')
    sheen.addColorStop(1, 'rgba(255,255,255,0.00)')
    ctx.fillStyle = sheen
    ctx.fillRect(box.x, box.y, box.w, box.h)
    const floorY = box.y + box.h
    const floor = ctx.createLinearGradient(0, floorY - 110, 0, floorY)
    floor.addColorStop(0, hexA(oklchToHex(0.7, 0.12, this.hue), 0))
    floor.addColorStop(1, hexA(oklchToHex(0.7, 0.12, this.hue), 0.22))
    ctx.fillStyle = floor
    ctx.fillRect(box.x, floorY - 110, box.w, 110)
    ctx.restore()
  }

  private drawGlassFront() {
    const { ctx, box } = this
    // the pane's edge: a hairline, brighter along the top and left where light hits it
    ctx.save()
    roundRect(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, PANEL_RADIUS)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.stroke()
    ctx.clip()
    const top = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y)
    top.addColorStop(0, 'rgba(255,255,255,0.0)')
    top.addColorStop(0.3, 'rgba(255,255,255,0.55)')
    top.addColorStop(0.7, 'rgba(255,255,255,0.1)')
    top.addColorStop(1, 'rgba(255,255,255,0.0)')
    ctx.fillStyle = top
    ctx.fillRect(box.x, box.y, box.w, 1.5)
    const left = ctx.createLinearGradient(0, box.y, 0, box.y + box.h)
    left.addColorStop(0, 'rgba(255,255,255,0.4)')
    left.addColorStop(0.5, 'rgba(255,255,255,0.06)')
    left.addColorStop(1, 'rgba(255,255,255,0.25)')
    ctx.fillStyle = left
    ctx.fillRect(box.x + 6, box.y + 28, 1.5, box.h - 56)
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    ctx.fillRect(box.x + 11, box.y + 60, 1, box.h * 0.28)
    // the floor line the jellies rest on
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(box.x, box.y + box.h - 1, box.w, 1)
    ctx.restore()
  }

  private jellyPath(j: Jelly) {
    const { ctx } = this
    const b = j.body
    const s = j.amp * Math.sin(j.phase)
    ctx.translate(b.position.x, b.position.y)
    // squash along `axis`, stretch across it (volume-preserving look)
    ctx.rotate(j.axis)
    ctx.scale(1 - s, 1 + s)
    ctx.rotate(b.angle - j.axis)
    ctx.beginPath()
    j.local.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
  }

  private drawJelly(j: Jelly, shadowPass: boolean) {
    const { ctx } = this
    ctx.save()
    this.jellyPath(j)
    if (shadowPass) {
      ctx.fillStyle = hexA(j.color, 0.28)
      ctx.filter = 'blur(14px)'
      ctx.translate(0, 0)
      ctx.fill()
      ctx.restore()
      return
    }
    // body: translucent colour with a darker core toward the bottom
    const grad = ctx.createLinearGradient(0, -j.h / 2, 0, j.h / 2)
    grad.addColorStop(0, hexA(lighten(j.color, 0.12), 0.9))
    grad.addColorStop(0.55, hexA(j.color, 0.86))
    grad.addColorStop(1, hexA(lighten(j.color, -0.14), 0.92))
    ctx.fillStyle = grad
    ctx.fill()
    // rim light
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2
    ctx.strokeStyle = hexA(lighten(j.color, 0.25), 0.9)
    ctx.stroke()
    ctx.lineWidth = 0.75
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.stroke()
    // gloss: a soft highlight in the upper part of the shape
    ctx.clip()
    const hl = ctx.createRadialGradient(-j.w * 0.18, -j.h * 0.3, 0, -j.w * 0.18, -j.h * 0.3, Math.max(j.w, j.h) * 0.6)
    hl.addColorStop(0, 'rgba(255,255,255,0.55)')
    hl.addColorStop(0.45, 'rgba(255,255,255,0.12)')
    hl.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hl
    ctx.fillRect(-j.w, -j.h, j.w * 2, j.h * 2)
    // a crisp specular dot
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.ellipse(-j.w * 0.22, -j.h * 0.32, Math.max(3, j.w * 0.07), Math.max(2, j.h * 0.045), -0.5, 0, Math.PI * 2)
    ctx.fill()
    if (j === this.selected) {
      ctx.restore()
      ctx.save()
      this.jellyPath(j)
      ctx.lineWidth = 3
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawLabel(j: Jelly) {
    const { ctx } = this
    const b = j.body
    const sizePx = Math.min(j.w, j.h)
    ctx.save()
    ctx.translate(b.position.x, b.position.y)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = j.ink
    const font = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    // a label that would land on one already drawn this frame shrinks to the code, or goes
    const claim = (w: number, h: number) => {
      const r = { x: b.position.x - w / 2, y: b.position.y - h / 2, w, h }
      const hit = this.labelRects.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)
      if (!hit) this.labelRects.push(r)
      return !hit
    }
    if (sizePx >= 78) {
      const nameSize = Math.max(12, Math.min(22, sizePx * 0.16))
      ctx.font = `700 ${nameSize}px ${font}`
      const name = ctx.measureText(j.country.name).width <= j.w * 0.85 ? j.country.name : j.country.id
      const tw = Math.max(ctx.measureText(name).width, ctx.measureText(j.display).width * 0.8)
      if (claim(tw + 8, nameSize * 2.4)) {
        ctx.fillText(name, 0, -nameSize * 0.55)
        ctx.font = `500 ${Math.max(11, nameSize * 0.8)}px ${font}`
        ctx.globalAlpha = 0.85
        ctx.fillText(j.display, 0, nameSize * 0.6)
      } else if (claim(nameSize * 2, nameSize * 1.2)) {
        ctx.fillText(j.country.id, 0, 0)
      }
    } else if (sizePx >= 40) {
      const fs = Math.max(11, sizePx * 0.26)
      ctx.font = `700 ${fs}px ${font}`
      if (claim(fs * 1.6, fs * 1.2)) ctx.fillText(j.country.id, 0, 0)
    } else {
      ctx.font = `700 11px ${font}`
      if (claim(14, 13)) ctx.fillText(String(j.rank), 0, 0)
    }
    ctx.restore()
  }
}

function hullOf(pts: Pt[]): Pt[] {
  const h = Vertices.hull(pts.map(([x, y]) => ({ x, y }) as Matter.Vertex))
  return h.map((v) => [v.x, v.y])
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)),
  )
  return '#' + ch.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
