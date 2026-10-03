/**
 * Synthesised sounds for the bubble scene, no audio files. Built the way a
 * sound designer would layer them: a noise transient shaped by resonant
 * filters (the "body"), a pitched element with a real envelope, a touch of
 * saturation, and a short room so nothing sounds dry and electronic. Every
 * call varies pitch slightly, as real objects do.
 *
 * The context is created on the first user gesture (browsers refuse autoplay
 * before that).
 */
export class Sounds {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private send: GainNode | null = null
  private pink: AudioBuffer | null = null
  private white: AudioBuffer | null = null
  private last = -1
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
      // master: a gentle compressor glues the layers and keeps pops from spiking
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.knee.value = 12
      comp.ratio.value = 3
      comp.attack.value = 0.003
      comp.release.value = 0.12
      const master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(comp).connect(ctx.destination)
      this.master = master
      // room: a short, dark reverb from a decaying noise impulse
      const room = ctx.createConvolver()
      room.buffer = this.impulse(ctx, 0.55, 2.2)
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

  /** A bubble bursting: a skin-snap click and a rising water "bloop". Bigger bubbles sit lower. */
  pop(radius: number): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    const size = Math.min(1, radius / 120) // 0 small .. 1 large
    const vary = 1 + (Math.random() - 0.5) * 0.16
    // 1. the snap: a few milliseconds of white noise through a ringing band-pass
    this.burst(t, 0.012, 0.5, (2600 - size * 1400) * vary, 6, 0.06)
    // 2. the bloop: a sine that rises as the cavity closes, with a fast decay
    const f0 = (520 - size * 300) * vary
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(f0 * 2.1, t + 0.07 + size * 0.05)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5 + size * 0.2, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13 + size * 0.08)
    o.connect(this.warm(ac, 1.6)).connect(g)
    this.out(g, 0.5)
    o.start(t)
    o.stop(t + 0.25)
    // 3. a breath of air leaving, low and quiet
    this.burst(t + 0.004, 0.09, 0.14, 700 - size * 300, 0.8, 0.09)
  }

  /** Landing on the floor: a soft, rounded thud; loudness follows speed, pitch follows size. */
  land(radius: number, speed: number): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    if (t - this.last < 0.03) return // a pile settling fires many contacts at once
    this.last = t
    const size = Math.min(1, radius / 120)
    const vol = Math.min(1, 0.12 + speed * 0.12)
    const vary = 1 + (Math.random() - 0.5) * 0.12
    // body: a low sine that drops in pitch, through saturation for warmth
    const f0 = (150 - size * 80) * vary
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f0 * 1.5, t)
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.07)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.6 * vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16 + size * 0.1)
    o.connect(this.warm(ac, 2.5)).connect(g)
    this.out(g, 0.35)
    o.start(t)
    o.stop(t + 0.35)
    // skin: a dull low-passed noise tap
    this.burst(t, 0.045, 0.35 * vol, 320 + speed * 40, 0.7, 0.05, 'lowpass')
    // small bubbles add a faint wet "plip"
    if (size < 0.4) {
      const p = ac.createOscillator()
      p.type = 'sine'
      p.frequency.setValueAtTime(900 * vary, t)
      p.frequency.exponentialRampToValueAtTime(1500 * vary, t + 0.04)
      const pg = ac.createGain()
      pg.gain.setValueAtTime(0.0001, t)
      pg.gain.exponentialRampToValueAtTime(0.08 * vol, t + 0.004)
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
      p.connect(pg)
      this.out(pg, 0.6)
      p.start(t)
      p.stop(t + 0.08)
    }
  }

  /** Picking a bubble up: a soft wet touch. */
  grab(): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    const vary = 1 + (Math.random() - 0.5) * 0.2
    this.burst(t, 0.01, 0.16, 1800 * vary, 4, 0.04)
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(700 * vary, t)
    o.frequency.exponentialRampToValueAtTime(1100 * vary, t + 0.03)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g)
    this.out(g, 0.4)
    o.start(t)
    o.stop(t + 0.07)
  }

  /** Everything dropping again: a swell of air. */
  whoosh(): void {
    const ac = this.ac
    if (!ac || !this.pink) return
    const t = ac.currentTime
    const src = ac.createBufferSource()
    src.buffer = this.pink
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.setValueAtTime(260, t)
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.28)
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.7)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.22)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.72)
    src.connect(bp).connect(g)
    this.out(g, 0.8)
    src.start(t)
    src.stop(t + 0.8)
  }

  // ---------- building blocks ----------

  /** A short noise transient through a resonant filter with an exponential tail. */
  private burst(t: number, attackDur: number, vol: number, freq: number, q: number, tail: number, type: BiquadFilterType = 'bandpass') {
    const ac = this.ac
    if (!ac || !this.white) return
    const src = ac.createBufferSource()
    src.buffer = this.white
    src.loop = true
    const f = ac.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(freq, t)
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.45), t + attackDur + tail)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002)
    g.gain.setValueAtTime(vol, t + attackDur)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attackDur + tail)
    src.connect(f).connect(g)
    this.out(g, 0.5)
    src.start(t, Math.random() * 0.5)
    src.stop(t + attackDur + tail + 0.02)
  }

  /** Gentle saturation: rounds a sine into something with a little body. */
  private warm(ac: AudioContext, drive: number): WaveShaperNode {
    const ws = ac.createWaveShaper()
    const n = 256
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
    }
    ws.curve = curve
    ws.oversample = '2x'
    return ws
  }

  /** Route a node to the master and, by `wet`, to the room. */
  private out(node: AudioNode, wet: number) {
    if (!this.master || !this.send) return
    node.connect(this.master)
    const s = this.ctx!.createGain()
    s.gain.value = wet
    node.connect(s).connect(this.send)
  }

  private noiseBuffer(ac: AudioContext, seconds: number, pinkish: boolean): AudioBuffer {
    const len = Math.ceil(ac.sampleRate * seconds)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    if (!pinkish) {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      return buf
    }
    // Paul Kellet's pink noise filter
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
        lp += ((Math.random() * 2 - 1) - lp) * (0.6 - k * 0.45) // darkens over time
        d[i] = lp * env
      }
    }
    return buf
  }
}

/** Haptic tap where the platform offers it (Android browsers); silently nothing elsewhere. */
export function haptic(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* unsupported */
  }
}
