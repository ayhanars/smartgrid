import { useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Box, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { shapeWorldBounds, useDocumentStore } from '../../state/documentStore'
import type { Bounds } from '../../types/document'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { buildLayerGeometries } from '../../lib/geometry/layerGeometry'
import { cutHolesFromSolid } from '../../lib/geometry/holeCut'
import { SCENE_SCALE } from './sceneScale'
import { ExtrudedShapeMesh } from './ExtrudedShapeMesh'
import { PrinterPlate } from './PrinterPlate'
import './Viewport3DPane.css'

function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function Viewport3DPane() {
  const [wireframe, setWireframe] = useState(false)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const bed = getBedPreset(bedPresetId)
  const artboardWidth = bed?.width ?? customBedWidth
  const artboardHeight = bed?.height ?? customBedHeight
  const bedWidth = artboardWidth * SCENE_SCALE
  const bedDepth = artboardHeight * SCENE_SCALE

  const handleSelect = (id: string, additive: boolean) => {
    if (additive) {
      setSelection(selection.includes(id) ? selection.filter((sid) => sid !== id) : [...selection, id])
    } else {
      setSelection([id])
    }
  }

  // A hole is a cutting tool, not a printable shape: any solid whose XY
  // footprint overlaps a hole's gets that hole's volume subtracted from it
  // via a real 3D boolean (see holeCut.ts), independent of the hole's own
  // Z/depth. Solids with nothing overlapping skip this entirely and render
  // through ExtrudedShapeMesh's normal (uncut) path.
  const cutGeometriesById = useMemo(() => {
    const result: Record<string, THREE.BufferGeometry[]> = {}
    const holeIds = order.filter((id) => layers[id]?.isHole && layers[id]?.visible)
    if (holeIds.length === 0) return result

    const toWorld = (layer: (typeof layers)[string]) => ({
      worldX: (layer.transform.x - artboardWidth / 2) * SCENE_SCALE,
      worldY: layer.transform.z * SCENE_SCALE,
      worldZ: (layer.transform.y - artboardHeight / 2) * SCENE_SCALE,
    })

    for (const id of order) {
      const layer = layers[id]
      if (!layer || layer.isHole || !layer.visible) continue
      const solidBounds = shapeWorldBounds(layer)
      const overlappingHoles = holeIds.filter((hid) => hid !== id && rectsOverlap(solidBounds, shapeWorldBounds(layers[hid])))
      if (overlappingHoles.length === 0) continue

      const solidWorld = toWorld(layer)
      const holeGeoms = overlappingHoles.flatMap((hid) => {
        const holeLayer = layers[hid]
        const holeWorld = toWorld(holeLayer)
        return buildLayerGeometries(holeLayer, SCENE_SCALE).map((geometry) => ({ geometry, ...holeWorld }))
      })

      try {
        result[id] = buildLayerGeometries(layer, SCENE_SCALE).map((geo) =>
          cutHolesFromSolid({ geometry: geo, ...solidWorld }, holeGeoms),
        )
      } catch (err) {
        // CSG on arbitrary/degenerate geometry is inherently best-effort —
        // fall back to rendering this one shape uncut rather than taking
        // the whole viewport down with it.
        console.error(`Hole cut failed for shape ${id}, rendering it uncut instead:`, err)
      }
    }
    return result
  }, [layers, order, artboardWidth, artboardHeight])

  return (
    <div className="viewport-3d">
      <Canvas
        camera={{ position: [bedWidth * 1.4, bedWidth * 1.1, bedWidth * 1.4], fov: 40 }}
        onPointerMissed={() => setSelection([])}
      >
        <color attach="background" args={['#0a0a0b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[bedWidth * 2, bedWidth * 3, bedWidth]} intensity={1.1} castShadow />

        <PrinterPlate width={bedWidth} depth={bedDepth} widthMM={artboardWidth} depthMM={artboardHeight} />

        {order.map((id) => {
          const layer = layers[id]
          if (!layer) return null
          return (
            <ExtrudedShapeMesh
              key={id}
              layer={layer}
              isSelected={selection.includes(id)}
              wireframe={wireframe}
              onSelect={handleSelect}
              artboardWidth={artboardWidth}
              artboardHeight={artboardHeight}
              cutGeometries={cutGeometriesById[id]}
            />
          )
        })}

        <Grid
          position={[0, -bedWidth * 0.02, 0]}
          args={[bedWidth, bedDepth]}
          cellColor="#1f1f26"
          sectionColor="#2b2b34"
          fadeDistance={bedWidth * 6}
          infiniteGrid
        />

        <OrbitControls ref={controlsRef} makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport axisColors={['#ff5c5c', '#7bd88f', '#4d8dff']} labelColor="black" />
        </GizmoHelper>
      </Canvas>

      <div className="viewport-3d__controls">
        <IconButton size="sm" active={wireframe} aria-label="Toggle wireframe" onClick={() => setWireframe((v) => !v)}>
          <Box size={15} />
        </IconButton>
        <IconButton size="sm" aria-label="Reset view" onClick={() => controlsRef.current?.reset()}>
          <Maximize size={15} />
        </IconButton>
      </div>

      <div className="viewport-3d__zoom">
        <IconButton size="sm" aria-label="Zoom out" onClick={() => controlsRef.current?.dollyOut(1.2)}>
          <ZoomOut size={14} />
        </IconButton>
        <span>{order.length} shapes</span>
        <IconButton size="sm" aria-label="Zoom in" onClick={() => controlsRef.current?.dollyIn(1.2)}>
          <ZoomIn size={14} />
        </IconButton>
      </div>
    </div>
  )
}
