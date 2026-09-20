import { create } from 'zustand'
import type { ShapeLayer } from '../types/document'
import { useDocumentStore } from './documentStore'

interface ClipboardState {
  items: ShapeLayer[]
  /** Copies the shapes (a group as a whole). */
  copy: (ids: string[]) => void
  /** Copies, then removes the shapes. */
  cut: (ids: string[]) => void
  /** Pastes onto the active plate, offset from the source, and selects
   * the copies; repeated pastes cascade. */
  paste: () => string[]
}

/** The app's own clipboard for shapes: works across plates and from the
 * 2D canvas, the 3D view and the layer list alike. */
export const useClipboard = create<ClipboardState>((set, get) => ({
  items: [],
  copy: (ids) => {
    const { layers } = useDocumentStore.getState()
    const items = ids.map((id) => layers[id]).filter((l): l is ShapeLayer => !!l)
    if (items.length) set({ items })
  },
  cut: (ids) => {
    get().copy(ids)
    useDocumentStore.getState().removeShapes(ids)
  },
  paste: () => {
    const { items } = get()
    if (items.length === 0) return []
    const doc = useDocumentStore.getState()
    const newIds = doc.pasteShapes(items)
    const fresh = useDocumentStore.getState().layers
    set({ items: newIds.map((id) => fresh[id]).filter((l): l is ShapeLayer => !!l) })
    return newIds
  },
}))
