import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls, TransformControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl, TransformControls as TransformControlsImpl } from 'three-stdlib'
import { ArrowDownToLine, Box, Layers2, Maximize, Move3d, Rotate3d, ZoomIn, ZoomOut } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { expandToGroup, shapeWorldBounds, useDocumentStore } from '../../state/documentStore'
import type { Bounds } from '../../types/document'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import {
  buildLayerGeometries,
  layerPrintQuaternion,
  layerZRange,
  printQuaternionToEuler,
  sceneRotationToPrint,
} from '../../lib/geometry/layerGeometry'
import { cutHolesFromSolid } from '../../lib/geometry/holeCut'
import { unitRest } from '../../lib/geometry/stacking'
import { SCENE_SCALE } from './sceneScale'
import { ExtrudedShapeMesh } from './ExtrudedShapeMesh'
import { PrinterPlate } from './PrinterPlate'
import { PrintPreviewSlider } from './PrintPreviewSlider'
import { PreviewCaps, type PreviewCapItem } from './PreviewCaps'
import { RotationDial } from '../inspector/RotationDial'
import { useAnalysisStore } from '../../state/analysisStore'
import { useViewStore } from '../../state/viewStore'
import './Viewport3DPane.css'

function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

interface GizmoDrag {
  startPosition: THREE.Vector3
  starts: Record<string, { x: number; y: number; z: number; q: THREE.Quaternion }>
}

