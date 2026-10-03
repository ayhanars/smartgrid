import Matter, { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint, Query } from 'matter-js'
import { hueAngle, oklchToHex } from '../lib/color'
import { makeFormatter } from '../lib/format'
import type { Country, NumericTheme } from '../lib/types'
import { GEO } from '../lib/worldmap'

/** How the scene is drawn. The physics and interactions are the same for every skin. */
export type Skin = 'glass' | 'note'

export interface BubbleOptions {
  theme: NumericTheme
  /** 'glass': iridescent soap film on deep ink. 'note': engraved banknote medallions on paper. */
  skin?: Skin
  /** How many countries become bubbles (default 18). The theme's `top` are labelled. */
  count?: number
  /** Space (px) between the canvas edge and the glass: room for the page's chrome. */
  inset?: { top?: number; right?: number; bottom?: number; left?: number }
  onSelect?: (b: Bubble | null) => void
  /** A bubble touched the floor at speed (ripple, haptic). */
  onLand?: (b: Bubble, speed: number) => void
  /** Font stacks for the labels. Glass: `value` (numbers) and `name`. Note: `noteValue`, `noteName`, `micro`. */
  fonts?: { value?: string; name?: string; noteValue?: string; noteName?: string; micro?: string }
}

export interface Bubble {
  country: Country
  rank: number
  value: number
  display: string
  /** Share of the leader, 0..1. */
  share: number
  color: string
  light: string
  /** Banknote skin: ink and paper tones. */
  ink: string
  paper: string
  body: Body
  R: number
  /** Squash-and-stretch (mode 2) state. */
  amp: number
  phase: number
  axis: number
  seed: number
  born: number
  /** Banknote skin: the engraved pattern, drawn once per bubble. */
  plate?: HTMLCanvasElement
}

interface Droplet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  color: string
  t: number
}

interface Ripple {
  x: number
  y: number
  t: number
  r: number
}

interface Contact {
  phi: number
  depth: number
}

const MAX_DPR = 2
const RIM_POINTS = 64
const TAU = Math.PI * 2

/**
 * Countries as soft bubbles in a glass. Rigid circles do the physics; the
 * rendering flattens each rim where it presses on a neighbour or the floor,
 * adds a wobble on impact and a stretch while dragged, so they read as soft.
 */
export class BubbleScene {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private engine: Engine
  private mouse: Mouse
  private mouseConstraint: MouseConstraint
  private bubbles: Bubble[] = []
  private walls: Body[] = []
  private droplets: Droplet[] = []
  private ripples: Ripple[] = []
  private theme!: NumericTheme
  private opts: BubbleOptions
  private W = 0
  private H = 0
  private box = { x: 0, y: 0, w: 0, h: 0 }
  private dpr = 1
  private raf = 0
  private last = 0
  private now = 0
  private timers: number[] = []
  private ro: ResizeObserver
  private selected: Bubble | null = null
  private pressed: { x: number; y: number; t: number; b: Bubble | null } | null = null
  private lastTap = { t: 0, b: null as Bubble | null }
  private hue = 255
  private running = true
  private skin: Skin = 'glass'
  private tiltHandler: ((e: DeviceOrientationEvent) => void) | null = null
  private bg: { x: number; y: number; r: number; dx: number; dy: number; h: number }[] = []

