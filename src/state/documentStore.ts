import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import type { Bounds, ShapeKind, ShapeLayer } from '../types/document'
import { createShapeRegions, contourBounds, defaultShapeName } from '../lib/geometry/primitives'

let idCounter = 0
function generateId() {
  idCounter += 1
  return `shape-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
}

interface DocumentState {
  layers: Record<string, ShapeLayer>
  /** Back-to-front draw order (also top-to-bottom in the Layers panel, reversed for display). */
  order: string[]
  selection: string[]
}

interface DocumentActions {
  addShape: (kind: ShapeKind, bounds: Bounds) => string
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
}

export type DocumentStore = DocumentState & DocumentActions

export const useDocumentStore = create<DocumentStore>()(
  temporal(
    (set) => ({
      layers: {},
      order: [],
      selection: [],

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
          if (!layer) return {}
          const current = contourBounds(layer.regions[0].outer.points)
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
          const idSet = new Set(ids)
          const layers = { ...state.layers }
          for (const id of ids) delete layers[id]
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
  const local = contourBounds(layer.regions[0].outer.points)
  return {
    x: layer.transform.x + local.x,
    y: layer.transform.y + local.y,
    width: local.width,
    height: local.height,
  }
}
