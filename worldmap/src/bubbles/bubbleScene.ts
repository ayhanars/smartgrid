import Matter, { Bodies, Body, Composite, Engine, Events, Query } from 'matter-js'
import { hueAngle, oklchToHex } from '../lib/color'
import { makeFormatter } from '../lib/format'
import type { Country, NumericTheme } from '../lib/types'
import { GEO } from '../lib/worldmap'
import { drawMotif, motifCount, type Motif } from './motifs'

/** How the scene is drawn. Physics and interactions are the same for every skin. */
export type Skin = 'glass' | 'note'

export interface BubbleOptions {
  theme: NumericTheme
  /** 'glass': iridescent soap film on deep ink. 'note': soft ink-drawn bubbles on engraved paper. */
  skin?: Skin
  /** How many countries become bubbles (default 18). The theme's `top` are labelled. */
  count?: number
  /** Space (px) between the canvas edge and the glass: room for the page's chrome. */
  inset?: { top?: number; right?: number; bottom?: number; left?: number }
  onSelect?: (b: Bubble | null) => void
  /** A bubble touched the floor at speed. */
  onLand?: (b: Bubble, speed: number) => void
  onGrab?: (b: Bubble) => void
  onRelease?: (b: Bubble, speed: number) => void
  onPop?: (b: Bubble) => void
  onDrop?: () => void
  /** Font stacks for the labels. Glass: `value`, `name`. Note: `noteValue`, `micro`. */
  fonts?: { value?: string; name?: string; noteValue?: string; micro?: string }
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

interface Drag {
  b: Bubble
  pid: number
  /** grab offset from the body centre */
  dx: number
  dy: number
  /** pointer target in canvas px */
  tx: number
  ty: number
  startX: number
  startY: number
  t0: number
  moved: boolean
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
  private drag: Drag | null = null
  private lastTap = { t: 0, b: null as Bubble | null }
  private hue = 255
  private running = true
  private skin: Skin = 'glass'
  private tiltHandler: ((e: DeviceOrientationEvent) => void) | null = null
  private bg: { x: number; y: number; r: number; dx: number; dy: number; h: number }[] = []
  private paperPlate: HTMLCanvasElement | null = null
  private motifPlate: HTMLCanvasElement | null = null
  private motifKey = ''
  private needsDrop = false

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

    this.bindPointer()
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
    this.paperPlate = null
    this.motifPlate = null
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
    this.paperPlate = null
  }

  getSkin(): Skin {
    return this.skin
  }

