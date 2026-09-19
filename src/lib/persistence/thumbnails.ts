/**
 * Project thumbnails: a small WebP data URL rendered from the editor's 3D
 * scene. Stored next to the project in this browser and in the cloud row,
 * never inside the document snapshot (which stays pure geometry).
 */

const thumbKey = (id: string) => `smartgrid:thumb:${id}`

export const THUMBNAIL_WIDTH = 480
export const THUMBNAIL_HEIGHT = 360

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

type CaptureFn = () => string | null

let capture: CaptureFn | null = null

export function registerThumbnailCapture(fn: CaptureFn): () => void {
  capture = fn
  return () => {
    if (capture === fn) capture = null
  }
}

/** A fresh thumbnail of the open document, or null when the 3D viewport
 * is not mounted (or rendering failed). */
export function captureThumbnail(): string | null {
  if (!capture) return null
  try {
    return capture()
  } catch (err) {
    console.warn('Thumbnail capture failed', err)
    return null
  }
}
