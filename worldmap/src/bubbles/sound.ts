/**
 * Sounds for the bubble scene, synthesised from a physical model rather than
 * from oscillators with envelopes: a water bubble rings as a damped sine whose
 * pitch rises slightly as it shrinks (van den Doel, "Physically based models
 * for liquid sounds", 2005). A pop is a small cloud of such bubbles, a landing
 * is a low one with a soft skin, and everything is randomised in pitch, decay,
 * level and timing, placed in stereo by position, softened by a low-pass and
 * given a short dark room, so no two events sound alike and nothing sounds
 * like a machine.
 *
 * The context is created on the first user gesture (browsers refuse autoplay
 * before that).
 */
export class Sounds {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private send: GainNode | null = null
  private white: AudioBuffer | null = null
  private pink: AudioBuffer | null = null
  private lastLand = -1
  private landCount = 0
  muted = false

  /** Call from a pointerdown/click handler once; a no-op afterwards. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined)
      return
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    try {
      const ctx = new AC()
      this.ctx = ctx
      // master: soften the top end, then a soft clipper so stacked events never crack
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 5200
      lp.Q.value = 0.5
      const clip = ctx.createWaveShaper()
      const n = 1024
      const curve = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1
        curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3)
      }
      clip.curve = curve
      clip.oversample = '2x'
      const master = ctx.createGain()
      master.gain.value = 0.85
      master.connect(lp).connect(clip).connect(ctx.destination)
      this.master = master
      // room: a short, dark reverb from a decaying noise impulse
      const room = ctx.createConvolver()
      room.buffer = this.impulse(ctx, 0.5, 2.8)
      const send = ctx.createGain()
      send.gain.value = 0.22
      send.connect(room).connect(master)
      this.send = send
      this.white = this.noiseBuffer(ctx, 1.0, false)
      this.pink = this.noiseBuffer(ctx, 1.5, true)
    } catch {
      this.ctx = null
    }
  }

  private get ac(): AudioContext | null {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return null
    return this.ctx
  }

  /**
   * A bubble bursting. `pan` is -1..1 across the screen. The film gives one soft
   * tick, then a handful of small water bubbles ring out in quick succession,
   * lower and fewer for a big bubble, higher and busier for a small one.
   */
  pop(radius: number, pan = 0): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    const size = Math.min(1, radius / 120)
    // the film: a soft, dark tick (no bright static)
    this.tick(t, 0.12, 900 - size * 400, pan)
    // the cloud: bubbles of random size; the first is the main one
    const count = 3 + Math.round((1 - size) * 3)
    for (let i = 0; i < count; i++) {
      const main = i === 0
      const f0 = (main ? 650 - size * 320 : 950 - size * 300) * rnd(0.8, 1.3)
      const when = t + (main ? 0.004 : 0.02 + Math.random() * 0.09)
      const level = (main ? 0.55 : 0.16) * rnd(0.75, 1.15)
      this.waterBubble(when, f0, level, pan + rnd(-0.15, 0.15), 1, 0.003, main ? 0.26 : 0.16)
    }
  }

  /** Landing on the floor: a low bubble with a soft skin; quieter and darker than a pop. */
  land(radius: number, speed: number, pan = 0): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    // a settling pile fires many contacts: thin them out and get quieter each time
    if (t - this.lastLand < 0.05) return
    this.landCount = t - this.lastLand > 0.6 ? 0 : this.landCount + 1
    this.lastLand = t
    const crowd = Math.max(0.25, 1 - this.landCount * 0.12)
    const size = Math.min(1, radius / 120)
    const vol = Math.min(1, 0.1 + speed * 0.1) * crowd
    const f0 = (210 - size * 110) * rnd(0.85, 1.15)
    this.waterBubble(t, f0, 0.6 * vol, pan, 1.6, 0.012, 0.3)
    this.tick(t, 0.5 * vol, 240 + speed * 30, pan, 'lowpass', 0.04)
  }

  /** Picking a bubble up: the lightest touch on water. */
  grab(pan = 0): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    this.waterBubble(t, 1000 * rnd(0.8, 1.25), 0.28, pan, 0.9, 0.002, 0.09)
  }

  /** Everything dropping again: a swell of air. */
  whoosh(): void {
    const ac = this.ac
    if (!ac || !this.pink) return
    const t = ac.currentTime
    const src = ac.createBufferSource()
    src.buffer = this.pink
    src.playbackRate.value = rnd(0.85, 1.1)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.7
    bp.frequency.setValueAtTime(220, t)
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.3)
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.8)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(1.3, t + 0.25)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.82)
    src.connect(bp).connect(g)
    this.out(g, 0, 0.9)
    src.start(t, Math.random() * 0.4)
    src.stop(t + 0.9)
  }

  // ---------- the model ----------

  /**
   * One water bubble: a damped sine at f0 whose frequency rises a little as it
   * decays. Decay follows the model (higher bubbles die faster); `stretch`
   * lengthens it for the big, slow ones.
   */
  private waterBubble(t: number, f0: number, level: number, pan: number, stretch = 1, attack = 0.003, maxDur = 0.3) {
    const ac = this.ac
    if (!ac) return
    const beta = (0.043 * f0 + 0.0014 * Math.pow(f0, 1.5)) / stretch // 1/s
    const dur = Math.min(maxDur, Math.max(0.05, 6 / beta))
    const rise = 1 + rnd(0.08, 0.22) // the bubble shrinks, pitch climbs
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f0 * rise, t + dur)
    // a second, quiet partial gives the ring some body
    const o2 = ac.createOscillator()
    o2.type = 'sine'
    o2.frequency.setValueAtTime(f0 * 2.02, t)
    o2.frequency.exponentialRampToValueAtTime(f0 * 2.02 * rise, t + dur)
    const g2 = ac.createGain()
    g2.gain.value = 0.18
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + attack)
    // exponential decay e^{-beta t}, drawn as a curve so it is smooth to silence
    const n = 48
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) curve[i] = Math.max(0.0001, level * Math.exp((-beta * i * dur) / (n - 1)))
    g.gain.setValueCurveAtTime(curve, t + attack, dur)
    o.connect(g)
    o2.connect(g2).connect(g)
    this.out(g, pan, 0.45)
    o.start(t)
    o2.start(t)
    o.stop(t + attack + dur + 0.02)
    o2.stop(t + attack + dur + 0.02)
  }

  /** A very short, filtered noise tap: skin, film, contact. */
  private tick(t: number, level: number, freq: number, pan: number, type: BiquadFilterType = 'bandpass', tail = 0.03) {
    const ac = this.ac
    if (!ac || !this.white) return
    const src = ac.createBufferSource()
    src.buffer = this.white
    src.loop = true
    const f = ac.createBiquadFilter()
    f.type = type
    f.Q.value = type === 'bandpass' ? 1.4 : 0.7
    f.frequency.setValueAtTime(freq, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.5), t + tail)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + tail)
    src.connect(f).connect(g)
    this.out(g, pan, 0.4)
    src.start(t, Math.random() * 0.5)
    src.stop(t + tail + 0.02)
  }

  /** Route a node to the master (placed in stereo) and, by `wet`, to the room. */
  private out(node: AudioNode, pan: number, wet: number) {
    const ac = this.ctx
    if (!ac || !this.master || !this.send) return
    let tail: AudioNode = node
    if (typeof ac.createStereoPanner === 'function') {
      const p = ac.createStereoPanner()
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan))
      node.connect(p)
      tail = p
    }
    tail.connect(this.master)
    const s = ac.createGain()
    s.gain.value = wet
    tail.connect(s).connect(this.send)
  }

  private noiseBuffer(ac: AudioContext, seconds: number, pinkish: boolean): AudioBuffer {
    const len = Math.ceil(ac.sampleRate * seconds)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    if (!pinkish) {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      return buf
    }
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
    return buf
  }

  /** A room impulse: stereo decaying noise, darker as it fades. */
  private impulse(ac: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.ceil(ac.sampleRate * seconds)
    const buf = ac.createBuffer(2, len, ac.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const k = i / len
        const env = Math.pow(1 - k, decay)
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - k * 0.4)
        d[i] = lp * env
      }
    }
    return buf
  }
}

function rnd(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

/** Haptic tap where the platform offers it (Android browsers); silently nothing elsewhere. */
export function haptic(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported */
  }
}
