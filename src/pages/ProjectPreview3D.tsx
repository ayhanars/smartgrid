import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { useViewStore } from '../state/viewStore'
import type { DocumentSnapshot } from '../lib/persistence/localProjects'
import { getBedPreset } from '../lib/geometry/bedPresets'
import { SCENE_SCALE } from '../features/viewport-3d/sceneScale'
import { ExtrudedShapeMesh } from '../features/viewport-3d/ExtrudedShapeMesh'
import { activeHoleIds, useCutGeometries } from '../features/viewport-3d/useCutGeometries'
import { PrinterPlate } from '../features/viewport-3d/PrinterPlate'
import { shapeWorldBounds } from '../lib/geometry/layerBounds'
import { layerZRange } from '../lib/geometry/layerGeometry'
import { type Plate, defaultPlates, layerPlateId } from '../state/documentStore'
import { plateOffset } from '../features/viewport-3d/GhostPlate'
import type { ShapeLayer } from '../types/document'

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

/** One plate of the preview: its bed and its shapes with their real cuts. */
function PreviewPlate({
  offset,
  layers,
  order,
  artboardWidth,
  artboardHeight,
  bedWidth,
  bedDepth,
  tileVersion,
}: {
  plate: Plate
  offset: number
  layers: Record<string, ShapeLayer>
  order: string[]
  artboardWidth: number
  artboardHeight: number
  bedWidth: number
  bedDepth: number
  tileVersion: number
}) {
  // Same rule as the editor: a cutter busy cutting something is not drawn
  // as a ghost over it (with nothing selected here, that's every one).
  const visible = useMemo(() => {
    const active = activeHoleIds(layers, order)
    return order.map((id) => layers[id]).filter((l) => l && l.visible && !(l.isHole && active.has(l.id)))
  }, [layers, order])
  // The same CSG the editor runs, so holes, perforation and hollowing show.
  const { cutGeometriesById, uncutGeometriesById } = useCutGeometries(layers, order, artboardWidth, artboardHeight, tileVersion)
  return (
    <group position={[offset, 0, 0]}>
      <PrinterPlate width={bedWidth} depth={bedDepth} widthMM={artboardWidth} depthMM={artboardHeight} />
      {visible.map((layer) => (
        <ExtrudedShapeMesh
          key={layer.id}
          layer={layer}
          isSelected={false}
          wireframe={false}
          onSelect={() => {}}
          artboardWidth={artboardWidth}
          artboardHeight={artboardHeight}
          cutGeometries={cutGeometriesById[layer.id]}
          outlineGeometries={uncutGeometriesById[layer.id]}
        />
      ))}
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

  const plates = useMemo(() => (snapshot.plates && snapshot.plates.length > 0 ? snapshot.plates : defaultPlates()), [snapshot])
  const tileVersion = useViewStore((s) => s.tileVersion)

  // Frame every plate's shapes (fall back to the plate on an empty project).
  const { center, radius } = useMemo(() => {
    const box = new THREE.Box3()
    for (const id of snapshot.order) {
      const l = snapshot.layers[id]
      if (!l || !l.visible || l.isHole) continue
      const dx = plateOffset(plates.findIndex((p) => p.id === layerPlateId(l, plates)), bedWidth)
      const b = shapeWorldBounds(l)
      const z = layerZRange(l)
      box.expandByPoint(new THREE.Vector3((b.x - artboardWidth / 2) * SCENE_SCALE + dx, z.bottomZ * SCENE_SCALE, (b.y - artboardHeight / 2) * SCENE_SCALE))
      box.expandByPoint(new THREE.Vector3((b.x + b.width - artboardWidth / 2) * SCENE_SCALE + dx, z.topZ * SCENE_SCALE, (b.y + b.height - artboardHeight / 2) * SCENE_SCALE))
    }
    if (box.isEmpty()) return { center: new THREE.Vector3(0, 0, 0), radius: Math.max(bedWidth, bedDepth) * 0.6 }
    const size = box.getSize(new THREE.Vector3())
    return { center: box.getCenter(new THREE.Vector3()), radius: Math.max(size.x, size.z, size.y * 1.5, bedWidth * 0.12) * 0.75 }
  }, [snapshot, plates, artboardWidth, artboardHeight, bedWidth, bedDepth])

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
      <ambientLight intensity={0.25} />
      <directionalLight position={[bedWidth * 2, bedWidth * 3, bedWidth]} intensity={1.4} />
      <directionalLight position={[-bedWidth * 2, bedWidth * 1.5, -bedWidth * 2]} intensity={0.35} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[6, 3, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[-6, 2, -2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="ring" intensity={1.5} position={[0, 2, -8]} scale={4} color="#b9c6ff" />
      </Environment>
      <Turntable center={center}>
        {plates.map((plate, i) => (
          <PreviewPlate
            key={plate.id}
            plate={plate}
            offset={plateOffset(i, bedWidth)}
            layers={snapshot.layers}
            order={snapshot.order.filter((id) => snapshot.layers[id] && layerPlateId(snapshot.layers[id], plates) === plate.id)}
            artboardWidth={artboardWidth}
            artboardHeight={artboardHeight}
            bedWidth={bedWidth}
            bedDepth={bedDepth}
            tileVersion={tileVersion}
          />
        ))}
      </Turntable>
    </Canvas>
  )
}
