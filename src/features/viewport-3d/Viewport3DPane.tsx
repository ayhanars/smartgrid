import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, RoundedBox } from '@react-three/drei'
import { Maximize, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import './Viewport3DPane.css'

export function Viewport3DPane() {
  const [wireframe, setWireframe] = useState(false)

  return (
    <div className="viewport-3d">
      <Canvas camera={{ position: [4, 3.5, 5], fov: 40 }}>
        <color attach="background" args={['#0a0a0b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />

        <RoundedBox args={[2.4, 0.5, 1.6]} radius={0.08} smoothness={4} position={[0, 0.25, 0]}>
          <meshStandardMaterial color="#4d8dff" wireframe={wireframe} />
        </RoundedBox>
        <RoundedBox args={[0.5, 0.9, 0.5]} radius={0.06} smoothness={4} position={[0.6, 0.7, 0]}>
          <meshStandardMaterial color="#7bd88f" wireframe={wireframe} />
        </RoundedBox>

        <Grid
          position={[0, 0, 0]}
          args={[10, 10]}
          cellColor="#28282f"
          sectionColor="#35353e"
          fadeDistance={14}
          infiniteGrid
        />

        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport axisColors={['#ff5c5c', '#7bd88f', '#4d8dff']} labelColor="black" />
        </GizmoHelper>
      </Canvas>

      <div className="viewport-3d__controls">
        <IconButton size="sm" active={wireframe} aria-label="Toggle wireframe" onClick={() => setWireframe((v) => !v)}>
          <Scan size={15} />
        </IconButton>
        <IconButton size="sm" aria-label="Reset view">
          <Maximize size={15} />
        </IconButton>
      </div>

      <div className="viewport-3d__zoom">
        <IconButton size="sm" aria-label="Zoom out">
          <ZoomOut size={14} />
        </IconButton>
        <span>100%</span>
        <IconButton size="sm" aria-label="Zoom in">
          <ZoomIn size={14} />
        </IconButton>
      </div>
    </div>
  )
}
