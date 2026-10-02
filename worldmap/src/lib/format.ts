import type { FormatSpec } from './types'

export function makeFormatter(spec: FormatSpec | undefined, values: number[]): (v: number) => string {
  const max = values.length ? Math.max(...values.map(Math.abs)) : 0
  const compact = spec?.compact ?? max >= 10_000
  const decimals = spec?.decimals ?? (max < 100 ? 1 : 0)
  const locale = spec?.locale
  const nf = new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : decimals,
    minimumFractionDigits: compact ? 0 : decimals,
  })
  return (v: number) => `${spec?.prefix ?? ''}${nf.format(v)}${spec?.suffix ?? ''}`
}

/** Round to `sig` significant digits, for legend break labels. */
export function roundSig(v: number, sig = 2): number {
  if (v === 0) return 0
  const p = Math.pow(10, sig - 1 - Math.floor(Math.log10(Math.abs(v))))
  return Math.round(v * p) / p
}

/** Quantile thresholds (k-1 cut points for k classes). */
export function quantileBreaks(sorted: number[], k: number): number[] {
  const out: number[] = []
  for (let i = 1; i < k; i++) {
    const pos = (i / k) * (sorted.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
    out.push(roundSig(v))
  }
  return dedupe(out)
}

/** Equal-interval thresholds, rounded to readable numbers. */
export function linearBreaks(min: number, max: number, k: number): number[] {
  const out: number[] = []
  for (let i = 1; i < k; i++) out.push(roundSig(min + ((max - min) * i) / k))
  return dedupe(out)
}

function dedupe(breaks: number[]): number[] {
  const out: number[] = []
  for (const b of breaks) if (out.length === 0 || b > out[out.length - 1]) out.push(b)
  return out
}

/** Index of the class a value falls in, given ascending breaks. */
export function classOf(v: number, breaks: number[]): number {
  let i = 0
  while (i < breaks.length && v >= breaks[i]) i++
  return i
}
