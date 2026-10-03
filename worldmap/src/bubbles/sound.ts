/**
 * Small synthesised sounds for the bubble scene, no audio files. The context is
 * created on the first user gesture (browsers refuse autoplay before that).
 */
export class Sounds {
  private ctx: AudioContext | null = null
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
      this.ctx = new AC()
    } catch {
      this.ctx = null
    }
  }

  private get ac(): AudioContext | null {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return null
    return this.ctx
  }

  /** A bubble bursting: a short bright click with a noise puff. Bigger bubbles pop lower. */
  pop(radius: number): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    const f = 900 - Math.min(600, radius * 4)
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f * 1.8, t)
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.09)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    o.connect(g).connect(ac.destination)
    o.start(t)
    o.stop(t + 0.13)
    this.noise(t, 0.07, 0.18, 1800 + Math.random() * 800)
  }

  /** Landing on the floor: a soft plop, pitch by size, loudness by speed. */
  land(radius: number, speed: number): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    const vol = Math.min(0.28, 0.04 + speed * 0.03)
    const f = 220 - Math.min(150, radius * 1.1)
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f * 1.6, t)
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g).connect(ac.destination)
    o.start(t)
    o.stop(t + 0.17)
  }

  /** Picking a bubble up: a tiny tick. */
  grab(): void {
    const ac = this.ac
    if (!ac) return
    const t = ac.currentTime
    const o = ac.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(1400, t)
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g).connect(ac.destination)
    o.start(t)
    o.stop(t + 0.06)
  }

  /** Everything dropping again: a short airy whoosh. */
  whoosh(): void {
    const ac = this.ac
    if (!ac) return
    this.noise(ac.currentTime, 0.5, 0.12, 600, 2400)
  }

  private noise(t: number, dur: number, vol: number, fFrom: number, fTo = fFrom * 0.4) {
    const ac = this.ac
    if (!ac) return
    const len = Math.ceil(ac.sampleRate * dur)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = ac.createBufferSource()
    src.buffer = buf
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.2
    bp.frequency.setValueAtTime(fFrom, t)
    bp.frequency.exponentialRampToValueAtTime(fTo, t + dur)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(bp).connect(g).connect(ac.destination)
    src.start(t)
    src.stop(t + dur + 0.02)
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
