import { useEffect, useRef } from 'react'
import type { SurfaceTexture } from '../../types/document'
import { patternStrength } from '../../lib/geometry/surfaceTexture'
import { useViewStore } from '../../state/viewStore'

/** A small embossed rendering of a texture, drawn from the exact same
 * pattern function the geometry uses, so what you pick is what you get. */
export function TexturePreview({ texture, width = 72, height = 48, patterns = 2.6 }: { texture: SurfaceTexture; width?: number; height?: number; patterns?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const tileVersion = useViewStore((s) => s.tileVersion)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const spanMM = Math.max(0.5, texture.size) * patterns
    const mmPerPx = spanMM / width
    const extent = { width: spanMM, height: height * mmPerPx }
    const f = (px: number, py: number) => patternStrength(texture, px * mmPerPx, py * mmPerPx, extent)
    const img = ctx.createImageData(width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const here = f(x, y)
        // Light from the top-left: the far edge of a groove catches light,
        // the near edge falls into shadow.
        const slope = f(x + 1, y + 1) - f(x - 1, y - 1)
        const shade = Math.max(0, Math.min(1, 0.62 - here * 0.28 + slope * 0.55))
        const i = (y * width + x) * 4
        img.data[i] = 150 * shade + 30
        img.data[i + 1] = 160 * shade + 32
        img.data[i + 2] = 185 * shade + 40
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [texture, width, height, patterns, tileVersion])
  return <canvas ref={ref} width={width} height={height} className="texture-preview" aria-hidden />
}
