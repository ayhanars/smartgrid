import { create } from 'zustand'
import type { SupportWarning } from '../lib/geometry/support'

interface AnalysisState {
  warnings: SupportWarning[]
  /** Partial warnings the user chose to hide; critical ones can't be. */
  dismissed: string[]
  setWarnings: (warnings: SupportWarning[]) => void
  dismiss: (id: string) => void
}

/** Derived, read-only diagnostics about the document (not undoable, not
 * part of the document itself). */
export const useAnalysisStore = create<AnalysisState>()((set) => ({
  warnings: [],
  dismissed: [],
  setWarnings: (warnings) => set({ warnings }),
  dismiss: (id) => set((s) => ({ dismissed: s.dismissed.includes(id) ? s.dismissed : [...s.dismissed, id] })),
}))

export function visibleWarning(state: AnalysisState, id: string): SupportWarning | undefined {
  const w = state.warnings.find((x) => x.id === id)
  if (!w) return undefined
  if (w.severity === 'partial' && state.dismissed.includes(id)) return undefined
  return w
}
