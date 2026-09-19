import { useEffect, useRef } from 'react'
import type { SurfaceTexture } from '../../types/document'
import { patternStrength } from '../../lib/geometry/surfaceTexture'
import { useViewStore } from '../../state/viewStore'

/** A small embossed rendering of a texture, drawn from the exact same
 * pattern function the geometry uses, so what you pick is what you get.
 * Lit like the 3D view: a key light from the upper left, a soft fill, a
 * plastic highlight, and grooves darkening the deeper they go. */
export function TexturePreview({ texture, width = 72, height = 48, patterns = 2.6 }: { texture: SurfaceTexture; width?: number; height?: number; patterns?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const tileVersion = useViewStore((s) => s.tileVersion)
  const scale = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const pw = Math.round(width * scale)
  const ph = Math.round(height * scale)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const spanMM = Math.max(0.5, texture.size) * patterns
    const mmPerPx = spanMM / pw
    const extent = { width: spanMM, height: ph * mmPerPx }
    const raised = texture.relief === 'raised'
    // Height field in mm: a groove sinks, a raised relief stands proud.
    const depth = Math.max(0.15, texture.depth) * (raised ? 1 : -1)
    const h = new Float32Array((pw + 2) * (ph + 2))
    for (let y = 0; y < ph + 2; y++) {
      for (let x = 0; x < pw + 2; x++) h[y * (pw + 2) + x] = depth * patternStrength(texture, (x - 1) * mmPerPx, (y - 1) * mmPerPx, extent)
    }
    const at = (x: number, y: number) => h[(y + 1) * (pw + 2) + (x + 1)]
    // Lights (toward the light): key upper-left, fill lower-right.
    const key = norm([-0.55, -0.6, 0.65])
    const fill = norm([0.4, 0.5, 0.75])
    const view = [0, 0, 1]
    const half = norm([key[0] + view[0], key[1] + view[1], key[2] + view[2]])
    const base = [0.58, 0.63, 0.74]
    const img = ctx.createImageData(pw, ph)
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        // Central-difference normal; heights are mm, so scale the slope to
        // the pixel size to keep the relief legible at any zoom.
        const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * mmPerPx)
        const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * mmPerPx)
        const n = norm([-dx * 0.9, -dy * 0.9, 1])
        const diffuse = Math.max(0, dot(n, key)) * 0.85 + Math.max(0, dot(n, fill)) * 0.25
        const spec = Math.pow(Math.max(0, dot(n, half)), 28) * 0.45
        // Cavity darkening: the bottom of a groove sees less sky.
        const rel = depth === 0 ? 0 : at(x, y) / depth
        const occlusion = 1 - (raised ? 0 : 0.3 * rel)
        const lift = raised ? 0.12 * rel : 0
        const shade = (0.22 + diffuse * 0.78) * occlusion + lift
        const i = (y * pw + x) * 4
        img.data[i] = Math.min(255, (base[0] * shade + spec) * 255)
        img.data[i + 1] = Math.min(255, (base[1] * shade + spec) * 255)
        img.data[i + 2] = Math.min(255, (base[2] * shade + spec) * 255)
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [texture, pw, ph, patterns, tileVersion])
  return <canvas ref={ref} width={pw} height={ph} style={{ width, height }} className="texture-preview" aria-hidden />
}

function norm(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