export function Viewport3DPane() {
  const [wireframe, setWireframe] = useState(false)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const [gizmoTarget, setGizmoTarget] = useState<THREE.Group | null>(null)
  const dragRef = useRef<GizmoDrag | null>(null)
  const transformRef = useRef<TransformControlsImpl>(null)
  const lastGizmoDragEnd = useRef(0)

  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const selection = useDocumentStore((s) => s.selection)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const setRotation = useDocumentStore((s) => s.setRotation)
  const restOnShapeBelow = useDocumentStore((s) => s.restOnShapeBelow)
  const dropToBed = useDocumentStore((s) => s.dropToBed)
  const beginTransientEdit = useDocumentStore((s) => s.beginTransientEdit)
  const commitTransientEdit = useDocumentStore((s) => s.commitTransientEdit)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const printSettings = useDocumentStore((s) => s.printSettings)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const bed = getBedPreset(bedPresetId)
  const artboardWidth = bed?.width ?? customBedWidth
  const artboardHeight = bed?.height ?? customBedHeight
  const bedWidth = artboardWidth * SCENE_SCALE
  const bedDepth = artboardHeight * SCENE_SCALE
  const warnings = useAnalysisStore((s) => s.warnings)
  const dismissed = useAnalysisStore((s) => s.dismissed)
  const dismiss = useAnalysisStore((s) => s.dismiss)
  const activeWarnings = warnings.filter((w) => layers[w.id] && !(w.severity === 'partial' && dismissed.includes(w.id)))
  const warningById = new Map(activeWarnings.map((w) => [w.id, w.severity] as const))

  const printPreview = useViewStore((s) => s.printPreview)
  const previewHeightState = useViewStore((s) => s.previewHeight)
  const setPreviewHeight = useViewStore((s) => s.setPreviewHeight)
  const setPrintPreview = useViewStore((s) => s.setPrintPreview)
  const gizmoMode = useViewStore((s) => s.gizmoMode)
  const setGizmoMode = useViewStore((s) => s.setGizmoMode)

  // A pointer that is on (or has just used) a gizmo handle must never
  // re-select whatever mesh happens to sit under it — otherwise a bigger
  // shape around the selected one steals the selection mid-drag.
  const gizmoBusy = () => {
    // `axis` (hovered handle) and `dragging` are typed private in three-stdlib
    // but are the documented runtime state of TransformControls.
    const tc = transformRef.current as unknown as { axis: string | null; dragging: boolean } | null
    return !!tc?.axis || !!tc?.dragging || performance.now() - lastGizmoDragEnd.current < 300
  }

  // Group-aware like the 2D canvas: clicking one member picks the whole
  // group; clicking a member of the already-selected group (or Cmd/Ctrl-
  // clicking) digs into that single member.
  const handleSelect = (id: string, additive: boolean, single = false) => {
    if (gizmoBusy()) return
    const group = expandToGroup(layers, order, id)
    const groupIsTheSelection = group.length > 1 && group.every((t) => selection.includes(t)) && selection.every((s) => group.includes(s))
    const targets = single || (groupIsTheSelection && !additive) ? [id] : group
    // Clicking something already selected keeps the selection as it is (so
    // a drilled-in member stays the selection).
    if (!additive && !single && !groupIsTheSelection && selection.includes(id)) return
    if (additive) {
      const has = targets.every((t) => selection.includes(t))
      setSelection(has ? selection.filter((sid) => !targets.includes(sid)) : [...selection, ...targets.filter((t) => !selection.includes(t))])
    } else {
      setSelection(targets)
    }
  }

  // The gizmo attaches to the first selected shape; every selected shape
  // follows it by the same delta.
  const primary = selection.map((id) => layers[id]).find((l) => l && l.visible && !l.locked) ?? null

  // Real Z range of every printable shape — the print preview's full
  // height, and the per-shape shell-layer bands for its cross-sections.
  const zRanges = useMemo(() => {
    const result: Record<string, { bottomZ: number; topZ: number }> = {}
    for (const id of order) {
      const layer = layers[id]
      if (!layer || layer.isHole || !layer.visible) continue
      result[id] = layerZRange(layer)
    }
    return result
  }, [layers, order])
  const sceneTopZ = Math.max(printSettings.layerHeight, ...Object.values(zRanges).map((r) => r.topZ))
  const previewHeight = printPreview ? Math.min(previewHeightState ?? sceneTopZ, sceneTopZ) : null
  // The plane sits a hair above the cut so a top face lying exactly on a
  // layer boundary (every shape at full height) isn't half-discarded by
  // precision noise in the clip test.
  const CLIP_EPSILON_MM = 0.01
  const clippingPlanes = useMemo(
    () => (previewHeight == null ? undefined : [new THREE.Plane(new THREE.Vector3(0, -1, 0), (previewHeight + CLIP_EPSILON_MM) * SCENE_SCALE)]),
    [previewHeight],
  )

  const onGizmoDown = () => {
    if (!gizmoTarget) return
    beginTransientEdit()
    const state = useDocumentStore.getState()
    const starts: GizmoDrag['starts'] = {}
    for (const id of state.selection) {
      const l = state.layers[id]
      if (l && l.visible && !l.locked) starts[id] = { x: l.transform.x, y: l.transform.y, z: l.transform.z, q: layerPrintQuaternion(l) }
    }
    dragRef.current = { startPosition: gizmoTarget.position.clone(), starts }
  }

  const onGizmoChange = () => {
    const drag = dragRef.current
    if (!drag || !gizmoTarget || !primary) return
    const state = useDocumentStore.getState()
    const ids = Object.keys(drag.starts)
    if (gizmoMode === 'translate') {
      const d = gizmoTarget.position.clone().sub(drag.startPosition)
      const ddx = d.x / SCENE_SCALE
      const ddy = d.z / SCENE_SCALE
      // Nothing may be pushed under the plate: clamp the whole selection's
      // lift by the lowest shape in it.
      const lowest = Math.min(...ids.map((id) => drag.starts[id].z))
      const ddz = Math.max(d.y / SCENE_SCALE, -lowest)
      const start = drag.starts[primary.id]
      const current = state.layers[primary.id]
      if (start && current) state.moveShapesBy(ids, start.x + ddx - current.transform.x, start.y + ddy - current.transform.y)
      for (const id of ids) state.setLayerZ(id, drag.starts[id].z + ddz)
      gizmoTarget.position.y = drag.startPosition.y + ddz * SCENE_SCALE
    } else {
      // The group's geometry is built with its rotation baked in, so the
      // gizmo's rotation is a pure delta from the drag start: apply it in
      // the print frame on top of each shape's starting orientation, then
      // hand the group back to identity so nothing rotates twice.
      const delta = sceneRotationToPrint(gizmoTarget.quaternion)
      for (const id of ids) setRotation(id, printQuaternionToEuler(delta.clone().multiply(drag.starts[id].q)))
      gizmoTarget.quaternion.identity()
    }
  }

  const onGizmoUp = () => {
    lastGizmoDragEnd.current = performance.now()
    if (!dragRef.current) return
    dragRef.current = null
    commitTransientEdit()
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

  // What the print preview caps: the same geometry each shape renders
  // with (hole-cut where applicable), so the cross-section matches.
  const previewItems = useMemo((): PreviewCapItem[] => {
    if (!printPreview) return []
    return order.flatMap((id) => {
      const layer = layers[id]
      const range = zRanges[id]
      if (!layer || !range) return []
      return [
        {
          id,
          geometries: cutGeometriesById[id] ?? buildLayerGeometries(layer, SCENE_SCALE),
          origin: [
            (layer.transform.x - artboardWidth / 2) * SCENE_SCALE,
            layer.transform.z * SCENE_SCALE,
            (layer.transform.y - artboardHeight / 2) * SCENE_SCALE,
          ] as [number, number, number],
          color: layer.color,
          bottomZ: range.bottomZ,
          topZ: range.topZ,
          hasHoles: !!cutGeometriesById[id],
        },
      ]
    })
  }, [printPreview, order, layers, zRanges, cutGeometriesById, artboardWidth, artboardHeight])

  const t = primary?.transform

  return (
    <div className="viewport-3d">
      <Canvas
        camera={{ position: [bedWidth * 1.4, bedWidth * 1.1, bedWidth * 1.4], fov: 40 }}
        gl={{ localClippingEnabled: true, stencil: true }}
        onPointerMissed={() => {
          if (!gizmoBusy()) setSelection([])
        }}
      >
        <color attach="background" args={['#0a0a0b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[bedWidth * 2, bedWidth * 3, bedWidth]} intensity={1.1} castShadow />

        <PrinterPlate width={bedWidth} depth={bedDepth} widthMM={artboardWidth} depthMM={artboardHeight} />

        {order.map((id) => {
          const layer = layers[id]
          if (!layer) return null
          // A print shows the pocket a hole leaves, not the cutter itself.
          if (layer.isHole && printPreview) return null
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
              warning={warningById.get(id)}
              clippingPlanes={clippingPlanes}
              onGroupRef={primary?.id === id ? setGizmoTarget : undefined}
            />
          )
        })}

        {previewHeight != null && clippingPlanes && (
          <>
            <PreviewCaps
              items={previewItems}
              height={previewHeight}
              settings={printSettings}
              clippingPlanes={clippingPlanes}
              bedWidth={bedWidth}
              bedDepth={bedDepth}
            />
            <mesh rotation-x={-Math.PI / 2} position-y={previewHeight * SCENE_SCALE - 0.0005} renderOrder={1}>
              <planeGeometry args={[bedWidth, bedDepth]} />
              <meshBasicMaterial color="#4d8dff" transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          </>
        )}

        {primary && gizmoTarget && !printPreview && (
          <TransformControls
            ref={transformRef}
            object={gizmoTarget}
            mode={gizmoMode}
            space="world"
            size={0.7}
            onMouseDown={onGizmoDown}
            onObjectChange={onGizmoChange}
            onMouseUp={onGizmoUp}
          />
        )}

        <Grid
          position={[0, -bedWidth * 0.02, 0]}
          args={[bedWidth, bedDepth]}
          cellColor="#1f1f26"
          sectionColor="#2b2b34"
          fadeDistance={bedWidth * 6}
          infiniteGrid
        />

        <OrbitControls ref={controlsRef} makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          {/* Face order is +X, −X, +Y, −Y, +Z, −Z in the scene frame: Y is
              up, and document Y (toward the printer's door) runs along +Z. */}
          <group scale={1.25}>
            <GizmoViewcube
              faces={['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']}
              color="#3b3c48"
              hoverColor="#4d8dff"
              textColor="#ffffff"
              strokeColor="#c4c6d4"
              opacity={1}
              font="26px Inter, system-ui, sans-serif"
            />
          </group>
        </GizmoHelper>
      </Canvas>

      {activeWarnings.length > 0 && (
        <div className="viewport-3d__alerts" role="status">
          {activeWarnings.map((w) => (
            <div key={w.id} className={`viewport-3d__alert viewport-3d__alert--${w.severity}`}>
              <button type="button" className="viewport-3d__alert-name" onClick={() => setSelection([w.id])}>
                {layers[w.id].name}
              </button>
              <span>
                {w.severity === 'critical'
                  ? w.supporterIds.length === 0 || Math.round(w.supportedFraction * 100) === 0
                    ? 'is floating'
                    : `barely touches what's under it (${Math.round(w.supportedFraction * 100)}%)`
                  : `rests on only ${Math.round(w.supportedFraction * 100)}%`}
              </span>
              <span className="viewport-3d__alert-actions">
                {(() => {
                  // A grouped shape moves with its whole group.
                  const unit = expandToGroup(layers, order, w.id)
                  const rest = unitRest(unit, layers, order)
                  const label = unit.length > 1 ? ' (group)' : ''
                  return (
                    <>
                      {rest && (
                        <button type="button" title={`Rest on ${layers[rest.supporterId]?.name}${label}`} onClick={() => restOnShapeBelow(unit)}>
                          <Layers2 size={12} /> Rest on {layers[rest.supporterId]?.name}
                          {label}
                        </button>
                      )}
                      <button type="button" title={`Drop to bed${label}`} onClick={() => dropToBed(unit)}>
                        <ArrowDownToLine size={12} /> Drop to bed{label}
                      </button>
                    </>
                  )
                })()}
              </span>
              {w.severity === 'partial' && (
                <button type="button" className="viewport-3d__alert-dismiss" aria-label="Dismiss warning" onClick={() => dismiss(w.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="viewport-3d__controls">
        <IconButton size="sm" active={gizmoMode === 'translate'} aria-label="Move tool" title="Move (drag the arrows)" onClick={() => setGizmoMode('translate')}>
          <Move3d size={15} />
        </IconButton>
        <IconButton size="sm" active={gizmoMode === 'rotate'} aria-label="Rotate tool" title="Rotate (drag the rings)" onClick={() => setGizmoMode('rotate')}>
          <Rotate3d size={15} />
        </IconButton>
        <div className="viewport-3d__controls-divider" />
        <IconButton size="sm" active={wireframe} aria-label="Toggle wireframe" onClick={() => setWireframe((v) => !v)}>
          <Box size={15} />
        </IconButton>
        <IconButton size="sm" aria-label="Reset view" onClick={() => controlsRef.current?.reset()}>
          <Maximize size={15} />
        </IconButton>
      </div>

      {printPreview && previewHeight != null && (
        <PrintPreviewSlider
          maxHeight={sceneTopZ}
          value={previewHeight}
          layerHeight={printSettings.layerHeight}
          onChange={setPreviewHeight}
          onClose={() => setPrintPreview(false)}
        />
      )}

      {primary && t && (
        <div className="viewport-3d__orient" aria-label="Orientation">
          <RotationDial layer={primary} size={72} />
          <div className="viewport-3d__orient-readout">
            <span className="viewport-3d__orient-name">{primary.name}</span>
            <span>
              X {Math.round(t.rotationX)}° · Y {Math.round(t.rotationY)}° · Z {Math.round(t.rotation)}°
            </span>
            {(t.rotationX || t.rotationY || t.rotation) ? (
              <button type="button" onClick={() => setRotation(primary.id, { x: 0, y: 0, z: 0 })}>
                Reset
              </button>
            ) : null}
          </div>
        </div>
      )}

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
