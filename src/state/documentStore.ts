import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import type { Bounds, Point2, ShapeKind, ShapeLayer } from '../types/document'
import { createShapeRegions, contourBounds, defaultShapeName } from '../lib/geometry/primitives'
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

export interface Guide {
  id: string
  orientation: 'horizontal' | 'vertical'
  /** Document mm position: Y for a horizontal guide, X for a vertical one. */
  position: number
}

interface DocumentState {
  layers: Record<string, ShapeLayer>
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
}

interface DocumentActions {
  addShape: (kind: ShapeKind, bounds: Bounds) => string
  addPenShape: (documentSpacePoints: Point2[]) => string
  moveShapesBy: (ids: string[], dx: number, dy: number) => void
  resizeShape: (id: string, bounds: Bounds) => void
  duplicateShapes: (ids: string[]) => string[]
  pasteShapes: (sourceLayers: ShapeLayer[]) => string[]
  removeShapes: (ids: string[]) => void
  setSelection: (ids: string[]) => void
  toggleVisibility: (id: string) => void
  toggleLocked: (id: string) => void
  setColor: (id: string, color: string) => void
  setExtrusionDepth: (id: string, depth: number) => void
  setCornerRadius: (id: string, radius: number) => void
  setSmartPolish: (id: string, intensity: number) => void
  setBevelBottom: (id: string, amount: number) => void
  setBevelTop: (id: string, amount: number) => void
  setLayerZ: (id: string, z: number) => void
  snapHoleToPocket: (id: string, floorThicknessMM: number) => void
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
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Current plate size in mm — the artboard every single-shape alignment
 * snaps to. */
export function artboardSize(state: Pick<DocumentState, 'bedPresetId' | 'customBedWidth' | 'customBedHeight'>) {
  const preset = getBedPreset(state.bedPresetId)
  return { width: preset?.width ?? state.customBedWidth, height: preset?.height ?? state.customBedHeight }
}

export type DocumentStore = DocumentState & DocumentActions

export const useDocumentStore = create<DocumentStore>()(
  temporal(
    (set) => ({
      layers: {},
      order: [],
      selection: [],
      bedPresetId: DEFAULT_BED_ID,
      pinnedBedPresetId: DEFAULT_BED_ID,
      customBedWidth: 256,
      customBedHeight: 256,
      guides: [],
      rulersVisible: true,
      displayUnit: 'mm',

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
          transform: { x: bounds.x, y: bounds.y, z: 0, rotation: 0 },
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
          layers: { ...state.layers, [id]: layer },
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
          transform: { x: bounds.x, y: bounds.y, z: 0, rotation: 0 },
          regions: [{ outer: { points: localPoints }, holes: [] }],
          extrusionDepth: 3,
          cornerRadius: 0,
          smartPolish: 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: false,
        }
        set((state) => ({
          layers: { ...state.layers, [id]: layer },
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
          for (const id of ids) {
            const layer = state.layers[id]
            if (!layer) continue
            const newId = generateId()
            newIds.push(newId)
            layers[newId] = {
              ...layer,
              id: newId,
              name: `${layer.name} copy`,
              transform: { ...layer.transform, x: layer.transform.x + 10, y: layer.transform.y + 10 },
            }
            order.push(newId)
          }
          return { layers, order, selection: newIds }
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

      // Sinks a hole shape so it stops just short of the BOTTOM of whatever
      // solids it overlaps in XY, leaving a thin floor — enough to hide a
      // magnet flush without punching all the way through the part. A
      // hole's z/depth are otherwise independent of anything underneath it
      // (never touched by any future auto-stack/floating-shape logic,
      // which should treat holes as non-physical) — this is the one place
      // that deliberately moves a hole based on what it overlaps.
      snapHoleToPocket: (id, floorThicknessMM) => {
        const TOP_OVERSHOOT_MM = 1
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
          const topZ = Math.max(...overlapping.map((l) => l.transform.z + l.extrusionDepth))
          const newZ = Math.max(0, bottomZ + Math.max(0, floorThicknessMM))
          const newDepth = Math.max(0.05, topZ + TOP_OVERSHOOT_MM - newZ)

          return {
            layers: {
              ...state.layers,
              [id]: { ...hole, extrusionDepth: newDepth, transform: { ...hole.transform, z: newZ } },
            },
          }
        })
      },

      setBedPreset: (id) => set({ bedPresetId: id }),

      togglePinnedBedPreset: (id) =>
        set((state) => ({ pinnedBedPresetId: state.pinnedBedPresetId === id ? null : id })),

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
      partialize: (state) => ({ layers: state.layers, order: state.order }),
      limit: 100,
    },
  ),
)

export function useTemporalStore() {
  return useStore(useDocumentStore.temporal, (state) => state)
}

export function shapeWorldBounds(layer: ShapeLayer): Bounds {
  const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
  const local = contourBounds(allPoints)
  return {
    x: layer.transform.x + local.x,
    y: layer.transform.y + local.y,
    width: local.width,
    height: local.height,
  }
}