  constructor(container: HTMLElement, opts: BubbleOptions) {
    this.opts = opts
    this.skin = opts.skin ?? 'glass'
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'bubble-canvas'
    this.canvas.style.touchAction = 'none'
    container.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')!

    this.engine = Engine.create({ enableSleeping: false })
    this.engine.gravity.y = 0.75
    this.mouse = Mouse.create(this.canvas)
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: { stiffness: 0.06, damping: 0.12, render: { visible: false } },
    })
    Composite.add(this.engine.world, this.mouseConstraint)
    const mw = (this.mouse as unknown as { mousewheel: EventListener }).mousewheel
    this.canvas.removeEventListener('mousewheel', mw)
    this.canvas.removeEventListener('DOMMouseScroll', mw)

    Events.on(this.engine, 'collisionStart', (e) => {
      for (const pair of e.pairs) {
        const a = pair.bodyA
        const b = pair.bodyB
        const rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y)
        const amp = Math.min(0.22, rel * 0.03)
        const n = pair.collision.normal
        for (const [body, other] of [[a, b], [b, a]] as const) {
          const bub = this.bubbles.find((x) => x.body === body)
          if (!bub) continue
          if (amp > 0.02) {
            bub.amp = Math.max(bub.amp, amp)
            bub.phase = 0
            bub.axis = Math.atan2(n.y, n.x)
          }
          if (other === this.walls[0] && rel > 1.6) {
            this.ripples.push({ x: body.position.x, y: this.box.y + this.box.h, t: this.now, r: bub.R })
            this.opts.onLand?.(bub, rel)
          }
        }
      }
    })

    this.canvas.addEventListener('pointerdown', (e) => {
      const b = this.hit(e)
      this.pressed = { x: e.clientX, y: e.clientY, t: performance.now(), b }
      if (b) {
        b.amp = Math.max(b.amp, 0.1)
        b.phase = 0
        b.axis = Math.PI / 2
      }
    })
    this.canvas.addEventListener('pointerup', (e) => {
      const p = this.pressed
      this.pressed = null
      if (!p) return
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y)
      if (moved > 10 || performance.now() - p.t > 450) return
      const b = this.hit(e)
      const now = performance.now()
      if (b && this.lastTap.b === b && now - this.lastTap.t < 320) {
        this.lastTap = { t: 0, b: null }
        this.pop(b)
        return
      }
      this.lastTap = { t: now, b }
      this.select(b && b !== this.selected ? b : null)
    })

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.setTheme(opts.theme)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  setTheme(theme: NumericTheme): void {
    this.theme = theme
    this.hue = hueAngle(theme.hue)
    this.bg = Array.from({ length: 4 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.45 + Math.random() * 0.3,
      dx: (Math.random() - 0.5) * 0.00004,
      dy: (Math.random() - 0.5) * 0.00003,
      h: (this.hue + [0, 35, -30, 70][i] + 360) % 360,
    }))
    this.drop()
  }

  getTheme(): NumericTheme {
    return this.theme
  }

  /** Switch the look in place; the bubbles keep their positions. */
  setSkin(skin: Skin): void {
    this.skin = skin
    for (const b of this.bubbles) b.plate = undefined
  }

  getSkin(): Skin {
    return this.skin
  }

  /** Every bubble goes back above the glass and falls in again, biggest first. */
  drop(): void {
    this.clear()
    this.select(null)
    const t = this.theme
    const entries = Object.entries(t.data)
      .filter(([code, v]) => GEO.countries.some((c) => c.id === code) && Number.isFinite(v))
      .sort((a, b) => b[1] - a[1])
    const n = Math.max(1, Math.min(this.opts.count ?? 18, entries.length))
    const list = entries.slice(0, n)
    const format = makeFormatter(t.format, entries.map((e) => e[1]))
    const vmax = list[0][1]
    const radii = this.layoutRadii(list.map(([, v]) => v / vmax))
    list.forEach(([code, value], i) => {
      const country = GEO.countries.find((c) => c.id === code)!
      const R = radii[i]
      const delay = 90 * i + 80
      const timer = window.setTimeout(() => {
        const x = this.box.x + R + 6 + Math.random() * Math.max(1, this.box.w - 2 * R - 12)
        const y = this.box.y - R - 10 - Math.random() * 80
        this.spawn(country, i + 1, value, format(value), value / vmax, R, x, y)
      }, delay)
      this.timers.push(timer)
    })
  }

  /** Burst a bubble into droplets; it re-forms above the glass a moment later. */
  pop(b: Bubble): void {
    const i = this.bubbles.indexOf(b)
    if (i < 0) return
    this.bubbles.splice(i, 1)
    Composite.remove(this.engine.world, b.body)
    if (this.selected === b) this.select(null)
    const p = b.body.position
    const count = Math.round(10 + b.R / 6)
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + Math.random() * 0.4
      const sp = 2 + Math.random() * 3 + b.R * 0.04
      this.droplets.push({
        x: p.x + Math.cos(a) * b.R * 0.8,
        y: p.y + Math.sin(a) * b.R * 0.8,
        vx: Math.cos(a) * sp + b.body.velocity.x * 0.5,
        vy: Math.sin(a) * sp + b.body.velocity.y * 0.5 - 1.5,
        r: 2 + Math.random() * Math.min(6, b.R * 0.12),
        color: this.skin === 'note' ? b.ink : b.light,
        t: this.now,
      })
    }
    const timer = window.setTimeout(() => {
      const x = this.box.x + b.R + 6 + Math.random() * Math.max(1, this.box.w - 2 * b.R - 12)
      this.spawn(b.country, b.rank, b.value, b.display, b.share, b.R, x, this.box.y - b.R - 20)
    }, 1100)
    this.timers.push(timer)
  }

  select(b: Bubble | null): void {
    this.selected = b
    this.opts.onSelect?.(b)
  }

  getSelected(): Bubble | null {
    return this.selected
  }

  /** Let the phone's tilt steer gravity. Resolves false when the device refuses. */
  async enableTilt(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent
    if (!DOE) return false
    try {
      if (typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission()
        if (r !== 'granted') return false
      }
    } catch {
      return false
    }
    return new Promise((resolve) => {
      let got = false
      const handler = (e: DeviceOrientationEvent) => {
        if (e.beta === null || e.gamma === null) return
        got = true
        const gx = Math.sin((e.gamma * Math.PI) / 180)
        const gy = Math.sin((e.beta * Math.PI) / 180)
        const m = Math.hypot(gx, gy) || 1
        this.engine.gravity.x = (gx / m) * 0.75 * Math.min(1, m * 1.4)
        this.engine.gravity.y = (gy / m) * 0.75 * Math.min(1, m * 1.4)
      }
      this.tiltHandler = handler
      addEventListener('deviceorientation', handler)
      setTimeout(() => {
        if (!got) this.disableTilt()
        resolve(got)
      }, 900)
    })
  }

  disableTilt(): void {
    if (this.tiltHandler) removeEventListener('deviceorientation', this.tiltHandler)
    this.tiltHandler = null
    this.engine.gravity.x = 0
    this.engine.gravity.y = 0.75
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.clear()
    this.disableTilt()
    this.ro.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    Mouse.clearSourceEvents(this.mouse)
    this.canvas.remove()
  }

  // ---------- internals ----------

  /** Radii so that area follows value (with a floor) and the set fills the glass well. */
  private layoutRadii(ratios: number[]): number[] {
    const floor = 0.035
    const areas = ratios.map((r) => Math.max(floor, r))
    const glass = this.box.w * this.box.h
    const sum = areas.reduce((s, a) => s + a, 0)
    let aMax = (glass * 0.62) / sum
    const rMaxAllowed = Math.min(this.box.w * 0.36, this.box.h * 0.26)
    aMax = Math.min(aMax, Math.PI * rMaxAllowed * rMaxAllowed)
    return areas.map((a) => Math.max(11, Math.sqrt((aMax * a) / Math.PI)))
  }

  private spawn(country: Country, rank: number, value: number, display: string, share: number, R: number, x: number, y: number) {
    const n = Math.max(1, this.opts.count ?? 18)
    const t = (rank - 1) / Math.max(1, n - 1)
    // leaders are bright and saturated; the tail drifts a little around the hue and dims
    const h = (this.hue + t * 36 - 10 + 360) % 360
    const color = oklchToHex(0.78 - t * 0.22, 0.17 - t * 0.05, h)
    const light = oklchToHex(0.9 - t * 0.12, 0.1, h)
    const ink = oklchToHex(0.34 + t * 0.2, 0.085, h)
    const paper = oklchToHex(0.965 - t * 0.02, 0.018, h)
    const body = Bodies.circle(x, y, R, {
      restitution: 0.18,
      friction: 0.08,
      frictionStatic: 0.2,
      frictionAir: 0.028,
      density: 0.0016,
      slop: Math.max(0.6, R * 0.05),
      angle: Math.random() * TAU,
    })
    const bubble: Bubble = { country, rank, value, display, share, color, light, ink, paper, body, R, amp: 0.08, phase: 0, axis: Math.PI / 2, seed: Math.random() * TAU, born: this.now }
    this.bubbles.push(bubble)
    Composite.add(this.engine.world, body)
    return bubble
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    for (const b of this.bubbles) Composite.remove(this.engine.world, b.body)
    this.bubbles = []
    this.droplets = []
    this.ripples = []
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf)
    else {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private hit(e: PointerEvent): Bubble | null {
    const r = this.canvas.getBoundingClientRect()
    const p = { x: e.clientX - r.left, y: e.clientY - r.top }
    const found = Query.point(this.bubbles.map((b) => b.body), p)
    if (!found.length) return null
    return this.bubbles.find((b) => b.body === found[found.length - 1]) ?? null
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect()
    const W = Math.max(1, Math.round(r.width))
    const H = Math.max(1, Math.round(r.height))
    const dpr = Math.min(MAX_DPR, devicePixelRatio || 1)
    if (W === this.W && H === this.H && dpr === this.dpr) return
    const big = this.W > 0 && (Math.abs(W - this.W) > 80 || Math.abs(H - this.H) > 120)
    this.W = W
    this.H = H
    this.dpr = dpr
    if (dpr !== this.dpr) for (const b of this.bubbles) b.plate = undefined
    this.canvas.width = W * dpr
    this.canvas.height = H * dpr
    this.canvas.style.width = `${W}px`
    this.canvas.style.height = `${H}px`
    Mouse.setScale(this.mouse, { x: 1, y: 1 })
    const ins = this.opts.inset ?? {}
    const x0 = ins.left ?? 0
    const y0 = ins.top ?? 0
    this.box = { x: x0, y: y0, w: W - x0 - (ins.right ?? 0), h: H - y0 - (ins.bottom ?? 0) }

    for (const w of this.walls) Composite.remove(this.engine.world, w)
    const t = 400
    const opt = { isStatic: true, friction: 0.05, restitution: 0.1 }
    const floorY = this.box.y + this.box.h
    this.walls = [
      Bodies.rectangle(W / 2, floorY + t / 2, W + 2 * t, t, opt),
      Bodies.rectangle(this.box.x - t / 2, H / 2 - H, t, H * 4, opt),
      Bodies.rectangle(this.box.x + this.box.w + t / 2, H / 2 - H, t, H * 4, opt),
      Bodies.rectangle(W / 2, -H * 2 - t / 2, W + 2 * t, t, opt),
    ]
    const normals = [
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ]
    this.walls.forEach((w, i) => ((w.plugin as { n?: number[] }).n = normals[i]))
    Composite.add(this.engine.world, this.walls)
    if (big && this.theme) this.drop()
  }

  private frame = (now: number) => {
    if (!this.running) return
    const dt = Math.min(32, now - this.last)
    this.last = now
    this.now = now
    Engine.update(this.engine, dt)
    for (const b of this.bubbles) {
      if (b.amp > 0.002) {
        b.phase += dt * 0.02
        b.amp *= Math.pow(0.88, dt / 16)
      } else b.amp = 0
      if (this.mouseConstraint.body === b.body) {
        const sp = Math.hypot(b.body.velocity.x, b.body.velocity.y)
        if (sp > 1.5) {
          b.amp = Math.max(b.amp, Math.min(0.2, sp * 0.016))
          b.axis = Math.atan2(b.body.velocity.y, b.body.velocity.x)
          b.phase = Math.PI / 2 // stretched along the motion right now
        }
      }
    }
    for (const d of this.droplets) {
      d.vy += 0.08 * (dt / 16)
      d.x += d.vx * (dt / 16)
      d.y += d.vy * (dt / 16)
    }
    this.droplets = this.droplets.filter((d) => now - d.t < 900)
    this.ripples = this.ripples.filter((r) => now - r.t < 800)
    this.draw()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** Contacts per body, with the direction each one presses from. */
  private contacts(): Map<number, Contact[]> {
    const map = new Map<number, Contact[]>()
    const push = (id: number, c: Contact) => {
      const arr = map.get(id)
      if (arr) arr.push(c)
      else map.set(id, [c])
    }
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive) continue
      const a = pair.bodyA
      const b = pair.bodyB
      const depth = Math.max(0, pair.collision.depth)
      for (const [self, other] of [[a, b], [b, a]] as const) {
        if (self.isStatic) continue
        const n = (other.plugin as { n?: number[] }).n
        let phi: number
        if (n) phi = Math.atan2(n[1], n[0])
        else phi = Math.atan2(other.position.y - self.position.y, other.position.x - self.position.x)
        push(self.id, { phi, depth })
      }
    }
    return map
  }

  private draw() {
    const { ctx, W, H, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const note = this.skin === 'note'
    if (note) this.drawPaper()
    else this.drawBackdrop()
    const contacts = this.contacts()
    const floorY = this.box.y + this.box.h
    // under each bubble near the floor: a pool of colour (glass) or a hatched shadow (note)
    for (const b of this.bubbles) {
      const p = b.body.position
      const dist = floorY - (p.y + b.R)
      if (dist > b.R * 2.5) continue
      const a = Math.max(0, 1 - dist / (b.R * 2.5)) * (note ? 0.16 : 0.5)
      const g = ctx.createRadialGradient(p.x, floorY, 0, p.x, floorY, b.R * 1.3)
      g.addColorStop(0, hexA(note ? b.ink : b.color, a))
      g.addColorStop(1, hexA(note ? b.ink : b.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(p.x, floorY, b.R * 1.3, b.R * 0.35, 0, 0, TAU)
      ctx.fill()
    }
    for (const r of this.ripples) this.drawRipple(r)
    for (const b of this.bubbles) {
      const c = contacts.get(b.body.id) ?? []
      if (note) this.drawNote(b, c)
      else this.drawBubble(b, c)
    }
    for (const d of this.droplets) {
      const k = 1 - (this.now - d.t) / 900
      ctx.fillStyle = hexA(d.color, 0.9 * k)
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r * (0.6 + 0.4 * k), 0, TAU)
      ctx.fill()
    }
    if (note) this.drawPaperEdge()
    else this.drawGlassEdge()
  }

  // ---------- banknote skin ----------

  private drawPaper() {
    const { ctx, W, H, box } = this
    ctx.fillStyle = oklchToHex(0.955, 0.012, (this.hue + 40) % 360)
    ctx.fillRect(0, 0, W, H)
    // a faint guilloché band drifting across the paper, like a note's background lathe
    const ink = oklchToHex(0.45, 0.07, this.hue)
    ctx.save()
    ctx.strokeStyle = hexA(ink, 0.07)
    ctx.lineWidth = 0.7
    const cy = box.y + box.h * 0.55
    const amp = box.h * 0.16
    const drift = this.now * 0.00012
    for (let i = 0; i < 14; i++) {
      ctx.beginPath()
      for (let x = 0; x <= W; x += 6) {
        const u = x / W
        const y = cy + Math.sin(u * TAU * 2.2 + i * 0.35 + drift) * amp * (0.6 + 0.4 * Math.sin(i)) + Math.sin(u * TAU * 7 - i * 0.8) * amp * 0.12 + (i - 7) * 4
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawPaperEdge() {
    const { ctx, box } = this
    const ink = oklchToHex(0.4, 0.07, this.hue)
    const floorY = box.y + box.h
    ctx.strokeStyle = hexA(ink, 0.55)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(box.x + 8, floorY - 0.5)
    ctx.lineTo(box.x + box.w - 8, floorY - 0.5)
    ctx.stroke()
    // engraved hatching under the line
    ctx.strokeStyle = hexA(ink, 0.18)
    ctx.lineWidth = 0.6
    ctx.beginPath()
    for (let x = box.x + 8; x < box.x + box.w - 8; x += 5) {
      ctx.moveTo(x, floorY + 2)
      ctx.lineTo(x + 3, floorY + 9)
    }
    ctx.stroke()
  }

  /** The engraved medallion for a bubble, drawn once at its size and cached. */
  private plate(b: Bubble): HTMLCanvasElement {
    if (b.plate) return b.plate
    const R = b.R
    const dpr = this.dpr
    const size = Math.ceil(R * 2 + 4)
    const c = document.createElement('canvas')
    c.width = size * dpr
    c.height = size * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.translate(size / 2, size / 2)
    // paper fill, a touch darker toward the rim
    const fill = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R)
    fill.addColorStop(0, b.paper)
    fill.addColorStop(1, oklchToHex(0.93, 0.03, this.hue))
    g.fillStyle = fill
    g.beginPath()
    g.arc(0, 0, R, 0, TAU)
    g.fill()
    g.strokeStyle = b.ink
    g.lineCap = 'round'
    // rosettes: nested rose curves, the classic lathe pattern
    const layers = R >= 40 ? [[12, 0.56, 0.1, 4], [18, 0.4, 0.13, 3], [7, 0.2, 0.09, 3]] : R >= 24 ? [[10, 0.5, 0.12, 3], [6, 0.22, 0.1, 2]] : [[8, 0.4, 0.14, 2]]
    for (const [k, a, amp, count] of layers) {
      for (let m = 0; m < count; m++) {
        const phase = (m / count) * (TAU / k)
        g.globalAlpha = 0.42
        g.lineWidth = 0.55
        g.beginPath()
        const n = 260
        for (let i = 0; i <= n; i++) {
          const th = (i / n) * TAU
          const r = R * (a + amp * Math.cos(k * th + phase))
          const x = Math.cos(th) * r
          const y = Math.sin(th) * r
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
    }
    // a fine-line interference ring (two offset circles' moiré)
    if (R >= 30) {
      g.globalAlpha = 0.22
      g.lineWidth = 0.45
      for (let i = 0; i < 9; i++) {
        g.beginPath()
        g.arc(R * 0.04, R * 0.03, R * (0.62 + i * 0.03), 0, TAU)
        g.stroke()
      }
    }
    // microprint around the inner ring
    if (R >= 34) {
      const fs = Math.max(5, Math.min(7.5, R * 0.085))
      g.font = `600 ${fs}px ${this.opts.fonts?.micro ?? 'system-ui, sans-serif'}`
      g.fillStyle = b.ink
      g.globalAlpha = 0.85
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const unit = `${this.theme.title}  ·  ${this.theme.unit}  ·  `.toUpperCase()
      const rr = R * 0.79
      const step = (fs * 0.62) / rr
      let th = -Math.PI / 2
      for (let i = 0; th < TAU * 1.5 - Math.PI / 2 && i < 400; i++) {
        const ch = unit[i % unit.length]
        g.save()
        g.translate(Math.cos(th) * rr, Math.sin(th) * rr)
        g.rotate(th + Math.PI / 2)
        g.fillText(ch, 0, 0)
        g.restore()
        th += step * (ch === ' ' ? 0.7 : 1)
        if (th > TAU - Math.PI / 2) break
      }
    }
    b.plate = c
    return c
  }

  private drawNote(b: Bubble, contacts: Contact[]) {
    const { ctx } = this
    const p = b.body.position
    const dim = this.selected && this.selected !== b ? 0.35 : 1
    const age = Math.min(1, (this.now - b.born) / 500)
    const plate = this.plate(b)
    const size = plate.width / this.dpr
    const radii = this.rimRadii(b, contacts)
    ctx.save()
    ctx.globalAlpha = dim * (0.3 + 0.7 * age)
    // a soft offset shadow grounds the medallion on the paper
    ctx.save()
    ctx.translate(0, 3)
    this.rimPath(b, contacts, 1, radii)
    ctx.fillStyle = hexA(b.ink, 0.12)
    ctx.fill()
    ctx.restore()
    this.rimPath(b, contacts, 1, radii)
    ctx.save()
    ctx.clip()
    // the engraving turns with the body, so a rolling bubble reads as a rolling coin
    ctx.translate(p.x, p.y)
    ctx.rotate(b.body.angle)
    ctx.drawImage(plate, -size / 2, -size / 2, size, size)
    ctx.restore()
    // the border follows the soft outline: outer rule, reeded ticks, inner rule
    ctx.lineJoin = 'round'
    ctx.lineWidth = 1.4
    ctx.strokeStyle = hexA(b.ink, 0.95)
    ctx.stroke()
    this.rimPath(b, contacts, 0.86, radii)
    ctx.lineWidth = 0.5
    ctx.strokeStyle = hexA(b.ink, 0.85)
    ctx.stroke()
    const ticks = Math.max(24, Math.round(b.R * 1.4))
    ctx.lineWidth = 0.6
    ctx.strokeStyle = hexA(b.ink, 0.7)
    ctx.beginPath()
    for (let i = 0; i < ticks; i++) {
      const th = (i / ticks) * TAU + b.body.angle
      const k = (((th % TAU) + TAU) % TAU) / TAU * RIM_POINTS
      const i0 = Math.floor(k) % RIM_POINTS
      const r = radii[i0] + (radii[(i0 + 1) % RIM_POINTS] - radii[i0]) * (k - Math.floor(k))
      const r0 = r * (i % 2 ? 0.88 : 0.9)
      ctx.moveTo(p.x + Math.cos(th) * r0, p.y + Math.sin(th) * r0)
      ctx.lineTo(p.x + Math.cos(th) * r * 0.965, p.y + Math.sin(th) * r * 0.965)
    }
    ctx.stroke()
    ctx.restore()
    if (b === this.selected) {
      ctx.save()
      this.rimPath(b, contacts)
      ctx.lineWidth = 3
      ctx.strokeStyle = b.ink
      ctx.stroke()
      ctx.restore()
    }
    this.drawLabel(b, dim)
  }

  private drawBackdrop() {
    const { ctx, W, H, now } = this
    ctx.fillStyle = '#07070c'
    ctx.fillRect(0, 0, W, H)
    // four slow lava blobs in the theme's hue family
    ctx.globalCompositeOperation = 'lighter'
    const S = Math.max(W, H)
    for (const blob of this.bg) {
      const x = (blob.x + Math.sin(now * blob.dx * 50 + blob.r) * 0.08) * W
      const y = (blob.y + Math.cos(now * blob.dy * 50 + blob.r) * 0.08) * H
      const r = blob.r * S * 0.7
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, hexA(oklchToHex(0.42, 0.14, blob.h), 0.32))
      g.addColorStop(0.5, hexA(oklchToHex(0.35, 0.12, blob.h), 0.12))
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    ctx.globalCompositeOperation = 'source-over'
    // the glass: a barely-there pane, lit from the top-left
    const { box } = this
    // the pane fades in from the top, so no hard edge cuts under the masthead
    const sheen = ctx.createLinearGradient(0, box.y - 60, 0, box.y + box.h)
    sheen.addColorStop(0, 'rgba(255,255,255,0)')
    sheen.addColorStop(0.35, 'rgba(255,255,255,0.03)')
    sheen.addColorStop(1, 'rgba(255,255,255,0.06)')
    ctx.fillStyle = sheen
    ctx.fillRect(box.x, box.y - 60, box.w, box.h + 60)
  }

  private drawGlassEdge() {
    const { ctx, box } = this
    const floorY = box.y + box.h
    const fl = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0)
    fl.addColorStop(0, 'rgba(255,255,255,0.05)')
    fl.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    fl.addColorStop(1, 'rgba(255,255,255,0.05)')
    ctx.fillStyle = fl
    ctx.fillRect(box.x, floorY - 1, box.w, 1)
    const under = ctx.createLinearGradient(0, floorY, 0, floorY + 40)
    under.addColorStop(0, 'rgba(255,255,255,0.08)')
    under.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = under
    ctx.fillRect(box.x, floorY, box.w, 40)
  }

  private drawRipple(r: Ripple) {
    const { ctx } = this
    const k = (this.now - r.t) / 800
    const rad = r.r * (0.6 + k * 2.2)
    const ink = this.skin === 'note' ? '40,48,44' : '255,255,255'
    ctx.strokeStyle = `rgba(${ink},${0.5 * (1 - k)})`
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.ellipse(r.x, r.y, rad, rad * 0.22, 0, 0, TAU)
    ctx.stroke()
    ctx.strokeStyle = `rgba(${ink},${0.25 * (1 - k)})`
    ctx.beginPath()
    ctx.ellipse(r.x, r.y, rad * 0.6, rad * 0.14, 0, 0, TAU)
    ctx.stroke()
  }

  /** Rim radius at angle θ: a circle flattened by contacts, squashed by impacts, breathing a little. */
  private rimRadius(b: Bubble, theta: number, contacts: Contact[]): number {
    let r = b.R
    const s = b.amp * Math.sin(b.phase)
    r *= 1 + s * Math.cos(2 * (theta - b.axis))
    r *= 1 + 0.012 * Math.sin(3 * theta + this.now * 0.0014 + b.seed) + 0.008 * Math.sin(5 * theta - this.now * 0.0009 + b.seed)
    for (const c of contacts) {
      const d = angleDiff(theta, c.phi)
      const flat = Math.min(b.R * 0.3, c.depth * 0.9 + b.R * 0.06)
      const cos = Math.cos(d)
      if (cos > 0) r = Math.min(r, (b.R - flat) / cos)
      r += flat * 0.25 * Math.sin(d) * Math.sin(d) * (Math.abs(d) < Math.PI / 2 ? 1 : 0.4)
    }
    return r
  }

  /** Smoothed rim radius per sample angle. */
  private rimRadii(b: Bubble, contacts: Contact[]): number[] {
    const radii: number[] = []
    for (let i = 0; i < RIM_POINTS; i++) radii.push(this.rimRadius(b, (i / RIM_POINTS) * TAU, contacts))
    // soften the chord corners: two passes of a 3-tap blur around the ring
    for (let pass = 0; pass < 2; pass++) {
      const prev = radii.slice()
      for (let i = 0; i < RIM_POINTS; i++) {
        radii[i] = 0.25 * prev[(i + RIM_POINTS - 1) % RIM_POINTS] + 0.5 * prev[i] + 0.25 * prev[(i + 1) % RIM_POINTS]
      }
    }
    return radii
  }

  private rimPath(b: Bubble, contacts: Contact[], scale = 1, radii = this.rimRadii(b, contacts)) {
    const { ctx } = this
    const p = b.body.position
    const pts: [number, number][] = radii.map((r, i) => {
      const th = (i / RIM_POINTS) * TAU
      return [p.x + Math.cos(th) * r * scale, p.y + Math.sin(th) * r * scale]
    })
    ctx.beginPath()
    const n = pts.length
    let [mx, my] = mid(pts[n - 1], pts[0])
    ctx.moveTo(mx, my)
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i]
      ;[mx, my] = mid(pts[i], pts[(i + 1) % n])
      ctx.quadraticCurveTo(x, y, mx, my)
    }
    ctx.closePath()
  }

  private drawBubble(b: Bubble, contacts: Contact[]) {
    const { ctx } = this
    const p = b.body.position
    const R = b.R
    const dim = this.selected && this.selected !== b ? 0.45 : 1
    const age = Math.min(1, (this.now - b.born) / 500)
    ctx.save()
    ctx.globalAlpha = dim * (0.4 + 0.6 * age)
    this.rimPath(b, contacts)
    // film: clear in the middle, colour gathering toward the rim
    const film = ctx.createRadialGradient(p.x, p.y, R * 0.1, p.x, p.y, R)
    film.addColorStop(0, hexA(b.color, 0.1))
    film.addColorStop(0.72, hexA(b.color, 0.22))
    film.addColorStop(0.93, hexA(b.light, 0.55))
    film.addColorStop(1, hexA(b.light, 0.75))
    ctx.fillStyle = film
    ctx.fill()
    // iridescent rim: a slowly turning conic sweep of neighbouring hues
    const spin = this.now * 0.0004 + b.seed
    let rim: CanvasGradient | string
    if (typeof ctx.createConicGradient === 'function') {
      const cg = ctx.createConicGradient(spin, p.x, p.y)
      const hues = [0, 40, -35, 70, 0]
      hues.forEach((dh, i) => cg.addColorStop(i / (hues.length - 1), hexA(oklchToHex(0.85, 0.12, (this.hue + dh + 360) % 360), 0.85)))
      rim = cg
    } else rim = hexA(b.light, 0.8)
    ctx.lineWidth = Math.max(1.2, R * 0.045)
    ctx.strokeStyle = rim
    ctx.stroke()
    ctx.lineWidth = 0.8
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.stroke()
    // highlights: a wide soft one top-left, a crisp arc, a dim reflection bottom-right
    ctx.clip()
    const hl = ctx.createRadialGradient(p.x - R * 0.38, p.y - R * 0.42, 0, p.x - R * 0.38, p.y - R * 0.42, R * 0.7)
    hl.addColorStop(0, 'rgba(255,255,255,0.42)')
    hl.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hl
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(1.5, R * 0.06)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(p.x, p.y, R * 0.8, Math.PI * 1.12, Math.PI * 1.42)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = Math.max(1, R * 0.035)
    ctx.beginPath()
    ctx.arc(p.x, p.y, R * 0.82, Math.PI * 0.15, Math.PI * 0.4)
    ctx.stroke()
    ctx.restore()

    if (b === this.selected) {
      ctx.save()
      this.rimPath(b, contacts)
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.restore()
    }
    this.drawLabel(b, dim)
  }

  private drawLabel(b: Bubble, dim: number) {
    const { ctx } = this
    const p = b.body.position
    const R = b.R
    const note = this.skin === 'note'
    const f = this.opts.fonts
    const fonts = note
      ? { value: f?.noteValue ?? 'Georgia, serif', name: f?.noteName ?? 'Georgia, serif' }
      : { value: f?.value ?? 'system-ui, sans-serif', name: f?.name ?? 'system-ui, sans-serif' }
    const labelled = b.rank <= (this.theme.top ?? 10)
    ctx.save()
    ctx.globalAlpha = dim
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (note) {
      // a clear paper disc under the numeral, as the lathe stops around a note's figure
      const disc = R >= 34 && labelled ? R * 0.5 : R * 0.42
      ctx.fillStyle = hexA(b.paper, 0.92)
      ctx.beginPath()
      ctx.arc(p.x, p.y, disc, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = hexA(b.ink, 0.5)
      ctx.lineWidth = 0.6
      ctx.stroke()
      ctx.fillStyle = b.ink
    } else {
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 6
    }
    if (R >= 34 && labelled) {
      const vs = Math.max(13, Math.min(34, R * (note ? 0.36 : 0.42)))
      ctx.font = `700 ${vs}px ${fonts.value}`
      ctx.fillText(b.display, p.x, p.y + vs * 0.08)
      const ns = Math.max(note ? 8 : 11, Math.min(18, R * (note ? 0.15 : 0.2)))
      ctx.font = note ? `600 ${ns}px ${f?.micro ?? 'system-ui, sans-serif'}` : `italic 400 ${ns}px ${fonts.name}`
      ctx.globalAlpha = dim * 0.9
      if (note) ctx.letterSpacing = '0.12em'
      const label = note ? b.country.name.toUpperCase() : b.country.name
      const name = ctx.measureText(label).width <= R * (note ? 0.95 : 1.7) ? label : b.country.id
      ctx.fillText(name, p.x, p.y - vs * 0.72)
    } else if (R >= 20) {
      ctx.font = `700 ${Math.max(10, R * (note ? 0.36 : 0.42))}px ${fonts.value}`
      ctx.fillText(b.country.id, p.x, p.y + 1)
    }
    ctx.restore()
  }
}

function mid(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return d
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`
}

export { Matter }
