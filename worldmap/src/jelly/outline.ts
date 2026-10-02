import type { Country } from '../lib/types'

export type Pt = [number, number]

/** Split an "M…L…Z" path (absolute coordinates only, as build-geo writes) into rings. */
export function pathRings(d: string): Pt[][] {
  const rings: Pt[][] = []
  let cur: Pt[] = []
  const re = /([MLZ])([^MLZ]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    const cmd = m[1]
    if (cmd === 'Z') {
      if (cur.length > 2) rings.push(cur)
      cur = []
      continue
    }
    const nums = m[2].trim().split(/[\s,]+/).map(Number)
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (cmd === 'M' && cur.length) {
        rings.push(cur)
        cur = []
      }
      cur.push([nums[i], nums[i + 1]])
    }
  }
  if (cur.length > 2) rings.push(cur)
  return rings
}

export function ringArea(r: Pt[]): number {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return Math.abs(a / 2)
}

/** Douglas–Peucker simplification of a closed ring. */
export function simplify(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 4) return ring
  const keep = new Uint8Array(ring.length)
  keep[0] = 1
  keep[ring.length - 1] = 1
  const stack: [number, number][] = [[0, ring.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0
    let idx = -1
    const [ax, ay] = ring[a]
    const [bx, by] = ring[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i]
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: Pt[] = []
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i])
  return out
}

/**
 * The main landmass of a country as a simplified polygon with at most `maxPts`
 * vertices, centred on its bounding box and normalised to unit area.
 */
export function mainOutline(country: Country, maxPts = 36): { pts: Pt[]; w: number; h: number } {
  const rings = pathRings(country.d)
  let best = rings[0]
  let bestA = -1
  for (const r of rings) {
    const a = ringArea(r)
    if (a > bestA) {
      bestA = a
      best = r
    }
  }
  const span = Math.max(...best.map((p) => p[0])) - Math.min(...best.map((p) => p[0]))
  let tol = span * 0.004
  let s = simplify(best, tol)
  while (s.length > maxPts) {
    tol *= 1.5
    s = simplify(best, tol)
  }
  // drop a closing duplicate point
  if (s.length > 1 && s[0][0] === s[s.length - 1][0] && s[0][1] === s[s.length - 1][1]) s.pop()
  const xs = s.map((p) => p[0])
  const ys = s.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const k = 1 / Math.sqrt(ringArea(s) || 1)
  return {
    pts: s.map(([x, y]) => [(x - cx) * k, (y - cy) * k]),
    w: (maxX - minX) * k,
    h: (maxY - minY) * k,
  }
}
