import { useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import type { AssetDefinition } from '../../lib/assets/types'
import { buildAssetLayers } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { DEFAULT_PRINT_SETTINGS } from '../../types/document'
import { SCENE_SCALE } from '../viewport-3d/sceneScale'
import { ExtrudedShapeMesh } from '../viewport-3d/ExtrudedShapeMesh'
import { activeHoleIds, useCutGeometries } from '../viewport-3d/useCutGeometries'
import { layerZRange } from '../../lib/geometry/layerGeometry'

/** A still 3D render of an asset for the hover card: the same meshes the
 * editor would place, framed from a three-quarter view, no turntable. */
export function AssetPreview3D({ asset }: { asset: AssetDefinition }) {
  const tileVersion = useViewStore((s) => s.tileVersion)
  // Built at the artboard origin; the artboard is the asset's own footprint.
  const built = useMemo(() => buildAssetLayers(asset, { x: 0, y: 0 }, DEFAULT_PRINT_SETTINGS.layerHeight), [asset])
  const artboardWidth = Math.max(1, asset.width)
  const artboardHeight = Math.max(1, asset.height)
  const { cutGeometriesById, uncutGeometriesById } = useCutGeometries(built.layers, built.order, artboardWidth, artboardHeight, tileVersion)
  const active = useMemo(() => activeHoleIds(built.layers, built.order), [built])
  const visible = built.order.map((id) => built.layers[id]).filter((l) => !(l.isHole && active.has(l.id)))

  const height = Math.max(1, ...visible.filter((l) => !l.isHole).map((l) => layerZRange(l).topZ))
  const w = artboardWidth * SCENE_SCALE
  const d = artboardHeight * SCENE_SCALE
  const h = height * SCENE_SCALE
  const radius = Math.max(w, d, h * 1.5) * 0.75
  const dist = radius * 2.2
  const center = new THREE.Vector3(0, h / 2, 0)

  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop="demand"
      camera={{ position: [dist * 0.8, dist * 0.7 + center.y, dist * 0.8], fov: 35, near: 0.01, far: 100 }}
      onCreated={({ camera }) => camera.lookAt(center)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0a0a0b']} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[w * 2, w * 3, w]} intensity={1.4} />
      <directionalLight position={[-w * 2, w * 1.5, -w * 2]} intensity={0.35} />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.5} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[6, 3, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
      </Environment>
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
    </Canvas>
  )
}
