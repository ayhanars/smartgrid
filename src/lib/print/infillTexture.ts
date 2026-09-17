import * as THREE from 'three'
import type { InfillPattern } from '../../types/document'

/** Nozzle line width the patterns are drawn at, in mm (0.4 mm nozzle). */
export const EXTRUSION_WIDTH_MM = 0.42

const TILE_PX = 256
const BACKGROUND = '#121216'

/** How many line families a pattern lays down per layer — density is
 * spread across them, so a 15% grid has twice the line spacing of 15%
 * lines. */
function lineFamilies(pattern: InfillPattern): number {
  switch (pattern) {
    case 'lines':
      return 1
    case 'triangles':
    case 'cubic':
      return 3
    default:
      return 2
  }
}

/** Center-to-center spacing between parallel infill lines, in mm. */
export function infillSpacingMM(pattern: InfillPattern, densityPercent: number): number {
  const density = Math.min(1, Math.max(0.02, densityPercent / 100))
  return (lineFamilies(pattern) * EXTRUSION_WIDTH_MM) / density
}

interface Tile {
  /** Size of one seamless period, in mm (width, height). */
  periodMM: [number, number]
  draw: (ctx: CanvasRenderingContext2D, px: (mm: number) => number) => void
}

function tileFor(pattern: InfillPattern, spacing: number): Tile {
  const line = (ctx: CanvasRenderingContext2D, px: (mm: number) => number, x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath()
    ctx.moveTo(px(x1), px(y1))
    ctx.lineTo(px(x2), px(y2))
    ctx.stroke()
  }
  switch (pattern) {
    case 'lines': {
      // 45° lines: a square tile of side spacing·√2 repeats seamlessly.
      const t = spacing * Math.SQRT2
      return {
        periodMM: [t, t],
        draw: (ctx, px) => {
          for (const k of [-1, 0, 1]) line(ctx, px, -t, -t + k * t, 2 * t, 2 * t + k * t)
        },
      }
    }
    case 'grid': {
      const t = spacing * Math.SQRT2
      return {
        periodMM: [t, t],
        draw: (ctx, px) => {
          for (const k of [-1, 0, 1]) {
            line(ctx, px, -t, -t + k * t, 2 * t, 2 * t + k * t)
            line(ctx, px, -t, 2 * t + k * t, 2 * t, -t + k * t)
          }
        },
      }
    }
    case 'triangles':
    case 'cubic': {
      // 0°/60°/120° families. Period: two 60° line pitches wide, two
      // horizontal pitches tall.
      const w = (2 * spacing) / Math.sin(Math.PI / 3)
      const h = 2 * spacing
      const tan60 = Math.tan(Math.PI / 3)
      return {
        periodMM: [w, h],
        draw: (ctx, px) => {
          for (let k = -1; k <= 3; k++) line(ctx, px, -w, k * spacing, 2 * w, k * spacing)
          const pitch = spacing / Math.sin(Math.PI / 3)
          for (let k = -4; k <= 6; k++) {
            // y = tan60·(x - k·pitch)
            line(ctx, px, k * pitch - h / tan60, -h, k * pitch + (2 * h) / tan60, 2 * h)
            line(ctx, px, k * pitch + h / tan60, -h, k * pitch - (2 * h) / tan60, 2 * h)
          }
        },
      }
    }
    case 'honeycomb': {
      // Flat-top hexagons with circumradius r: period 3r × √3·r.
      const r = spacing / Math.sqrt(3)
      const w = 3 * r
      const h = Math.sqrt(3) * r
      return {
        periodMM: [w, h],
        draw: (ctx, px) => {
          const hexAt = (cx: number, cy: number) => {
            ctx.beginPath()
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2
              const x = px(cx + r * Math.cos(a))
              const y = px(cy + r * Math.sin(a))
              if (i === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.closePath()
            ctx.stroke()
          }
          for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 2; j++) {
              hexAt(i * w, j * h)
              hexAt(i * w + 1.5 * r, j * h + h / 2)
            }
          }
        },
      }
    }
    case 'gyroid': {
      // Two families of sine waves, offset half a period, read like the
      // gyroid's wavy cross-sections.
      const t = 2 * spacing
      const amp = t / 7
      return {
        periodMM: [t, t],
        draw: (ctx, px) => {
          const wave = (horizontal: boolean, offset: number, sign: number) => {
            ctx.beginPath()
            for (let i = 0; i <= 64; i++) {
              const u = (i / 64) * t
              const v = offset + sign * amp * Math.sin((u / t) * Math.PI * 2)
              const x = horizontal ? u : v
              const y = horizontal ? v : u
              if (i === 0) ctx.moveTo(px(x), px(y))
              else ctx.lineTo(px(x), px(y))
            }
            ctx.stroke()
          }
          wave(true, t / 4, 1)
          wave(true, (3 * t) / 4, -1)
          wave(false, t / 4, -1)
          wave(false, (3 * t) / 4, 1)
        },
      }
    }
  }
}

export interface InfillTexture {
  texture: THREE.CanvasTexture
  periodMM: [number, number]
}

const cache = new Map<string, InfillTexture>()

/** A seamless tile of one infill pattern at a given density, white lines
 * on near-black so a material `color` tints the lines to the object's
 * color while the gaps stay dark ("empty"). Cached per pattern/density. */
export function getInfillTexture(pattern: InfillPattern, densityPercent: number): InfillTexture {
  const key = `${pattern}:${densityPercent}`
  const hit = cache.get(key)
  if (hit) return hit

  const spacing = infillSpacingMM(pattern, densityPercent)
  const tile = tileFor(pattern, spacing)
  const [pw, ph] = tile.periodMM
  const canvas = document.createElement('canvas')
  canvas.width = TILE_PX
  canvas.height = Math.max(8, Math.round((TILE_PX * ph) / pw))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const pxPerMM = TILE_PX / pw
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(1.5, EXTRUSION_WIDTH_MM * pxPerMM)
  ctx.lineCap = 'round'
  tile.draw(ctx, (mm) => mm * pxPerMM)

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const result = { texture, periodMM: tile.periodMM }
  cache.set(key, result)
  return result
}
