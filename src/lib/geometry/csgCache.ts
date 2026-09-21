import type * as THREE from 'three'
import { packGeometry, unpackGeometry, type PackedGeometry } from './csgPack'

/**
 * Finished cuts kept in IndexedDB, so a shape cut once on this device is
 * never cut again — not after a reload, not when the project is opened
 * next week, not when its community copy is previewed. Keyed by a hash of
 * everything the cut depends on; bounded by total bytes, oldest out.
 */
const DB_NAME = 'smartgrid-csg'
const STORE = 'cuts'
const MAX_BYTES = 200 * 1024 * 1024

interface Entry {
  key: string
  geometries: PackedGeometry[]
  bytes: number
  /** Last use, ms. */
  t: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('t', 't')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** cyrb53: a fast, well-mixed 53-bit string hash (two seeds, joined). */
function hash(str: string): string {
  const one = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  return `${one(1)}-${one(7)}-${str.length}`
}

/** Bump whenever the built geometry or its shading changes for the same
 * document data, so cuts stored on a device before the change are not
 * served for it (they would carry the old look). */
export const GEOMETRY_VERSION = 3

export const cutCacheKey = (jobKey: string) => hash(`v${GEOMETRY_VERSION}:${jobKey}`)

export async function loadCut(jobKey: string): Promise<THREE.BufferGeometry[] | null> {
  const db = await openDb()
  if (!db) return null
  const key = cutCacheKey(jobKey)
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.get(key)
      req.onsuccess = () => {
        const entry = req.result as Entry | undefined
        if (!entry) return resolve(null)
        store.put({ ...entry, t: Date.now() })
        resolve(entry.geometries.map(unpackGeometry))
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function storeCut(jobKey: string, geometries: THREE.BufferGeometry[]): Promise<void> {
  const db = await openDb()
  if (!db) return
  const packed = geometries.map((g) => packGeometry(g))
  const bytes = packed.reduce((n, g) => n + g.position.byteLength + (g.normal?.byteLength ?? 0) + (g.index?.byteLength ?? 0), 0)
  if (bytes > MAX_BYTES / 4) return
  const entry: Entry = { key: cutCacheKey(jobKey), geometries: packed, bytes, t: Date.now() }
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
    void trim(db)
  } catch {
    /* quota or private mode: the in-memory cache still works */
  }
}

let trimming = false
async function trim(db: IDBDatabase) {
  if (trimming) return
  trimming = true
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const all = await new Promise<Entry[]>((resolve) => {
      const req = store.getAll()
      req.onsuccess = () => resolve((req.result as Entry[]) ?? [])
      req.onerror = () => resolve([])
    })
    let total = all.reduce((n, e) => n + e.bytes, 0)
    if (total <= MAX_BYTES) return
    all.sort((a, b) => a.t - b.t)
    for (const e of all) {
      if (total <= MAX_BYTES * 0.8) break
      store.delete(e.key)
      total -= e.bytes
    }
  } catch {
    /* ignore */
  } finally {
    trimming = false
  }
}
