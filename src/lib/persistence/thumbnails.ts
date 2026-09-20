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
type CaptureFn = () => CaptureResult

let capture: CaptureFn | null = null

export function registerThumbnailCapture(fn: CaptureFn): () => void {
  capture = fn
  return () => {
    if (capture === fn) capture = null
  }
}

/** A fresh thumbnail of the open document; null when the 3D viewport is
 * not mounted (or rendering failed), 'busy' while its cuts are pending. */
export function captureThumbnail(): CaptureResult {
  if (!capture) return null
  try {
    return capture()
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
