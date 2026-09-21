import type { ProductSpec } from '../../lib/products'

/** The last products added from the Create panel, with their specs, so
 * the same thing (or a variation) is one click away. Per browser. */
export interface RecentProduct {
  template: string
  spec: ProductSpec
  at: number
}

const KEY = 'smartgrid:create-recents'
const MAX = 6

export function listRecentProducts(): RecentProduct[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as RecentProduct[]) : []
    return Array.isArray(list) ? list.filter((r) => r && typeof r.template === 'string' && r.spec && typeof r.spec === 'object') : []
  } catch {
    return []
  }
}

/** Adds (or moves to the front) a template + spec; the same specs on
 * the same template count as one entry. */
export function rememberRecentProduct(template: string, spec: ProductSpec) {
  const same = (r: RecentProduct) => r.template === template && JSON.stringify(r.spec) === JSON.stringify(spec)
  const next = [{ template, spec, at: Date.now() }, ...listRecentProducts().filter((r) => !same(r))].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage full or blocked: recents are a convenience */
  }
}

export function forgetRecentProducts() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to forget */
  }
}

/** A short line of the specs that matter: the sizes, then choices. */
export function describeSpec(spec: ProductSpec): string {
  const sizes = ['width', 'depth', 'height', 'length', 'reach'].filter((k) => typeof spec[k] === 'number').map((k) => `${spec[k]}`)
  const bits: string[] = []
  if (sizes.length) bits.push(sizes.join(' × ') + ' mm')
  if (typeof spec.columns === 'number' && typeof spec.rows === 'number') bits.push(`${spec.columns} × ${spec.rows} compartments`)
  if (typeof spec.board === 'string') bits.push(spec.board === 'custom' ? 'custom board' : String(spec.board).toUpperCase())
  if (typeof spec.notches === 'number') bits.push(`${spec.notches} notches`)
  if (typeof spec.dividers === 'number' && spec.dividers > 0) bits.push(`${spec.dividers} dividers`)
  return bits.join(' · ')
}
