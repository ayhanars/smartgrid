import type { HueName } from './types'

/** OKLCH hue angles for the named hues. */
export const HUES: Record<HueName, number> = {
  red: 25,
  orange: 50,
  amber: 75,
  lime: 125,
  green: 150,
  teal: 195,
  blue: 255,
  violet: 300,
  magenta: 350,
}

export function hueAngle(h: HueName | number | undefined, fallback: HueName = 'blue'): number {
  if (typeof h === 'number') return ((h % 360) + 360) % 360
  return HUES[h ?? fallback] ?? HUES[fallback]
}

function toSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return v
}

/** OKLCH -> sRGB hex. Chroma is reduced until the colour fits the sRGB gamut. */
export function oklchToHex(L: number, C: number, h: number): string {
  let c = C
  for (let i = 0; i < 40; i++) {
    const hr = (h * Math.PI) / 180
    const a = c * Math.cos(hr)
    const b = c * Math.sin(hr)
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b
    const s_ = L - 0.0894841775 * a - 1.291485548 * b
    const l = l_ ** 3
    const m = m_ ** 3
    const s = s_ ** 3
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    const rgb = [r, g, bb].map(toSrgb)
    if (rgb.every((v) => v >= -0.002 && v <= 1.002) || c <= 0.001) {
      return (
        '#' +
        rgb
          .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
          .join('')
      )
    }
    c -= C / 40
  }
  return '#808080'
}

/**
 * A sequential ramp of `n` steps, index 0 = lowest value.
 * Light surfaces run pale -> deep; dark surfaces run deep -> bright, so the low end
 * always recedes toward the surface and the high end stands out.
 */
export function sequentialRamp(hue: number, n: number, dark: boolean, floor = 0): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    // `floor` lifts the palest step (0..1) so an emphasis ramp never fades into the no-data land.
    const t = floor + (1 - floor) * (n === 1 ? 1 : i / (n - 1))
    if (dark) out.push(oklchToHex(0.38 + 0.47 * t, 0.085 + 0.09 * t, hue))
    else out.push(oklchToHex(0.93 - 0.58 * t, 0.045 + 0.12 * t, hue))
  }
  return out
}

/**
 * Categorical slots in a fixed order (blue, orange, aqua, yellow, magenta, green).
 * Reference palette from the dataviz method; the first three are safe for all-pairs
 * forms such as a map, so categorical themes should stay at three where they can.
 */
export const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
export const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']

/** Relative luminance of a hex colour (0..1). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** Ink colour that reads on a fill. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.4 ? '#141414' : '#ffffff'
}
