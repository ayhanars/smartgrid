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
    if (!Array.isArray(list)) return []
    // One per product (older entries could repeat a product).
    const seen = new Set<string>()
    return list.filter((r) => {
      if (!r || typeof r.template !== 'string' || !r.spec || typeof r.spec !== 'object' || seen.has(r.template)) return false
      seen.add(r.template)
      return true
    })
  } catch {
    return []
  }
}

/** Adds (or moves to the front) a product with the specs it was last
 * added with: one entry per product. */
export function rememberRecentProduct(template: string, spec: ProductSpec) {
  const next = [{ template, spec, at: Date.now() }, ...listRecentProducts().filter((r) => r.template !== template)].slice(0, MAX)
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
  if (typeof spec.dividers === 'number' && spec.dividers > 0) bits.push(`${spec.dividers} dividers`)
  return bits.join(' · ')
}
