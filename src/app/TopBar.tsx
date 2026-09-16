import {
  ChevronDown,
  Command,
  Redo2,
  Undo2,
  PanelLeft,
  PanelRight,
  SquareSplitHorizontal,
  Square,
  Box,
} from 'lucide-react'
import { IconButton } from '../components/IconButton'
import { useTemporalStore } from '../state/documentStore'
import type { ViewMode } from './AppShell'
import './TopBar.css'

interface TopBarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  leftPanelOpen: boolean
  onToggleLeftPanel: () => void
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
}

export function TopBar({
  viewMode,
  onViewModeChange,
  leftPanelOpen,
  onToggleLeftPanel,
  rightPanelOpen,
  onToggleRightPanel,
}: TopBarProps) {
  const { undo, redo, pastStates, futureStates } = useTemporalStore()

  return (
    <header className="top-bar">
      <div className="top-bar__section">
        <button type="button" className="top-bar__workspace">
          <span className="top-bar__logo">sg</span>
          <span>smartgrid</span>
          <ChevronDown size={14} />
        </button>
        <div className="top-bar__divider" />
        <IconButton size="sm" aria-label="Undo" disabled={!pastStates.length} onClick={() => undo()}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton size="sm" aria-label="Redo" disabled={!futureStates.length} onClick={() => redo()}>
          <Redo2 size={15} />
        </IconButton>
      </div>

      <div className="top-bar__section top-bar__center">
        <button type="button" className="top-bar__title">
          Untitled project
        </button>
      </div>

      <div className="top-bar__section top-bar__right">
        <button type="button" className="top-bar__actions">
          <Command size={13} />
          <span>K</span>
        </button>
        <div className="top-bar__divider" />
        <div className="top-bar__view-toggle">
          <IconButton
            size="sm"
            active={viewMode === '2d'}
            aria-label="2D only"
            onClick={() => onViewModeChange('2d')}
          >
            <Square size={15} />
          </IconButton>
          <IconButton
            size="sm"
            active={viewMode === 'split'}
            aria-label="Split view"
            onClick={() => onViewModeChange('split')}
          >
            <SquareSplitHorizontal size={15} />
          </IconButton>
          <IconButton
            size="sm"
            active={viewMode === '3d'}
            aria-label="3D only"
            onClick={() => onViewModeChange('3d')}
          >
            <Box size={15} />
          </IconButton>
        </div>
        <div className="top-bar__divider" />
        <IconButton size="sm" active={leftPanelOpen} aria-label="Toggle layers panel" onClick={onToggleLeftPanel}>
          <PanelLeft size={15} />
        </IconButton>
        <IconButton size="sm" active={rightPanelOpen} aria-label="Toggle inspector panel" onClick={onToggleRightPanel}>
          <PanelRight size={15} />
        </IconButton>
      </div>
    </header>
  )
}
