import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import type { DocumentSnapshot } from '../lib/persistence/localProjects'
import { getBedPreset } from '../lib/geometry/bedPresets'
import { SCENE_SCALE } from '../features/viewport-3d/sceneScale'
import { ExtrudedShapeMesh } from '../features/viewport-3d/ExtrudedShapeMesh'
import { activeHoleIds } from '../features/viewport-3d/useCutGeometries'
import { PrinterPlate } from '../features/viewport-3d/PrinterPlate'
import { shapeWorldBounds } from '../lib/geometry/layerBounds'
import { layerZRange } from '../lib/geometry/layerGeometry'

/** Slow turntable so the hover preview reads as 3D at a glance. */
function Turntable({ children, center }: { children: React.ReactNode; center: THREE.Vector3 }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.35
  })
  return (
    <group ref={ref} position={[0, 0, 0]}>
      <group position={[-center.x, 0, -center.z]}>{children}</group>
    </group>
  )
}

/**
 * A small live 3D render of a saved project for the home page — the same
 * meshes the editor draws, on a turntable, framed on the shapes. Mounted
 * only while a card is hovered, so the page stays light.
 */
export function ProjectPreview3D({ snapshot }: { snapshot: DocumentSnapshot }) {
  const bed = getBedPreset(snapshot.bedPresetId)
  const artboardWidth = bed?.width ?? snapshot.customBedWidth
  const artboardHeight = bed?.height ?? snapshot.customBedHeight
  const bedWidth = artboardWidth * SCENE_SCALE
  const bedDepth = artboardHeight * SCENE_SCALE

  // Same rule as the editor: a cutter busy cutting something is not drawn
  // as a ghost over it (with nothing selected here, that's every one).
  const layers = useMemo(() => {
    const active = activeHoleIds(snapshot.layers, snapshot.order)
    return snapshot.order.map((id) => snapshot.layers[id]).filter((l) => l && l.visible && !(l.isHole && active.has(l.id)))
  }, [snapshot])

  // Frame the shapes (fall back to the plate on an empty project).
  const { center, radius } = useMemo(() => {
    const box = new THREE.Box3()
    for (const l of layers) {
      if (l.isHole) continue
      const b = shapeWorldBounds(l)
      const z = layerZRange(l)
      box.expandByPoint(new THREE.Vector3((b.x - artboardWidth / 2) * SCENE_SCALE, z.bottomZ * SCENE_SCALE, (b.y - artboardHeight / 2) * SCENE_SCALE))
      box.expandByPoint(new THREE.Vector3((b.x + b.width - artboardWidth / 2) * SCENE_SCALE, z.topZ * SCENE_SCALE, (b.y + b.height - artboardHeight / 2) * SCENE_SCALE))
    }
    if (box.isEmpty()) return { center: new THREE.Vector3(0, 0, 0), radius: Math.max(bedWidth, bedDepth) * 0.6 }
    const size = box.getSize(new THREE.Vector3())
    return { center: box.getCenter(new THREE.Vector3()), radius: Math.max(size.x, size.z, size.y * 1.5, bedWidth * 0.12) * 0.75 }
  }, [layers, artboardWidth, artboardHeight, bedWidth, bedDepth])

  const dist = radius * 2.2
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [dist * 0.8, dist * 0.7 + center.y, dist * 0.8], fov: 35, near: 0.01, far: 100 }}
      onCreated={({ camera }) => camera.lookAt(0, center.y, 0)}
      gl={{ antialias: true }}
      frameloop="always"
    >
      <color attach="background" args={['#0a0a0b']} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[bedWidth * 2, bedWidth * 3, bedWidth]} intensity={1.1} />
      <Turntable center={center}>
        <PrinterPlate width={bedWidth} depth={bedDepth} widthMM={artboardWidth} depthMM={artboardHeight} />
        {layers.map((layer) => (
          <ExtrudedShapeMesh
            key={layer.id}
            layer={layer}
            isSelected={false}
            wireframe={false}
            onSelect={() => {}}
            artboardWidth={artboardWidth}
            artboardHeight={artboardHeight}
          />
        ))}
      </Turntable>
    </Canvas>
  )
}
