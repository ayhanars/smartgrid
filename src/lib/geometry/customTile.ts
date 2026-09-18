import { useViewStore } from '../../state/viewStore'

/** A decoded custom texture tile: groove strength 0..1 per pixel. */
export interface DecodedTile {
  width: number
  height: number
  data: Float32Array
}

const TILE_PX = 128
const cache = new Map<string, DecodedTile>()
const pending = new Set<string>()

/** Rasterizes an image (SVG/PNG/JPEG data URL) into groove strengths:
 * dark and opaque = deep groove, white or transparent = untouched. */
async function decode(url: string): Promise<DecodedTile> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('The image could not be read.'))
    img.src = url
  })
  const w = img.naturalWidth || TILE_PX
  const h = img.naturalHeight || TILE_PX
  const scale = TILE_PX / Math.max(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const data = new Float32Array(canvas.width * canvas.height)
  for (let i = 0; i < data.length; i++) {
    const r = px[i * 4]
    const g = px[i * 4 + 1]
    const b = px[i * 4 + 2]
    const a = px[i * 4 + 3] / 255
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    data[i] = a * (1 - lum)
  }
  return { width: canvas.width, height: canvas.height, data }
}

/** Decodes and caches a tile up front (e.g. right after upload) so the
 * first geometry build already has it. */
export async function prepareTile(url: string): Promise<DecodedTile> {
  const hit = cache.get(url)
  if (hit) return hit
  const tile = await decode(url)
  cache.set(url, tile)
  return tile
}

/** Synchronous lookup for geometry building. A tile seen for the first
 * time (a project loaded from storage) starts decoding in the background
 * and bumps the view store's tile version when ready, so meshes rebuild. */
export function getTile(url: string): DecodedTile | null {
  const hit = cache.get(url)
  if (hit) return hit
  if (!pending.has(url) && typeof document !== 'undefined') {
    pending.add(url)
    decode(url)
      .then((tile) => {
        cache.set(url, tile)
        useViewStore.getState().bumpTileVersion()
      })
      .catch(() => {
        /* a broken tile just means no pattern */
      })
      .finally(() => pending.delete(url))
  }
  return null
}

/** Bilinear sample of groove strength at tile coordinates 0..1 (wrapping). */
export function sampleTile(tile: DecodedTile, tx: number, ty: number, wrap: boolean): number {
  if (!wrap && (tx < 0 || tx >= 1 || ty < 0 || ty >= 1)) return 0
  const fx = ((tx % 1) + 1) % 1
  const fy = ((ty % 1) + 1) % 1
  const x = fx * tile.width - 0.5
  const y = fy * tile.height - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const sx = x - x0
  const sy = y - y0
  const at = (ix: number, iy: number) => {
    const cx = ((ix % tile.width) + tile.width) % tile.width
    const cy = ((iy % tile.height) + tile.height) % tile.height
    return tile.data[cy * tile.width + cx]
  }
  return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy
}
