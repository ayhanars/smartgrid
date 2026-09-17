import { useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { Box, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useDocumentStore } from '../../state/documentStore'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { SCENE_SCALE } from './sceneScale'
import { ExtrudedShapeMesh } from './ExtrudedShapeMesh'
import './Viewport3DPane.css'

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

  return (
    <div className="viewport-3d">
      <Canvas
        camera={{ position: [bedWidth * 1.4, bedWidth * 1.1, bedWidth * 1.4], fov: 40 }}
        onPointerMissed={() => setSelection([])}
      >
        <color attach="background" args={['#0a0a0b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[bedWidth * 2, bedWidth * 3, bedWidth]} intensity={1.1} castShadow />

        <mesh position={[0, -0.01, 0]}>
          <boxGeometry args={[bedWidth, 0.02, bedDepth]} />
          <meshStandardMaterial color="#1b1c22" />
        </mesh>

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
            />
          )
        })}

        <Grid
          position={[0, 0, 0]}
          args={[bedWidth, bedDepth]}
          cellColor="#28282f"
          sectionColor="#35353e"
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
