import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from './TopBar'
import { LeftPanel } from './LeftPanel'
import { InspectorPanel } from '../features/inspector/InspectorPanel'
import { Canvas2DPane } from '../features/canvas-2d/Canvas2DPane'
import { Viewport3DPane } from '../features/viewport-3d/Viewport3DPane'
import { orderOnPlate, useDocumentStore } from '../state/documentStore'
import { useAnalysisStore } from '../state/analysisStore'
import { useViewStore } from '../state/viewStore'
import { analyzeSupport } from '../lib/geometry/support'
import { isTextEntryTarget } from '../lib/dom/isTextEntryTarget'
import './AppShell.css'

export type ViewMode = 'split' | '2d' | '3d'

const TOAST_MS = 6000

/** Transient one-liner from the view store (import results, errors). */
function Toast() {
  const navigate = useNavigate()
  const notice = useViewStore((s) => s.notice)
  const setNotice = useViewStore((s) => s.setNotice)
  useEffect(() => {
    if (!notice) return
    const handle = window.setTimeout(() => setNotice(null), TOAST_MS)
    return () => window.clearTimeout(handle)
  }, [notice, setNotice])
  if (!notice) return null
  return (
    <div className="app-shell__toast" role="status">
      <span>{notice.text}</span>
      {notice.link && (
        <button
          type="button"
          className="app-shell__toast-link"
          onClick={() => {
            setNotice(null)
            navigate(notice.link!.to)
          }}
        >
          {notice.link.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
        ×
      </button>
    </div>
  )
}

export function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTextEntryTarget(e.target)) return

      const mod = e.metaKey || e.ctrlKey
      const { selection, removeShapes, setSelection, groupShapes, ungroupShapes } = useDocumentStore.getState()

      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault()
        removeShapes(selection)
      } else if (e.key === 'Escape' && selection.length) {
        setSelection([])
      } else if (mod && e.key.toLowerCase() === 'g' && selection.length) {
        e.preventDefault()
        if (e.shiftKey) ungroupShapes(selection)
        else groupShapes(selection)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const temporal = useDocumentStore.temporal.getState()
        if (e.shiftKey) temporal.redo()
        else temporal.undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Re-run the floating/support analysis whenever the document changes.
  // Debounced so a live dial/slider drag doesn't rebuild every shape's
  // geometry on every pointer move.
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const plates = useDocumentStore((s) => s.plates)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      // Shapes only rest on shapes of their own plate.
      useAnalysisStore.getState().setWarnings(plates.flatMap((p) => analyzeSupport(layers, orderOnPlate({ layers, order, plates }, p.id))))
    }, 60)
    return () => window.clearTimeout(handle)
  }, [layers, order, plates])

  // The print preview lives in the 3D viewport, so turning it on from a
  // 2D-only layout brings the 3D pane back into view.
  const printPreview = useViewStore((s) => s.printPreview)
  useEffect(() => {
    if (printPreview) setViewMode((mode) => (mode === '2d' ? 'split' : mode))
  }, [printPreview])

  useEffect(() => {
    // Browsers report a trackpad pinch as a wheel event with ctrlKey set,
    // and left un-prevented it zooms the whole page instead of the canvas
    // underneath — block that globally so a pinch anywhere in the app
    // never escapes into a native browser zoom; Canvas2DPane still handles
    // pinch/Cmd-scroll itself to zoom the artboard.
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="app-shell">
      <Toast />
      <TopBar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        leftPanelOpen={leftPanelOpen}
        onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
      />
      <div className="app-shell__body">
        {leftPanelOpen && (
          <aside className="app-shell__left">
            <LeftPanel />
          </aside>
        )}
        <main className="app-shell__center">
          {viewMode !== '3d' && (
            <div className="app-shell__pane">
              <Canvas2DPane />
            </div>
          )}
          {viewMode === 'split' && <div className="app-shell__divider" />}
          {viewMode !== '2d' && (
            <div className="app-shell__pane">
              <Viewport3DPane />
            </div>
          )}
        </main>
        {rightPanelOpen && (
          <aside className="app-shell__right">
            <InspectorPanel />
          </aside>
        )}
      </div>
    </div>
  )
}