  /** Every bubble goes back above the glass and falls in again, biggest first. */
  drop(): void {
    this.clear()
    this.select(null)
    if (this.box.h < 120 || this.box.w < 120) {
      this.needsDrop = true // the container has no real size yet; resize() will call back
      return
    }
    this.needsDrop = false
    this.opts.onDrop?.()
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
      const timer = window.setTimeout(() => {
        const x = this.box.x + R + 6 + Math.random() * Math.max(1, this.box.w - 2 * R - 12)
        const y = this.box.y - R - 10 - Math.random() * 80
        this.spawn(country, i + 1, value, format(value), value / vmax, R, x, y)
      }, 90 * i + 80)
      this.timers.push(timer)
    })
  }

  /** Burst a bubble into droplets; it re-forms above the glass a moment later. */
  pop(b: Bubble): void {
    const i = this.bubbles.indexOf(b)
    if (i < 0) return
    this.bubbles.splice(i, 1)
    Composite.remove(this.engine.world, b.body)
    if (this.drag?.b === b) this.drag = null
    if (this.selected === b) this.select(null)
    this.opts.onPop?.(b)
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
    this.canvas.remove()
  }

  // ---------- pointer: grab, carry, throw, tap, double-tap ----------

  private bindPointer() {
    const c = this.canvas
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const b = this.hit(e)
      const [x, y] = this.local(e)
      if (b) {
        c.setPointerCapture(e.pointerId)
        this.drag = { b, pid: e.pointerId, dx: x - b.body.position.x, dy: y - b.body.position.y, tx: x, ty: y, startX: x, startY: y, t0: performance.now(), moved: false }
        b.amp = Math.max(b.amp, 0.1)
        b.phase = 0
        b.axis = Math.PI / 2
        this.opts.onGrab?.(b)
      }
    })
    c.addEventListener('pointermove', (e) => {
      const d = this.drag
      if (!d || d.pid !== e.pointerId) return
      const [x, y] = this.local(e)
      d.tx = x
      d.ty = y
      if (Math.hypot(x - d.startX, y - d.startY) > 8) d.moved = true
    })
    const end = (e: PointerEvent) => {
      const d = this.drag
      if (!d || d.pid !== e.pointerId) return
      this.drag = null
      const b = d.b
      const sp = Math.hypot(b.body.velocity.x, b.body.velocity.y)
      if (!d.moved && performance.now() - d.t0 < 450 && e.type === 'pointerup') {
        const now = performance.now()
        if (this.lastTap.b === b && now - this.lastTap.t < 340) {
          this.lastTap = { t: 0, b: null }
          this.pop(b)
          return
        }
        this.lastTap = { t: now, b }
        this.select(b !== this.selected ? b : null)
      } else {
        this.opts.onRelease?.(b, sp)
      }
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('lostpointercapture', (e) => {
      if (this.drag?.pid === e.pointerId) this.drag = null
    })
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  private hit(e: PointerEvent): Bubble | null {
    const [x, y] = this.local(e)
    const found = Query.point(this.bubbles.map((b) => b.body), { x, y })
    if (found.length) return this.bubbles.find((b) => b.body === found[found.length - 1]) ?? null
    // a finger is wide: accept a near miss on small bubbles
    let best: Bubble | null = null
    let bestD = 14
    for (const b of this.bubbles) {
      const d = Math.hypot(b.body.position.x - x, b.body.position.y - y) - b.R
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
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
    const h = (this.hue + t * 36 - 10 + 360) % 360
    const color = oklchToHex(0.78 - t * 0.22, 0.17 - t * 0.05, h)
    const light = oklchToHex(0.9 - t * 0.12, 0.1, h)
    const ink = oklchToHex(0.3 + t * 0.22, 0.09, h)
    const paper = oklchToHex(0.975 - t * 0.025, 0.02, h)
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
    this.drag = null
  }

  private onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(this.raf)
    else {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect()
    const W = Math.max(1, Math.round(r.width))
    const H = Math.max(1, Math.round(r.height))
    const dpr = Math.min(MAX_DPR, devicePixelRatio || 1)
    if (W === this.W && H === this.H && dpr === this.dpr) return
    const widthChanged = this.W > 0 && Math.abs(W - this.W) > 80
    this.W = W
    this.H = H
    this.dpr = dpr
    this.paperPlate = null
    this.canvas.width = W * dpr
    this.canvas.height = H * dpr
    this.canvas.style.width = `${W}px`
    this.canvas.style.height = `${H}px`
    const ins = this.opts.inset ?? {}
    const x0 = ins.left ?? 0
    const y0 = ins.top ?? 0
    this.box = { x: x0, y: y0, w: W - x0 - (ins.right ?? 0), h: H - y0 - (ins.bottom ?? 0) }
    this.buildWalls()
    // a height change (a browser bar sliding away) only moves the floor: the pile
    // settles onto it. Only a real width change re-lays the bubbles out.
    if (this.theme && (this.needsDrop || widthChanged)) this.drop()
    else {
      const floorY = this.box.y + this.box.h
      for (const b of this.bubbles) {
        if (b.body.position.y + b.R > floorY) Body.setPosition(b.body, { x: b.body.position.x, y: floorY - b.R })
      }
    }
  }

  private buildWalls() {
    const { W, H, box } = this
    for (const w of this.walls) Composite.remove(this.engine.world, w)
    const t = 400
    const opt = { isStatic: true, friction: 0.05, restitution: 0.1 }
    const floorY = box.y + box.h
    this.walls = [
      Bodies.rectangle(W / 2, floorY + t / 2, W + 2 * t, t, opt),
      Bodies.rectangle(box.x - t / 2, H / 2 - H, t, H * 4, opt),
      Bodies.rectangle(box.x + box.w + t / 2, H / 2 - H, t, H * 4, opt),
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
  }

  private frame = (now: number) => {
    if (!this.running) return
    const dt = Math.min(32, now - this.last)
    this.last = now
    this.now = now
    // carry the dragged bubble: its velocity steers toward the finger, so a release throws it
    const d = this.drag
    if (d) {
      const b = d.b.body
      const k = 0.32
      const vx = (d.tx - d.dx - b.position.x) * k
      const vy = (d.ty - d.dy - b.position.y) * k
      const max = 38
      const m = Math.hypot(vx, vy)
      const s = m > max ? max / m : 1
      Body.setVelocity(b, { x: vx * s, y: vy * s })
      Body.setAngularVelocity(b, b.angularVelocity * 0.9)
    }
    Engine.update(this.engine, dt)
    for (const b of this.bubbles) {
      if (b.amp > 0.002) {
        b.phase += dt * 0.02
        b.amp *= Math.pow(0.88, dt / 16)
      } else b.amp = 0
      if (d?.b === b) {
        const sp = Math.hypot(b.body.velocity.x, b.body.velocity.y)
        if (sp > 1.5) {
          b.amp = Math.max(b.amp, Math.min(0.2, sp * 0.016))
          b.axis = Math.atan2(b.body.velocity.y, b.body.velocity.x)
          b.phase = Math.PI / 2
        }
      }
    }
    for (const dr of this.droplets) {
      dr.vy += 0.08 * (dt / 16)
      dr.x += dr.vx * (dt / 16)
      dr.y += dr.vy * (dt / 16)
    }
    this.droplets = this.droplets.filter((x) => now - x.t < 900)
    this.ripples = this.ripples.filter((x) => now - x.t < 800)
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
        const phi = n ? Math.atan2(n[1], n[0]) : Math.atan2(other.position.y - self.position.y, other.position.x - self.position.x)
        push(self.id, { phi, depth })
      }
    }
    return map
  }

  // ---------- drawing ----------

  private draw() {
    const { ctx, W, H, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const note = this.skin === 'note'
    if (note) ctx.drawImage(this.paper(), 0, 0, W, H)
    else this.drawBackdrop()
    const contacts = this.contacts()
    const floorY = this.box.y + this.box.h
    for (const b of this.bubbles) {
      const p = b.body.position
      const dist = floorY - (p.y + b.R)
      if (dist > b.R * 2.5) continue
      const a = Math.max(0, 1 - dist / (b.R * 2.5)) * (note ? 0.14 : 0.5)
      const col = note ? b.ink : b.color
      const g = ctx.createRadialGradient(p.x, floorY, 0, p.x, floorY, b.R * 1.3)
      g.addColorStop(0, hexA(col, a))
      g.addColorStop(1, hexA(col, 0))
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
    for (const dr of this.droplets) {
      const k = 1 - (this.now - dr.t) / 900
      ctx.fillStyle = hexA(dr.color, 0.9 * k)
      ctx.beginPath()
      ctx.arc(dr.x, dr.y, dr.r * (0.6 + 0.4 * k), 0, TAU)
      ctx.fill()
    }
    if (!note) this.drawGlassEdge()
  }

  // ----- glass skin -----

  private drawBackdrop() {
    const { ctx, W, H, now } = this
    ctx.fillStyle = '#07070c'
    ctx.fillRect(0, 0, W, H)
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
    const wall = this.wallpaper('#ffffff')
    if (wall) {
      ctx.globalAlpha = 0.075
      ctx.drawImage(wall, 0, 0, W, H)
      ctx.globalAlpha = 1
    }
    const { box } = this
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

  private drawBubble(b: Bubble, contacts: Contact[]) {
    const { ctx } = this
    const p = b.body.position
    const R = b.R
    const dim = this.selected && this.selected !== b ? 0.45 : 1
    const age = Math.min(1, (this.now - b.born) / 500)
    ctx.save()
    ctx.globalAlpha = dim * (0.4 + 0.6 * age)
    this.rimPath(b, contacts)
    const film = ctx.createRadialGradient(p.x, p.y, R * 0.1, p.x, p.y, R)
    film.addColorStop(0, hexA(b.color, 0.1))
    film.addColorStop(0.72, hexA(b.color, 0.22))
    film.addColorStop(0.93, hexA(b.light, 0.55))
    film.addColorStop(1, hexA(b.light, 0.75))
    ctx.fillStyle = film
    ctx.fill()
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

  // ----- note skin: engraved paper, simple ink bubbles -----

  /** The paper with its lathe work, drawn once per size and theme. */
  private paper(): HTMLCanvasElement {
    if (this.paperPlate) return this.paperPlate
    const { W, H, dpr, box } = this
    const c = document.createElement('canvas')
    c.width = W * dpr
    c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    const hue = this.hue
    const ink = oklchToHex(0.42, 0.075, hue)
    g.fillStyle = oklchToHex(0.957, 0.014, (hue + 40) % 360)
    g.fillRect(0, 0, W, H)
    // a warm tint toward the bottom, like a note's two-tone ground
    const tint = g.createLinearGradient(0, 0, 0, H)
    tint.addColorStop(0, hexA(oklchToHex(0.9, 0.04, hue), 0))
    tint.addColorStop(1, hexA(oklchToHex(0.9, 0.04, hue), 0.35))
    g.fillStyle = tint
    g.fillRect(0, 0, W, H)

    const floorY = box.y + box.h
    const pattern = this.theme.decor?.pattern ?? 'waves'
    g.strokeStyle = ink
    g.lineWidth = 0.6
    g.lineCap = 'round'
    if (pattern === 'waves') {
      // two families of long wavy lines, interleaved: the classic wavy-line field
      g.globalAlpha = 0.09
      for (let fam = 0; fam < 2; fam++) {
        for (let i = 0; i < 46; i++) {
          g.beginPath()
          for (let x = -10; x <= W + 10; x += 5) {
            const u = x / W
            const base = (i / 45) * (H + 80) - 40
            const y = base + Math.sin(u * TAU * (2.4 + fam * 0.6) + i * 0.22 + fam * 1.7) * 14 + Math.sin(u * TAU * 9 + i * 0.5) * 3
            if (x === -10) g.moveTo(x, y)
            else g.lineTo(x, y)
          }
          g.stroke()
        }
      }
    } else if (pattern === 'lattice') {
      // crossing diagonal sine bands make a woven net
      g.globalAlpha = 0.08
      const S = Math.max(W, H)
      for (const ang of [0.6, -0.6]) {
        g.save()
        g.translate(W / 2, H / 2)
        g.rotate(ang)
        for (let i = 0; i < 70; i++) {
          g.beginPath()
          const base = (i / 69) * S * 1.6 - S * 0.8
          for (let x = -S; x <= S; x += 6) {
            const y = base + Math.sin((x / S) * TAU * 5 + i * 0.3) * 6
            if (x === -S) g.moveTo(x, y)
            else g.lineTo(x, y)
          }
          g.stroke()
        }
        g.restore()
      }
    } else {
      // rays from the floor's centre and faint arcs across them
      g.globalAlpha = 0.07
      const cx = W / 2
      for (let i = 0; i < 180; i++) {
        const a = Math.PI + (i / 179) * Math.PI
        g.beginPath()
        g.moveTo(cx, floorY)
        g.lineTo(cx + Math.cos(a) * Math.max(W, H) * 1.3, floorY + Math.sin(a) * Math.max(W, H) * 1.3)
        g.stroke()
      }
      for (let r = 40; r < Math.max(W, H) * 1.3; r += 28) {
        g.beginPath()
        g.arc(cx, floorY, r, Math.PI, TAU)
        g.stroke()
      }
    }

    // the subject, engraved and tiled like a note's vignette wallpaper
    const wall = this.wallpaper(ink)
    if (wall) {
      g.globalAlpha = 0.2
      g.drawImage(wall, 0, 0, W, H)
    }

    // frame: a double rule with small corner rosettes
    g.globalAlpha = 0.45
    g.lineWidth = 1
    g.strokeRect(10.5, 10.5, W - 21, H - 21)
    g.lineWidth = 0.5
    g.strokeRect(14.5, 14.5, W - 29, H - 29)
    for (const [x, y] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) {
      g.beginPath()
      for (let i = 0; i <= 120; i++) {
        const th = (i / 120) * TAU
        const r = 6 + 2.5 * Math.cos(8 * th)
        const px = x + Math.cos(th) * r
        const py = y + Math.sin(th) * r
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.stroke()
    }

    // the floor: a rule and engraved hatching under it
    g.globalAlpha = 0.6
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(box.x + 18, floorY - 0.5)
    g.lineTo(box.x + box.w - 18, floorY - 0.5)
    g.stroke()
    g.globalAlpha = 0.22
    g.lineWidth = 0.6
    g.beginPath()
    for (let x = box.x + 18; x < box.x + box.w - 18; x += 5) {
      g.moveTo(x, floorY + 2)
      g.lineTo(x + 3, floorY + 9)
    }
    g.stroke()
    this.paperPlate = c
    return c
  }

  /** The theme's motif tiled across the canvas in staggered rows, cached per size and ink. */
  private wallpaper(ink: string): HTMLCanvasElement | null {
    const motif = this.theme.decor?.motif as Motif | undefined
    if (!motif) return null
    const key = `${motif}|${ink}|${this.W}x${this.H}|${this.dpr}`
    if (this.motifPlate && this.motifKey === key) return this.motifPlate
    const { W, H, dpr } = this
    const c = document.createElement('canvas')
    c.width = W * dpr
    c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.strokeStyle = ink
    g.fillStyle = ink
    const cell = Math.max(84, Math.min(136, W / 4.2))
    const n = motifCount(motif)
    let j = 0
    for (let y = -cell * 0.3; y < H + cell; y += cell * 0.98, j++) {
      const shift = (j % 2) * (cell / 2)
      let i = 0
      for (let x = -cell * 0.4 + shift; x < W + cell; x += cell, i++) {
        const idx = (i + j * 2) % n
        const angle = (((i * 7 + j * 13) % 7) - 3) * 0.07
        const size = cell * (0.58 + ((i * 3 + j) % 3) * 0.04)
        drawMotif(g, motif, idx, x, y, size, angle)
      }
    }
    this.motifPlate = c
    this.motifKey = key
    return c
  }

  private drawNote(b: Bubble, contacts: Contact[]) {
    const { ctx } = this
    const p = b.body.position
    const R = b.R
    const dim = this.selected && this.selected !== b ? 0.4 : 1
    const age = Math.min(1, (this.now - b.born) / 500)
    const radii = this.rimRadii(b, contacts)
    ctx.save()
    ctx.globalAlpha = dim * (0.3 + 0.7 * age)
    // offset shadow in ink, then a translucent paper fill so the lathe shows through faintly
    ctx.save()
    ctx.translate(2, 3)
    this.rimPath(b, contacts, 1, radii)
    ctx.fillStyle = hexA(b.ink, 0.1)
    ctx.fill()
    ctx.restore()
    this.rimPath(b, contacts, 1, radii)
    ctx.fillStyle = hexA(b.paper, 0.78)
    ctx.fill()
    ctx.save()
    ctx.clip()
    // engraved shading: parallel hatching that fades out toward the light (top-left)
    const light = { x: p.x - R * 0.45, y: p.y - R * 0.5 }
    const shade = ctx.createRadialGradient(light.x, light.y, R * 0.25, light.x, light.y, R * 1.9)
    shade.addColorStop(0, hexA(b.ink, 0))
    shade.addColorStop(0.45, hexA(b.ink, 0.1))
    shade.addColorStop(1, hexA(b.ink, 0.5))
    ctx.strokeStyle = shade
    ctx.lineWidth = 0.6
    const gap = Math.max(3, Math.min(5, R * 0.08))
    ctx.beginPath()
    for (let d = -R * 2; d <= R * 2; d += gap) {
      ctx.moveTo(p.x + d - R * 1.5, p.y - R * 1.5)
      ctx.lineTo(p.x + d + R * 1.5, p.y + R * 1.5)
    }
    ctx.stroke()
    if (R >= 26) {
      // a second, finer set crossing the first near the rim, as an engraver would
      const cross = ctx.createRadialGradient(p.x, p.y, R * 0.55, p.x, p.y, R)
      cross.addColorStop(0, hexA(b.ink, 0))
      cross.addColorStop(1, hexA(b.ink, 0.32))
      ctx.strokeStyle = cross
      ctx.lineWidth = 0.5
      ctx.beginPath()
      for (let d = -R * 2; d <= R * 2; d += gap * 1.3) {
        ctx.moveTo(p.x + d + R * 1.5, p.y - R * 1.5)
        ctx.lineTo(p.x + d - R * 1.5, p.y + R * 1.5)
      }
      ctx.stroke()
    }
    ctx.restore()
    // outline: an ink rule and a thin inner rule that follow the soft shape
    ctx.lineJoin = 'round'
    this.rimPath(b, contacts, 1, radii)
    ctx.lineWidth = 1.3
    ctx.strokeStyle = hexA(b.ink, 0.95)
    ctx.stroke()
    this.rimPath(b, contacts, 0.9, radii)
    ctx.lineWidth = 0.5
    ctx.strokeStyle = hexA(b.ink, 0.55)
    ctx.stroke()
    // a crescent of clean paper where the light hits
    ctx.strokeStyle = hexA('#ffffff', 0.85)
    ctx.lineWidth = Math.max(1.2, R * 0.05)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(p.x, p.y, R * 0.8, Math.PI * 1.1, Math.PI * 1.4)
    ctx.stroke()
    ctx.restore()
    if (b === this.selected) {
      ctx.save()
      this.rimPath(b, contacts, 1, radii)
      ctx.lineWidth = 3
      ctx.strokeStyle = b.ink
      ctx.stroke()
      ctx.restore()
    }
    this.drawLabel(b, dim)
  }

  // ----- shared -----

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

  private rimRadii(b: Bubble, contacts: Contact[]): number[] {
    const radii: number[] = []
    for (let i = 0; i < RIM_POINTS; i++) radii.push(this.rimRadius(b, (i / RIM_POINTS) * TAU, contacts))
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

  private drawLabel(b: Bubble, dim: number) {
    const { ctx } = this
    const p = b.body.position
    const R = b.R
    const note = this.skin === 'note'
    const f = this.opts.fonts
    const valueFont = note ? (f?.noteValue ?? 'Georgia, serif') : (f?.value ?? 'system-ui, sans-serif')
    const labelled = b.rank <= (this.theme.top ?? 10)
    ctx.save()
    ctx.globalAlpha = dim
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (note) ctx.fillStyle = b.ink
    else {
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 6
    }
    if (R >= 34 && labelled) {
      const vs = Math.max(13, Math.min(34, R * (note ? 0.38 : 0.42)))
      ctx.font = `700 ${vs}px ${valueFont}`
      ctx.fillText(b.display, p.x, p.y + vs * 0.08)
      const ns = Math.max(note ? 8 : 11, Math.min(18, R * (note ? 0.15 : 0.2)))
      ctx.font = note ? `600 ${ns}px ${f?.micro ?? 'system-ui, sans-serif'}` : `italic 400 ${ns}px ${f?.name ?? 'Georgia, serif'}`
      ctx.globalAlpha = dim * 0.9
      if (note) ctx.letterSpacing = '0.14em'
      const label = note ? b.country.name.toUpperCase() : b.country.name
      const name = ctx.measureText(label).width <= R * (note ? 1.4 : 1.7) ? label : b.country.id
      ctx.fillText(name, p.x, p.y - vs * 0.72)
    } else if (R >= 20) {
      ctx.font = `700 ${Math.max(10, R * (note ? 0.36 : 0.42))}px ${valueFont}`
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
