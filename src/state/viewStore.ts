import { create } from 'zustand'

/** Default slicing layer height the print preview steps through. */
export const PREVIEW_LAYER_HEIGHT_MM = 0.2

/**
 * Viewing state that is not part of the document (never saved, never in
 * undo history): the print-preview mode that "prints" the scene one
 * layer at a time, and the 3D gizmo mode.
 */
interface ViewState {
  printPreview: boolean
  /** Print height (mm) the preview is cut at; null = full height. */
  previewHeight: number | null
  gizmoMode: 'translate' | 'rotate'
  setPrintPreview: (on: boolean) => void
  setPreviewHeight: (height: number | null) => void
  setGizmoMode: (mode: 'translate' | 'rotate') => void
}

export const useViewStore = create<ViewState>()((set) => ({
  printPreview: false,
  previewHeight: null,
  gizmoMode: 'translate',
  setPrintPreview: (on) => set({ printPreview: on, previewHeight: null }),
  setPreviewHeight: (height) => set({ previewHeight: height }),
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
}))
