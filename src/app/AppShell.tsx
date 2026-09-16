import { useEffect, useState } from 'react'
import { TopBar } from './TopBar'
import { LayersPanel } from '../features/layers/LayersPanel'
import { InspectorPanel } from '../features/inspector/InspectorPanel'
import { Canvas2DPane } from '../features/canvas-2d/Canvas2DPane'
import { Viewport3DPane } from '../features/viewport-3d/Viewport3DPane'
import { useDocumentStore } from '../state/documentStore'
import './AppShell.css'

export type ViewMode = 'split' | '2d' | '3d'

export function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      const mod = e.metaKey || e.ctrlKey
      const { selection, removeShapes, setSelection } = useDocumentStore.getState()

      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault()
        removeShapes(selection)
      } else if (e.key === 'Escape' && selection.length) {
        setSelection([])
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

  return (
    <div className="app-shell">
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
            <LayersPanel />
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
