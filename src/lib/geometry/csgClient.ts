import * as THREE from 'three'
import { cutHolesFromSolid, fuseSolids, type PositionedGeometry } from './holeCut'
import { packGeometry, transferables, unpackGeometry } from './csgPack'
import type { CsgRequest, CsgResponse } from './csg.worker'

/**
 * `cutHolesFromSolid`, but run in a Web Worker so the editor stays
 * responsive however long the boolean takes. Jobs run one at a time in
 * the order requested; `cancel` drops a job that hasn't started yet.
 */
export interface CsgJob {
  promise: Promise<THREE.BufferGeometry>
  cancel: () => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (g: THREE.BufferGeometry) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./csg.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  worker.onmessage = (event: MessageEvent<CsgResponse>) => {
    const entry = pending.get(event.data.id)
    if (!entry) return
    pending.delete(event.data.id)
    if (event.data.ok) entry.resolve(unpackGeometry(event.data.geometry))
    else entry.reject(new Error(event.data.error))
  }
  worker.onerror = (event) => {
    // The worker itself died (out of memory on a pathological cut, say):
    // fail everything in flight and start a fresh one for the next job.
    const error = new Error(event.message || 'CSG worker failed')
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function cutHolesAsync(solid: PositionedGeometry, holes: PositionedGeometry[]): CsgJob {
  return runCsg(solid, holes, 'subtract')
}

/** Unions `parts` into one body, in the first part's local frame. */
export function fuseAsync(parts: PositionedGeometry[]): CsgJob {
  if (parts.length === 0) return { promise: Promise.resolve(new THREE.BufferGeometry()), cancel: () => {} }
  return runCsg(parts[0], parts.slice(1), 'union')
}

function runCsg(solid: PositionedGeometry, others: PositionedGeometry[], op: 'subtract' | 'union'): CsgJob {
  if (others.length === 0) return { promise: Promise.resolve(solid.geometry), cancel: () => {} }
  const w = getWorker()
  if (!w) {
    // No workers here (an old browser, a test runtime): do it inline.
    return {
      promise: new Promise((resolve, reject) => {
        try {
          resolve(op === 'union' ? fuseSolids([solid, ...others]) : cutHolesFromSolid(solid, others))
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }),
      cancel: () => {},
    }
  }
  const id = nextId++
  const request: CsgRequest = {
    id,
    solid: packGeometry(solid.geometry, solid.worldX, solid.worldY, solid.worldZ),
    holes: others.map((h) => packGeometry(h.geometry, h.worldX, h.worldY, h.worldZ)),
    op,
  }
  const promise = new Promise<THREE.BufferGeometry>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
  w.postMessage(request, [...transferables(request.solid), ...request.holes.flatMap(transferables)])
  return {
    promise,
    cancel: () => {
      if (!pending.has(id)) return
      w.postMessage({ cancel: id })
      pending.delete(id)
    },
  }
}
