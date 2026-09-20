/**
 * Project thumbnails: a small WebP data URL rendered from the editor's 3D
 * scene. Stored next to the project in this browser and in the cloud row,
 * never inside the document snapshot (which stays pure geometry).
 */

const thumbKey = (id: string) => `smartgrid:thumb:${id}`

// 2x the card size so retina screens and the model page hero stay crisp.
export const THUMBNAIL_WIDTH = 960
export const THUMBNAIL_HEIGHT = 720

export function loadLocalThumbnail(id: string): string | null {
  try {
    return localStorage.getItem(thumbKey(id))
  } catch {
    return null
  }
}

export function saveLocalThumbnail(id: string, dataUrl: string): void {
  try {
    localStorage.setItem(thumbKey(id), dataUrl)
  } catch {
    /* quota: the SVG fallback still draws */
  }
}

export function deleteLocalThumbnail(id: string): void {
  try {
    localStorage.removeItem(thumbKey(id))
  } catch {
    /* nothing to clean up */
  }
}

// --- Capture registry --------------------------------------------------------
// The editor's 3D viewport registers a capture function while mounted; the
// autosave asks for a fresh picture through it. With the viewport closed
// (2D-only layout) there is nothing to capture and the last picture stays.

/** 'busy': the viewport is mounted but still cutting holes; ask again. */
export type CaptureResult = string | null | 'busy'
type CaptureFn = () => Promise<CaptureResult>

let capture: CaptureFn | null = null

export function registerThumbnailCapture(fn: CaptureFn): () => void {
  capture = fn
  return () => {
    if (capture === fn) capture = null
  }
}

/** A fresh thumbnail of the open document; null when the 3D viewport is
 * not mounted (or rendering failed), 'busy' while its cuts are pending. */
export async function captureThumbnail(): Promise<CaptureResult> {
  if (!capture) return null
  try {
    return await capture()
  } catch (err) {
    console.warn('Thumbnail capture failed', err)
    return null
  }
}

// --- Source model ---------------------------------------------------------------
// Which community model a project was copied from, so publishing it can
// offer "a version of …". Kept beside the project like the thumbnail.

const sourceKey = (id: string) => `smartgrid:source:${id}`

export function loadProjectSource(id: string): string | null {
  try {
    return localStorage.getItem(sourceKey(id))
  } catch {
    return null
  }
}

export function saveProjectSource(id: string, itemId: string | null): void {
  try {
    if (itemId) localStorage.setItem(sourceKey(id), itemId)
    else localStorage.removeItem(sourceKey(id))
  } catch {
    /* fine */
  }
}

// --- Off-thread encoding ---------------------------------------------------------

let encoder: Worker | null = null
let encodeId = 1
const encodePending = new Map<number, { resolve: (url: string) => void; reject: (e: Error) => void }>()

function getEncoder(): Worker | null {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  if (encoder) return encoder
  try {
    encoder = new Worker(new URL('./thumbnailEncoder.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  encoder.onmessage = (event: MessageEvent<{ id: number; ok: true; dataUrl: string } | { id: number; ok: false; error: string }>) => {
    const entry = encodePending.get(event.data.id)
    if (!entry) return
    encodePending.delete(event.data.id)
    if (event.data.ok) entry.resolve(event.data.dataUrl)
    else entry.reject(new Error(event.data.error))
  }
  encoder.onerror = () => {
    for (const entry of encodePending.values()) entry.reject(new Error('Thumbnail encoder failed'))
    encodePending.clear()
    encoder?.terminate()
    encoder = null
  }
  return encoder
}

/** WebP data URL of a canvas, encoded in a worker when the browser can;
 * falls back to the (blocking) toDataURL. */
export async function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  const worker = getEncoder()
  if (!worker) return canvas.toDataURL('image/webp', quality)
  const bitmap = await createImageBitmap(canvas)
  const id = encodeId++
  const promise = new Promise<string>((resolve, reject) => encodePending.set(id, { resolve, reject }))
  worker.postMessage({ id, bitmap, quality }, [bitmap])
  return promise
}
