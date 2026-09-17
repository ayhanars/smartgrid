import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import type { Bounds, Point2, ShapeKind, ShapeLayer } from '../types/document'
import { createShapeRegions, contourBounds, defaultShapeName } from '../lib/geometry/primitives'
import { DEFAULT_BED_ID } from '../lib/geometry/bedPresets'
import { applyBooleanOp, type BooleanOp } from '../lib/geometry/boolean'

let idCounter = 0
function generateId() {
  idCounter += 1
  return `shape-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
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
  guides: Guide[]
  rulersVisible: boolean
}

interface DocumentActions {
  addShape: (kind: ShapeKind, bounds: Bounds) => string
  addPenShape: (documentSpacePoints: Point2[]) => string
  moveShapesBy: (ids: string[], dx: number, dy: number) => void
  resizeShape: (id: string, bounds: Bounds) => void
  duplicateShapes: (ids: string[]) => string[]
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
  setBedPreset: (id: string) => void
  togglePinnedBedPreset: (id: string) => void
  applyBoolean: (op: BooleanOp) => void
  addGuide: (orientation: Guide['orientation'], position: number) => string
  updateGuidePosition: (id: string, position: number) => void
  removeGuide: (id: string) => void
  toggleRulersVisible: () => void
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
      guides: [],
      rulersVisible: true,

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
          transform: { x: bounds.x, y: bounds.y, rotation: 0 },
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
          transform: { x: bounds.x, y: bounds.y, rotation: 0 },
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

      setBedPreset: (id) => set({ bedPresetId: id }),

      togglePinnedBedPreset: (id) =>
        set((state) => ({ pinnedBedPresetId: state.pinnedBedPresetId === id ? null : id })),

      addGuide: (orientation, position) => {
        const id = generateId()
        set((state) => ({ guides: [...state.guides, { id, orientation, position }] }))
        return id
      },

      updateGuidePosition: (id, position) =>
        set((state) => ({ guides: state.guides.map((g) => (g.id === id ? { ...g, position } : g)) })),

      removeGuide: (id) => set((state) => ({ guides: state.guides.filter((g) => g.id !== id) })),

      toggleRulersVisible: () => set((state) => ({ rulersVisible: !state.rulersVisible })),
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
