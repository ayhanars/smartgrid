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
  /** Cloud copy of the open project: off when signed out, offline when
   * the browser has no network and a save is waiting. */
  cloudStatus: 'off' | 'syncing' | 'synced' | 'error' | 'offline'
  /** One-line transient message (import results etc.), shown as a toast. */
  notice: { id: number; text: string; link?: { label: string; to: string } } | null
  setPrintPreview: (on: boolean) => void
  setPreviewHeight: (height: number | null) => void
  setGizmoMode: (mode: 'translate' | 'rotate') => void
  setSaveStatus: (status: 'idle' | 'saving' | 'saved') => void
  setCloudStatus: (status: ViewState['cloudStatus']) => void
  setNotice: (text: string | null, link?: { label: string; to: string }) => void
  /** Bumped when a custom texture tile finishes decoding, so meshes that
   * sampled it too early rebuild. */
  tileVersion: number
  bumpTileVersion: () => void
  /** The 3D profile ruler (rings you drag to shape a vase/cone) is shown. */
  profileEditing: boolean
  setProfileEditing: (on: boolean) => void
  /** The Create panel (product templates) is open. */
  createOpen: boolean
  setCreateOpen: (on: boolean) => void
  /** Which panes the editor shows; mirrored from the shell so panels can
   * follow it (the inspector jumps to its 3D tab in 3D-only mode). */
  viewMode: '2d' | 'split' | '3d'
  setViewMode: (mode: '2d' | 'split' | '3d') => void
}

let noticeCounter = 0

export const useViewStore = create<ViewState>()((set) => ({
  printPreview: false,
  previewHeight: null,
  gizmoMode: 'translate',
  saveStatus: 'idle',
  cloudStatus: 'off',
  notice: null,
  setPrintPreview: (on) => set({ printPreview: on, previewHeight: null }),
  setPreviewHeight: (height) => set({ previewHeight: height }),
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setCloudStatus: (status) => set({ cloudStatus: status }),
  setNotice: (text, link) => set({ notice: text ? { id: ++noticeCounter, text, link } : null }),
  tileVersion: 0,
  bumpTileVersion: () => set((s) => ({ tileVersion: s.tileVersion + 1 })),
  profileEditing: false,
  setProfileEditing: (on) => set({ profileEditing: on }),
  createOpen: false,
  setCreateOpen: (on) => set({ createOpen: on }),
  viewMode: 'split',
  setViewMode: (mode) => set({ viewMode: mode }),
}))
