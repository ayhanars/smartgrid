import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import { DEFAULT_PRINT_SETTINGS, type Bounds, type Point2, type PrintSettings, type ShapeKind, type Perforation, type ShapeLayer, type SurfaceTexture } from '../types/document'
import type { DocumentSnapshot } from '../lib/persistence/localProjects'
import type { ImportedShape } from '../lib/import/svgImport'
import { createShapeRegions, contourBounds, defaultShapeName } from '../lib/geometry/primitives'
import { rotatedLocalPoints, shapeWorldBounds } from '../lib/geometry/layerBounds'
import { restingHeight, unitDropDelta, unitRest } from '../lib/geometry/stacking'
import { buildShellCavity, type ShellOptions } from '../lib/geometry/shell'
import { buildLayerCutters, buildLayerGeometries } from '../lib/geometry/layerGeometry'
import { cutHolesFromSolid } from '../lib/geometry/holeCut'

export { rotatedLocalPoints, shapeWorldBounds }
import { DEFAULT_BED_ID, getBedPreset } from '../lib/geometry/bedPresets'
import { applyBooleanOp, type BooleanOp } from '../lib/geometry/boolean'

let idCounter = 0
function generateId() {
  idCounter += 1
  return `shape-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
}

/** Same bounding-box overlap test the actual 3D hole/solid cut uses (see
 * ExtrudedShapeMesh) — real XY footprint overlap, not just "on the same
 * plate". */
function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export interface CarveOptions {
  /** inplace: cut exactly where the tool sits now; top/bottom: a pocket of
   * `depth` mm from that face; through: the whole height. */
  mode: 'inplace' | 'top' | 'bottom' | 'through'
  depth?: number
}

export interface Guide {
  id: string
  orientation: 'horizontal' | 'vertical'
  /** Document mm position: Y for a horizontal guide, X for a vertical one. */
  position: number
}

export interface ShapeGroup {
  id: string
  name: string
}

interface DocumentState {
  layers: Record<string, ShapeLayer>
  groups: Record<string, ShapeGroup>
  /** Back-to-front draw order (also top-to-bottom in the Layers panel, reversed for display). */
  order: string[]
  selection: string[]
  /** Document-level, not per-shape — applies regardless of what's selected. */
  bedPresetId: string
  pinnedBedPresetId: string | null
  /** Only meaningful when bedPresetId === CUSTOM_BED_ID. */
  customBedWidth: number
  customBedHeight: number
  guides: Guide[]
  rulersVisible: boolean
  /** Display-only unit for every mm field in the inspector — the store
   * itself always keeps values in mm regardless of this. */
  displayUnit: 'mm' | 'cm' | 'in'
  /** The local project this document is saved as (null before a project
   * has been opened, e.g. in tests). */
  projectId: string | null
  projectName: string
  printSettings: PrintSettings
}

interface DocumentActions {
  setProjectName: (name: string) => void
  setPrintSettings: (patch: Partial<PrintSettings>) => void
  /** Replaces the whole document with a saved snapshot and wipes undo
   * history, so "undo" can never walk back into a different project. */
  loadDocument: (projectId: string, snapshot: DocumentSnapshot) => void
  addShape: (kind: ShapeKind, bounds: Bounds) => string
  addPenShape: (documentSpacePoints: Point2[]) => string
  moveShapesBy: (ids: string[], dx: number, dy: number) => void
  resizeShape: (id: string, bounds: Bounds) => void
  duplicateShapes: (ids: string[]) => string[]
  pasteShapes: (sourceLayers: ShapeLayer[]) => string[]
  /** Adds shapes redrawn from an imported file (see svgImport.ts) with
   * their top-left corner at `origin`, grouped when there are several. */
  addImportedShapes: (shapes: ImportedShape[], origin: Point2, groupName?: string) => string[]
  removeShapes: (ids: string[]) => void
  setSelection: (ids: string[]) => void
  toggleVisibility: (id: string) => void
  toggleLocked: (id: string) => void
  setColor: (id: string, color: string) => void
  setOpacity: (id: string, opacity: number) => void
  setExtrusionDepth: (id: string, depth: number) => void
  setCornerRadius: (id: string, radius: number) => void
  setSmartPolish: (id: string, intensity: number) => void
  setBevelBottom: (id: string, amount: number) => void
  setBevelTop: (id: string, amount: number) => void
  setLayerZ: (id: string, z: number) => void
  /** Perfect Fit: lift each shape so its bottom sits exactly on the top of
   * whatever solid lies under its footprint (no-op for a shape with
   * nothing under it). */
  restOnShapeBelow: (ids: string[]) => void
  /** Perfect Fit: put each shape's bottom on the bed. */
  dropToBed: (ids: string[]) => void
  setRotation: (id: string, rotation: { x?: number; y?: number; z?: number }) => void
  /** Wraps a continuous drag (dial, slider) so it lands in undo history as
   * ONE step instead of hundreds — begin on pointer-down, commit on
   * pointer-up. Commit is a no-op for history if nothing changed. */
  beginTransientEdit: () => void
  commitTransientEdit: () => void
  snapHoleToPocket: (id: string, floorThicknessMM: number) => void
  /** Shell: adds a hole object that hollows the solid out to walls of the
   * given thickness (floor rounded up to whole print layers), grouped with
   * it. Returns the new cavity's id, or null if the outline is too narrow. */
  hollowOut: (id: string, options: ShellOptions) => { cavityId: string; wall: number } | null
  /** Surface relief on a shape; null removes it. */
  setTexture: (id: string, texture: SurfaceTexture | null) => void
  /** Pattern of real holes on a shape; null removes it. */
  setPerforation: (id: string, perforation: Perforation | null) => void
  /** How a cutter's bevels are read (see ShapeLayer.bevelMode). */
  setBevelMode: (id: string, mode: 'rim' | 'shape') => void
  /** Carve: turns `toolId` into a hole cutter positioned against `baseId`
   * (from its top, from its bottom, or right through) and groups the two,
   * so the pair reads and moves as one object. */
  carveWith: (baseId: string, toolId: string, options: CarveOptions) => void
  setBedPreset: (id: string) => void
  togglePinnedBedPreset: (id: string) => void
  setCustomBedSize: (width: number, height: number) => void
  setDisplayUnit: (unit: DocumentState['displayUnit']) => void
  applyBoolean: (op: BooleanOp) => void
  addGuide: (orientation: Guide['orientation'], position: number) => string
  updateGuidePosition: (id: string, position: number) => void
  removeGuide: (id: string) => void
  toggleRulersVisible: () => void
  alignShapes: (ids: string[], mode: AlignMode) => void
  groupShapes: (ids: string[]) => string | null
  ungroupShapes: (ids: string[]) => void
  reorderLayer: (id: string, where: 'front' | 'back') => void
}

/** The ids that a click on `id` should select: every member of its group,
 * or just itself when it isn't grouped. */
export function expandToGroup(layers: Record<string, ShapeLayer>, order: string[], id: string): string[] {
  const groupId = layers[id]?.groupId
  if (!groupId) return [id]
  return order.filter((oid) => layers[oid]?.groupId === groupId)
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Current plate size in mm — the artboard every single-shape alignment
 * snaps to. */
export function artboardSize(state: Pick<DocumentState, 'bedPresetId' | 'customBedWidth' | 'customBedHeight'>) {
  const preset = getBedPreset(state.bedPresetId)
  return { width: preset?.width ?? state.customBedWidth, height: preset?.height ?? state.customBedHeight }
}

export type DocumentStore = DocumentState & DocumentActions

/** A solid drawn inside a bigger one is almost always meant to sit ON it
 * (a logo on a plate, a boss on a base) — starting it at Z=0 would bury it
 * invisibly inside the bigger solid. Only near-complete containment
 * triggers this; a big plate drawn over small parts stays on the bed. */
const AUTO_REST_MIN_CONTAINMENT = 0.9
function perfectFitOnCreate(layer: ShapeLayer, state: Pick<DocumentState, 'layers' | 'order'>): ShapeLayer {
  if (layer.isHole) return layer
  const z = restingHeight(layer, state.layers, state.order, AUTO_REST_MIN_CONTAINMENT)
  return z == null ? layer : { ...layer, transform: { ...layer.transform, z } }
}

let transientSnapshot: Pick<DocumentState, 'layers' | 'order' | 'groups'> | null = null

// The pinned ("default") bed preset is a user preference, not part of any
// one document: it survives reloads and seeds every new project.
const PINNED_BED_KEY = 'smartgrid:pinnedBed'
function readPinnedBedPreset(): string | null {
  try {
    const v = localStorage.getItem(PINNED_BED_KEY)
    if (v === null) return DEFAULT_BED_ID
    return v === '' ? null : v
  } catch {
    return DEFAULT_BED_ID
  }
}
function writePinnedBedPreset(id: string | null) {
  try {
    localStorage.setItem(PINNED_BED_KEY, id ?? '')
  } catch {
    /* preference just won't persist */
  }
}

export const useDocumentStore = create<DocumentStore>()(
  temporal(
    (set, get) => ({
      layers: {},
      groups: {},
      order: [],
      selection: [],
      bedPresetId: DEFAULT_BED_ID,
      pinnedBedPresetId: readPinnedBedPreset(),
      customBedWidth: 256,
      customBedHeight: 256,
      guides: [],
      rulersVisible: true,
      displayUnit: 'mm',
      projectId: null,
      projectName: 'Untitled project',
      printSettings: DEFAULT_PRINT_SETTINGS,

      setProjectName: (name) => set({ projectName: name.trim() || 'Untitled project' }),

      setPrintSettings: (patch) =>
        set((state) => {
          const next = { ...state.printSettings, ...patch }
          next.layerHeight = Math.min(1, Math.max(0.04, next.layerHeight))
          next.wallLoops = Math.max(1, Math.round(next.wallLoops))
          next.topLayers = Math.max(0, Math.round(next.topLayers))
          next.bottomLayers = Math.max(0, Math.round(next.bottomLayers))
          next.infillDensity = Math.min(100, Math.max(0, next.infillDensity))
          return { printSettings: next }
        }),

      loadDocument: (projectId, snapshot) => {
        set({
          projectId,
          projectName: snapshot.name,
          layers: snapshot.layers,
          order: snapshot.order,
          groups: snapshot.groups ?? {},
          selection: [],
          bedPresetId: snapshot.bedPresetId,
          customBedWidth: snapshot.customBedWidth,
          customBedHeight: snapshot.customBedHeight,
          guides: snapshot.guides ?? [],
          displayUnit: snapshot.displayUnit ?? 'mm',
          printSettings: { ...DEFAULT_PRINT_SETTINGS, ...snapshot.printSettings },
        })
        useDocumentStore.temporal.getState().clear()
      },

      addShape: (kind, bounds) => {
        const id = generateId()
        const width = Math.max(1, bounds.width)
        const height = Math.max(1, bounds.height)
        const layer: ShapeLayer = {
          id,
          kind,
          name: defaultShapeName(kind),
          visible: true,
          locked: false,
          color: '#4d8dff',
          transform: { x: bounds.x, y: bounds.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
          regions: createShapeRegions(kind, width, height),
          extrusionDepth: 3,
          cornerRadius: 0,
          smartPolish: 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: kind === 'hole',
          ...(kind === 'polygon' ? { polygonSides: 6 } : {}),
          ...(kind === 'star' ? { starPoints: 5, starInnerRatio: 0.45 } : {}),
        }
        set((state) => ({
          layers: { ...state.layers, [id]: perfectFitOnCreate(layer, state) },
          order: [...state.order, id],
          selection: [id],
        }))
        return id
      },

      moveShapesBy: (ids, dx, dy) => {
        if (!dx && !dy) return
        set((state) => {
          const layers = { ...state.layers }
          for (const id of ids) {
            const layer = layers[id]
            if (!layer || layer.locked) continue
            layers[id] = {
              ...layer,
              transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy },
            }
          }
          return { layers }
        })
      },

      resizeShape: (id, bounds) => {
        set((state) => {
          const layer = state.layers[id]
          if (!layer || layer.locked) return {}
          const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
          const current = contourBounds(allPoints)
          const scaleX = current.width > 0 ? Math.max(1, bounds.width) / current.width : 1
          const scaleY = current.height > 0 ? Math.max(1, bounds.height) / current.height : 1
          const scalePoints = (points: { x: number; y: number }[]) =>
            points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }))
          const regions = layer.regions.map((region) => ({
            outer: { points: scalePoints(region.outer.points) },
            holes: region.holes.map((h) => ({ points: scalePoints(h.points) })),
          }))
          return {
            layers: {
              ...state.layers,
              [id]: { ...layer, regions, transform: { ...layer.transform, x: bounds.x, y: bounds.y } },
            },
          }
        })
      },

      addPenShape: (documentSpacePoints) => {
        const id = generateId()
        const bounds = contourBounds(documentSpacePoints)
        const localPoints = documentSpacePoints.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))
        const layer: ShapeLayer = {
          id,
          kind: 'polygon',
          name: 'Path',
          visible: true,
          locked: false,
          color: '#4d8dff',
          transform: { x: bounds.x, y: bounds.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
          regions: [{ outer: { points: localPoints }, holes: [] }],
          extrusionDepth: 3,
          cornerRadius: 0,
          smartPolish: 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: false,
        }
        set((state) => ({
          layers: { ...state.layers, [id]: perfectFitOnCreate(layer, state) },
          order: [...state.order, id],
          selection: [id],
        }))
        return id
      },

      applyBoolean: (op) => {
        set((state) => {
          const orderedIds = state.order.filter((id) => state.selection.includes(id))
          if (orderedIds.length < 2) return {}
          const orderedLayers = orderedIds.map((id) => state.layers[id])
          const result = applyBooleanOp(op, orderedLayers)
          if (!result) return {}

          const opNames: Record<BooleanOp, string> = {
            union: 'Union',
            subtract: 'Subtract',
            intersect: 'Intersect',
            exclude: 'Exclude',
          }
          const base = orderedLayers[0]
          const { polygonSides: _polygonSides, starPoints: _starPoints, starInnerRatio: _starInnerRatio, ...baseRest } = base
          const id = generateId()
          const newLayer: ShapeLayer = {
            ...baseRest,
            id,
            kind: 'polygon',
            name: opNames[op],
            transform: { ...base.transform, x: result.origin.x, y: result.origin.y },
            regions: result.regions,
          }

          const firstIndex = state.order.indexOf(orderedIds[0])
          const insertIndex = state.order.slice(0, firstIndex).filter((oid) => !orderedIds.includes(oid)).length
          const order = state.order.filter((oid) => !orderedIds.includes(oid))
          order.splice(insertIndex, 0, id)

          const layers = { ...state.layers }
          for (const rid of orderedIds) delete layers[rid]
          layers[id] = newLayer

          return { layers, order, selection: [id] }
        })
      },

      duplicateShapes: (ids) => {
        const newIds: string[] = []
        set((state) => {
          const layers = { ...state.layers }
          const order = [...state.order]
          const groups = { ...state.groups }
          // Copies of grouped shapes land in a fresh group of their own
          // rather than being folded into the original's.
          const groupRemap = new Map<string, string>()
          for (const id of ids) {
            const layer = state.layers[id]
            if (!layer) continue
            const newId = generateId()
            newIds.push(newId)
            let groupId = layer.groupId
            if (groupId) {
              let mapped = groupRemap.get(groupId)
              if (!mapped) {
                mapped = generateId()
                groupRemap.set(groupId, mapped)
                groups[mapped] = { id: mapped, name: `${state.groups[groupId]?.name ?? 'Group'} copy` }
              }
              groupId = mapped
            }
            layers[newId] = {
              ...layer,
              id: newId,
              name: `${layer.name} copy`,
              transform: { ...layer.transform, x: layer.transform.x + 10, y: layer.transform.y + 10 },
              ...(groupId ? { groupId } : {}),
            }
            order.push(newId)
          }
          return { layers, order, groups, selection: newIds }
        })
        return newIds
      },

      // Takes cloned layer snapshots rather than ids, so pasting still works
      // after the copied shapes were deleted or the selection changed — the
      // clipboard doesn't depend on the originals still existing.
      pasteShapes: (sourceLayers) => {
        const newIds: string[] = []
        set((state) => {
          const layers = { ...state.layers }
          const order = [...state.order]
          for (const source of sourceLayers) {
            const newId = generateId()
            newIds.push(newId)
            layers[newId] = {
              ...source,
              id: newId,
              transform: { ...source.transform, x: source.transform.x + 10, y: source.transform.y + 10 },
            }
            order.push(newId)
          }
          return { layers, order, selection: newIds }
        })
        return newIds
      },

      addImportedShapes: (shapes, origin, groupName) => {
        const newIds: string[] = []
        set((state) => {
          const layers = { ...state.layers }
          const order = [...state.order]
          const groupId = shapes.length > 1 ? generateId() : null
          for (const shape of shapes) {
            const all = shape.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
            if (all.length < 3) continue
            const bounds = contourBounds(all)
            const localize = (pts: Point2[]) => pts.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))
            const id = generateId()
            newIds.push(id)
            layers[id] = {
              id,
              kind: 'polygon',
              name: shape.name,
              visible: true,
              locked: false,
              color: shape.color,
              transform: { x: origin.x + bounds.x, y: origin.y + bounds.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
              regions: shape.regions.map((r) => ({ outer: { points: localize(r.outer.points) }, holes: r.holes.map((h) => ({ points: localize(h.points) })) })),
              extrusionDepth: 3,
              cornerRadius: 0,
              smartPolish: 0,
              bevelBottom: 0,
              bevelTop: 0,
              isHole: false,
              ...(groupId ? { groupId } : {}),
            }
            order.push(id)
          }
          if (newIds.length === 0) return {}
          const groups = groupId && newIds.length > 1 ? { ...state.groups, [groupId]: { id: groupId, name: groupName ?? 'Imported SVG' } } : state.groups
          if (groupId && newIds.length === 1) delete layers[newIds[0]].groupId
          return { layers, order, groups, selection: newIds }
        })
        return newIds
      },

      removeShapes: (ids) => {
        set((state) => {
          // Locked shapes are protected from deletion, same as move/resize —
          // only unlocking one first allows it to be removed.
          const idSet = new Set(ids.filter((id) => !state.layers[id]?.locked))
          const layers = { ...state.layers }
          for (const id of idSet) delete layers[id]
          return {
            layers,
            order: state.order.filter((id) => !idSet.has(id)),
            selection: state.selection.filter((id) => !idSet.has(id)),
          }
        })
      },

      setSelection: (ids) => set({ selection: ids }),

      toggleVisibility: (id) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, visible: !layer.visible } } }
        }),

      toggleLocked: (id) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, locked: !layer.locked } } }
        }),

      setColor: (id, color) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, color } } }
        }),

      setOpacity: (id, opacity) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, opacity: Math.min(100, Math.max(0, opacity)) } } }
        }),

      setExtrusionDepth: (id, depth) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, extrusionDepth: Math.max(0, depth) } } }
        }),

      setCornerRadius: (id, radius) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, cornerRadius: Math.max(0, radius) } } }
        }),

      setSmartPolish: (id, intensity) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, smartPolish: Math.max(0, intensity) } } }
        }),

      setBevelBottom: (id, amount) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, bevelBottom: Math.max(0, amount) } } }
        }),

      setBevelTop: (id, amount) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, bevelTop: Math.max(0, amount) } } }
        }),

      setLayerZ: (id, z) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer || layer.locked) return {}
          return { layers: { ...state.layers, [id]: { ...layer, transform: { ...layer.transform, z: Math.max(0, z) } } } }
        }),

      // Several shapes (a group) move as ONE rigid unit: the same Z change
      // for all of them, so their arrangement is preserved.
      restOnShapeBelow: (ids) =>
        set((state) => {
          const movable = ids.filter((id) => state.layers[id] && !state.layers[id].locked)
          if (movable.length === 0) return {}
          const rest = unitRest(movable, state.layers, state.order)
          if (!rest || Math.abs(rest.delta) < 1e-6) return {}
          const layers = { ...state.layers }
          for (const id of movable) {
            const layer = layers[id]
            layers[id] = { ...layer, transform: { ...layer.transform, z: Math.round((layer.transform.z + rest.delta) * 1e6) / 1e6 } }
          }
          return { layers }
        }),

      dropToBed: (ids) =>
        set((state) => {
          const movable = ids.filter((id) => state.layers[id] && !state.layers[id].locked)
          if (movable.length === 0) return {}
          const delta = unitDropDelta(movable, state.layers)
          if (Math.abs(delta) < 1e-6) return {}
          const layers = { ...state.layers }
          for (const id of movable) {
            const layer = layers[id]
            layers[id] = { ...layer, transform: { ...layer.transform, z: Math.max(0, Math.round((layer.transform.z + delta) * 1e6) / 1e6) } }
          }
          return { layers }
        }),

      setRotation: (id, rotation) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer || layer.locked) return {}
          return {
            layers: {
              ...state.layers,
              [id]: {
                ...layer,
                transform: {
                  ...layer.transform,
                  rotationX: rotation.x ?? layer.transform.rotationX,
                  rotationY: rotation.y ?? layer.transform.rotationY,
                  rotation: rotation.z ?? layer.transform.rotation,
                },
              },
            },
          }
        }),

      beginTransientEdit: () => {
        const { layers, order, groups } = get()
        transientSnapshot = { layers, order, groups }
        useDocumentStore.temporal.getState().pause()
      },

      // zundo records the pre-change state on every tracked set, so while
      // paused nothing is recorded. To end up with exactly one entry for the
      // whole drag: silently restore the pre-drag snapshot, resume tracking,
      // then re-apply the final state as a single tracked change.
      commitTransientEdit: () => {
        const temporal = useDocumentStore.temporal.getState()
        const snapshot = transientSnapshot
        transientSnapshot = null
        if (!snapshot) {
          temporal.resume()
          return
        }
        const { layers, order, groups } = get()
        const changed = layers !== snapshot.layers || order !== snapshot.order || groups !== snapshot.groups
        if (!changed) {
          temporal.resume()
          return
        }
        set(snapshot)
        temporal.resume()
        set({ layers, order, groups })
      },

      // Sinks a hole (a magnet pocket) down to the BOTTOM of whatever solids
      // it overlaps in XY, leaving a floor of whole print layers under it.
      // Its own depth (the magnet's thickness) is kept, so the pocket is a
      // hidden cavity closed over by the layers above — pause the print at
      // the layer where the pocket tops out, drop the magnet in, resume.
      // A hole's z/depth are otherwise independent of anything underneath
      // it (never touched by any future auto-stack/floating-shape logic,
      // which should treat holes as non-physical) — this is the one place
      // that deliberately moves a hole based on what it overlaps.
      snapHoleToPocket: (id, floorThicknessMM) => {
        set((state) => {
          const hole = state.layers[id]
          if (!hole || !hole.isHole || hole.locked) return {}
          const holeBounds = shapeWorldBounds(hole)
          const overlapping = state.order
            .map((oid) => state.layers[oid])
            .filter(
              (l): l is ShapeLayer =>
                !!l && !l.isHole && l.id !== id && rectsOverlap(holeBounds, shapeWorldBounds(l)),
            )
          if (overlapping.length === 0) return {}

          const bottomZ = Math.min(...overlapping.map((l) => l.transform.z))
          const layerHeight = state.printSettings.layerHeight
          // Round the floor UP to whole layers — a floor thinner than a
          // layer can't be printed, and a partial layer would just shift
          // every layer boundary above it.
          const floorLayers = Math.max(1, Math.ceil(Math.max(0, floorThicknessMM) / layerHeight - 1e-6))
          const newZ = Math.round(Math.max(0, bottomZ + floorLayers * layerHeight) * 1e6) / 1e6

          return {
            layers: {
              ...state.layers,
              [id]: { ...hole, transform: { ...hole.transform, z: newZ } },
            },
          }
        })
      },

      hollowOut: (id, options) => {
        const state = get()
        const solid = state.layers[id]
        if (!solid || solid.isHole) return null
        const layerHeight = state.printSettings.layerHeight
        const floorLayers = Math.max(1, Math.ceil(Math.max(0, options.floor) / layerHeight - 1e-6))
        const cavity = buildShellCavity(solid, { ...options, floor: floorLayers * layerHeight })
        if (!cavity) return null
        const cavityId = generateId()
        set((s) => {
          const layers = { ...s.layers }
          let groups = s.groups
          // The cavity belongs with its solid: join its group, or start one.
          let groupId = solid.groupId
          if (!groupId) {
            groupId = generateId()
            groups = { ...groups, [groupId]: { id: groupId, name: `${solid.name} shell` } }
            layers[id] = { ...solid, groupId }
          }
          layers[cavityId] = {
            id: cavityId,
            kind: 'hole',
            name: `${solid.name} cavity`,
            visible: true,
            locked: false,
            color: solid.color,
            transform: { x: cavity.x, y: cavity.y, z: cavity.z, rotationX: 0, rotationY: 0, rotation: 0 },
            regions: cavity.regions,
            extrusionDepth: cavity.depth,
            cornerRadius: 0,
            smartPolish: 0,
            bevelBottom: 0,
            bevelTop: 0,
            isHole: true,
            groupId,
          }
          const at = s.order.indexOf(id)
          const order = [...s.order]
          order.splice(at + 1, 0, cavityId)
          return { layers, groups, order, selection: [cavityId] }
        })
        return { cavityId, wall: cavity.wall }
      },

      setTexture: (id, texture) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          if (!texture) {
            const { texture: _dropped, ...rest } = layer
            return { layers: { ...state.layers, [id]: rest } }
          }
          const clean: SurfaceTexture = {
            ...texture,
            size: Math.min(50, Math.max(0.5, texture.size)),
            depth: Math.min(5, Math.max(0, texture.depth)),
          }
          return { layers: { ...state.layers, [id]: { ...layer, texture: clean } } }
        }),

      setPerforation: (id, perforation) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          if (!perforation) {
            const { perforation: _dropped, ...rest } = layer
            return { layers: { ...state.layers, [id]: rest } }
          }
          const size = Math.min(50, Math.max(0.3, perforation.size))
          const clean: Perforation = {
            ...perforation,
            size,
            spacing: Math.max(size + 0.4, perforation.spacing),
            depth: perforation.depth == null ? null : Math.max(0.1, perforation.depth),
          }
          return { layers: { ...state.layers, [id]: { ...layer, perforation: clean } } }
        }),

      setBevelMode: (id, mode) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, bevelMode: mode } } }
        }),

      carveWith: (baseId, toolId, options) =>
        set((state) => {
          const base = state.layers[baseId]
          const tool = state.layers[toolId]
          if (!base || !tool || base.isHole || baseId === toolId) return {}
          const OVERSHOOT = 1
          const baseTop = base.transform.z + base.extrusionDepth
          const d = Math.max(0.05, options.depth ?? tool.extrusionDepth)
          let z = tool.transform.z
          let depth = tool.extrusionDepth
          if (options.mode === 'through') {
            z = base.transform.z - OVERSHOOT
            depth = base.extrusionDepth + 2 * OVERSHOOT
          } else if (options.mode === 'top') {
            z = baseTop - d
            depth = d + OVERSHOOT
          } else if (options.mode === 'bottom') {
            z = base.transform.z - OVERSHOOT
            depth = d + OVERSHOOT
          }
          const layers = { ...state.layers }
          let groups = state.groups
          let groupId = base.groupId
          if (!groupId) {
            groupId = generateId()
            groups = { ...groups, [groupId]: { id: groupId, name: `${base.name} carved` } }
            layers[baseId] = { ...base, groupId }
          }
          const { perforation: _noPerforation, ...toolRest } = tool
          layers[toolId] = {
            ...toolRest,
            kind: 'hole',
            isHole: true,
            // The cut has the tool's exact shape — its bevels stay edges of
            // the cut, not a flared rim.
            bevelMode: 'shape',
            name: tool.isHole ? tool.name : `${tool.name} cutter`,
            transform: { ...tool.transform, z: Math.round(z * 1e6) / 1e6 },
            extrusionDepth: Math.round(depth * 1e6) / 1e6,
            groupId,
          }
          return { layers, groups, selection: [baseId, toolId] }
        }),

      setBedPreset: (id) => set({ bedPresetId: id }),

      togglePinnedBedPreset: (id) =>
        set((state) => {
          const next = state.pinnedBedPresetId === id ? null : id
          writePinnedBedPreset(next)
          return { pinnedBedPresetId: next }
        }),

      setCustomBedSize: (width, height) =>
        set({ customBedWidth: Math.max(10, width), customBedHeight: Math.max(10, height) }),

      setDisplayUnit: (unit) => set({ displayUnit: unit }),

      addGuide: (orientation, position) => {
        const id = generateId()
        set((state) => ({ guides: [...state.guides, { id, orientation, position }] }))
        return id
      },

      updateGuidePosition: (id, position) =>
        set((state) => ({ guides: state.guides.map((g) => (g.id === id ? { ...g, position } : g)) })),

      removeGuide: (id) => set((state) => ({ guides: state.guides.filter((g) => g.id !== id) })),

      toggleRulersVisible: () => set((state) => ({ rulersVisible: !state.rulersVisible })),

      groupShapes: (ids) => {
        const members = ids.filter((id, i) => ids.indexOf(id) === i)
        if (members.length === 0) return null
        const groupId = generateId()
        set((state) => {
          const layers = { ...state.layers }
          for (const id of members) {
            const layer = layers[id]
            if (layer) layers[id] = { ...layer, groupId }
          }
          const groupCount = Object.keys(state.groups).length + 1
          // Drop any group that this regrouping emptied out.
          const groups: Record<string, ShapeGroup> = { ...state.groups, [groupId]: { id: groupId, name: `Group ${groupCount}` } }
          for (const gid of Object.keys(groups)) {
            if (!Object.values(layers).some((l) => l.groupId === gid)) delete groups[gid]
          }
          return { layers, groups, selection: members }
        })
        return groupId
      },

      ungroupShapes: (ids) =>
        set((state) => {
          const affectedGroups = new Set(ids.map((id) => state.layers[id]?.groupId).filter((g): g is string => !!g))
          if (affectedGroups.size === 0) return {}
          const layers = { ...state.layers }
          for (const [id, layer] of Object.entries(layers)) {
            if (layer.groupId && affectedGroups.has(layer.groupId)) {
              const { groupId: _dropped, ...rest } = layer
              layers[id] = rest
            }
          }
          const groups = { ...state.groups }
          for (const gid of affectedGroups) delete groups[gid]
          return { layers, groups }
        }),

      reorderLayer: (id, where) =>
        set((state) => {
          if (!state.layers[id]) return {}
          const moving = expandToGroup(state.layers, state.order, id)
          const rest = state.order.filter((oid) => !moving.includes(oid))
          return { order: where === 'front' ? [...rest, ...moving] : [...moving, ...rest] }
        }),

      // Figma semantics: with several shapes selected, align them to the
      // selection's own combined bounds; with one, align it to the artboard.
      alignShapes: (ids, mode) =>
        set((state) => {
          const targets = ids.map((id) => state.layers[id]).filter((l): l is ShapeLayer => !!l && !l.locked)
          if (targets.length === 0) return {}
          const boundsById = new Map(targets.map((l) => [l.id, shapeWorldBounds(l)] as const))
          let ref: Bounds
          if (targets.length > 1) {
            const all = [...boundsById.values()]
            const minX = Math.min(...all.map((b) => b.x))
            const minY = Math.min(...all.map((b) => b.y))
            const maxX = Math.max(...all.map((b) => b.x + b.width))
            const maxY = Math.max(...all.map((b) => b.y + b.height))
            ref = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
          } else {
            const { width, height } = artboardSize(state)
            ref = { x: 0, y: 0, width, height }
          }
          const layers = { ...state.layers }
          for (const layer of targets) {
            const b = boundsById.get(layer.id)!
            let dx = 0
            let dy = 0
            if (mode === 'left') dx = ref.x - b.x
            else if (mode === 'hcenter') dx = ref.x + ref.width / 2 - (b.x + b.width / 2)
            else if (mode === 'right') dx = ref.x + ref.width - (b.x + b.width)
            else if (mode === 'top') dy = ref.y - b.y
            else if (mode === 'vcenter') dy = ref.y + ref.height / 2 - (b.y + b.height / 2)
            else dy = ref.y + ref.height - (b.y + b.height)
            layers[layer.id] = {
              ...layer,
              transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy },
            }
          }
          return { layers }
        }),
    }),
    {
      // Selection is transient UI state, not something Cmd+Z should walk
      // back through — only the shape data itself belongs in history.
      partialize: (state) => ({ layers: state.layers, order: state.order, groups: state.groups }),
      // Without this zundo records an entry on EVERY set — including a
      // plain selection change that leaves the document untouched — so
      // undo would sometimes appear to do nothing. Store updates are
      // immutable, so reference equality of the tracked slices is exact.
      equality: (a, b) => a.layers === b.layers && a.order === b.order && a.groups === b.groups,
      limit: 100,
    },
  ),
)

export function useTemporalStore() {
  return useStore(useDocumentStore.temporal, (state) => state)
}

/** The shape's local points with its Z-spin (`rotation`) applied about the
 * footprint center — the outline the 2D canvas actually shows. Tilts
 * (rotationX/Y) can't be drawn in 2D and are left to the 3D geometry. */
/** The saveable part of the document (see localProjects.ts). */
export function serializeDocument(state: DocumentState): DocumentSnapshot {
  return {
    version: 1,
    name: state.projectName,
    layers: state.layers,
    order: state.order,
    groups: state.groups,
    bedPresetId: state.bedPresetId,
    customBedWidth: state.customBedWidth,
    customBedHeight: state.customBedHeight,
    guides: state.guides,
    displayUnit: state.displayUnit,
    printSettings: state.printSettings,
  }
}

/** A fresh, empty document for a new project. */
export function emptyDocument(name = 'Untitled project'): DocumentSnapshot {
  const s = useDocumentStore.getState()
  return {
    version: 1,
    name,
    layers: {},
    order: [],
    groups: {},
    bedPresetId: s.pinnedBedPresetId ?? DEFAULT_BED_ID,
    customBedWidth: 256,
    customBedHeight: 256,
    guides: [],
    displayUnit: 'mm',
    printSettings: DEFAULT_PRINT_SETTINGS,
  }
}

// Dev-only handle so browser automation/debugging can reach the live store
// (stripped from production builds by the DEV guard).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __smartgrid: { useDocumentStore: typeof useDocumentStore; shapeWorldBounds: typeof shapeWorldBounds; buildLayerGeometries: typeof buildLayerGeometries; buildLayerCutters: typeof buildLayerCutters; cutHolesFromSolid: typeof cutHolesFromSolid } }).__smartgrid = { useDocumentStore, shapeWorldBounds, buildLayerGeometries, buildLayerCutters, cutHolesFromSolid }
}
