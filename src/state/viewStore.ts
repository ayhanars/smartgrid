import { create } from 'zustand'

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
  /** Local autosave state shown in the top bar. */
  saveStatus: 'idle' | 'saving' | 'saved'
  setPrintPreview: (on: boolean) => void
  setPreviewHeight: (height: number | null) => void
  setGizmoMode: (mode: 'translate' | 'rotate') => void
  setSaveStatus: (status: 'idle' | 'saving' | 'saved') => void
}

export const useViewStore = create<ViewState>()((set) => ({
  printPreview: false,
  previewHeight: null,
  gizmoMode: 'translate',
  saveStatus: 'idle',
  setPrintPreview: (on) => set({ printPreview: on, previewHeight: null }),
  setPreviewHeight: (height) => set({ previewHeight: height }),
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setSaveStatus: (status) => set({ saveStatus: status }),
}))
