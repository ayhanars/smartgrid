import { useState } from 'react'
import { TopBar } from './TopBar'
import { LayersPanel } from '../features/layers/LayersPanel'
import { InspectorPanel } from '../features/inspector/InspectorPanel'
import { Canvas2DPane } from '../features/canvas-2d/Canvas2DPane'
import { Viewport3DPane } from '../features/viewport-3d/Viewport3DPane'
import './AppShell.css'

export type ViewMode = 'split' | '2d' | '3d'

export function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

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
