import { cutHolesFromSolid } from './holeCut'
import { packGeometry, transferables, unpackGeometry, type PackedGeometry } from './csgPack'

/** Off-main-thread boolean: a plate full of drilled holes can take seconds
 * to cut, and that must never freeze the editor (or, worse, freeze it
 * again on every reload of the autosaved project). */
export interface CsgRequest {
  id: number
  solid: PackedGeometry
  holes: PackedGeometry[]
}

export type CsgResponse = { id: number; ok: true; geometry: PackedGeometry } | { id: number; ok: false; error: string }

const cancelled = new Set<number>()

self.onmessage = (event: MessageEvent<CsgRequest | { cancel: number }>) => {
  const data = event.data
  if ('cancel' in data) {
    cancelled.add(data.cancel)
    return
  }
  if (cancelled.delete(data.id)) return
  try {
    const solid = unpackGeometry(data.solid)
    const holes = data.holes.map((h) => ({ geometry: unpackGeometry(h), worldX: h.x, worldY: h.y, worldZ: h.z }))
    const cut = cutHolesFromSolid({ geometry: solid, worldX: data.solid.x, worldY: data.solid.y, worldZ: data.solid.z }, holes)
    const geometry = packGeometry(cut)
    const response: CsgResponse = { id: data.id, ok: true, geometry }
    self.postMessage(response, { transfer: transferables(geometry) })
  } catch (err) {
    const response: CsgResponse = { id: data.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(response)
  }
}
