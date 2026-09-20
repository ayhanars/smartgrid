import { useMemo } from 'react'
import * as THREE from 'three'

const PX_PER_MM = 4

/** Draws a build-plate texture: a dark textured-PEI base with a 10mm grid,
 * heavier 50mm lines and a light rim, so the plate reads as a real object
 * against the dark stage instead of disappearing into it. */
function makePlateTexture(widthMM: number, depthMM: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(widthMM * PX_PER_MM))
  canvas.height = Math.max(1, Math.round(depthMM * PX_PER_MM))
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#2b2e3a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // fine speckle so it reads as textured PEI rather than flat paint
  for (let i = 0; i < (canvas.width * canvas.height) / 60; i++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)'
    ctx.fillRect(x, y, 1.5, 1.5)
  }

  const drawGrid = (stepMM: number, color: string, lineWidth: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    for (let x = 0; x <= widthMM + 0.001; x += stepMM) {
      const px = Math.round(x * PX_PER_MM) + 0.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, canvas.height)
    }
    for (let y = 0; y <= depthMM + 0.001; y += stepMM) {
      const py = Math.round(y * PX_PER_MM) + 0.5
      ctx.moveTo(0, py)
      ctx.lineTo(canvas.width, py)
    }
    ctx.stroke()
  }
  drawGrid(10, 'rgba(255,255,255,0.09)', 1)
  drawGrid(50, 'rgba(255,255,255,0.22)', 2)

  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

interface PrinterPlateProps {
  /** Scene-unit width/depth (already scaled). */
  width: number
  depth: number
  widthMM: number
  depthMM: number
  /** Faded: a plate that is not the active one. */
  dim?: boolean
}

export function PrinterPlate({ width, depth, widthMM, depthMM, dim = false }: PrinterPlateProps) {
  const texture = useMemo(() => makePlateTexture(widthMM, depthMM), [widthMM, depthMM])
  const thickness = Math.max(width, depth) * 0.012

  return (
    <group>
      {/* metal carrier slab under the sheet, slightly larger, lighter rim */}
      <mesh position={[0, -thickness * 1.5, 0]} receiveShadow>
        <boxGeometry args={[width * 1.02, thickness, depth * 1.02]} />
        <meshStandardMaterial color="#4a4d59" metalness={0.55} roughness={0.5} transparent={dim} opacity={dim ? 0.35 : 1} />
      </mesh>
      {/* the textured print sheet itself */}
      <mesh position={[0, -thickness * 0.5, 0]} receiveShadow>
        <boxGeometry args={[width, thickness, depth]} />
        <meshStandardMaterial color="#3a3d4a" metalness={0.2} roughness={0.75} transparent={dim} opacity={dim ? 0.35 : 1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={texture} metalness={0.15} roughness={0.85} transparent={dim} opacity={dim ? 0.4 : 1} />
      </mesh>
    </group>
  )
}
