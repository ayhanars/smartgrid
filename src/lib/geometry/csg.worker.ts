import { cutHolesFromSolid, fuseSolids } from './holeCut'
import { packGeometry, transferables, unpackGeometry, type PackedGeometry } from './csgPack'
import { booleanManifold, loadManifold } from './manifoldCsg'

/** Off-main-thread boolean: a plate full of drilled holes can take seconds
 * to cut, and that must never freeze the editor (or, worse, freeze it
 * again on every reload of the autosaved project). */
export interface CsgRequest {
  id: number
  solid: PackedGeometry
  holes: PackedGeometry[]
  /** Subtract the holes (default) or union them onto the solid. */
  op?: 'subtract' | 'union'
}

export type CsgResponse = { id: number; ok: true; geometry: PackedGeometry } | { id: number; ok: false; error: string }

const cancelled = new Set<number>()

// Jobs run strictly in order: Manifold is loaded once up front, and
// every boolean after that is synchronous.
const ready = loadManifold().catch((err) => {
  console.warn('Manifold failed to load; booleans use the clipping evaluator:', err)
  return null
})

self.onmessage = async (event: MessageEvent<CsgRequest | { cancel: number }>) => {
  const data = event.data
  if ('cancel' in data) {
    cancelled.add(data.cancel)
    return
  }
  const wasm = await ready
  if (cancelled.delete(data.id)) return
  try {
    const solid = unpackGeometry(data.solid)
    const holes = data.holes.map((h) => ({ geometry: unpackGeometry(h), worldX: h.x, worldY: h.y, worldZ: h.z }))
    const placed = { geometry: solid, worldX: data.solid.x, worldY: data.solid.y, worldZ: data.solid.z }
    const op = data.op === 'union' ? 'union' : 'subtract'
    let cut: ReturnType<typeof cutHolesFromSolid> | null = null
    if (wasm) {
      try {
        cut = booleanManifold(wasm, placed, holes, op)
      } catch (err) {
        // An input that is not manifold (a self-crossing outline, say):
        // the clipping evaluator still gives a printable approximation.
        console.warn('Manifold rejected the input; falling back to the clipping evaluator:', err)
      }
    }
    if (!cut) cut = op === 'union' ? fuseSolids([placed, ...holes]) : cutHolesFromSolid(placed, holes)
    const geometry = packGeometry(cut)
    const response: CsgResponse = { id: data.id, ok: true, geometry }
    self.postMessage(response, { transfer: transferables(geometry) })
  } catch (err) {
    const response: CsgResponse = { id: data.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(response)
  }
}
