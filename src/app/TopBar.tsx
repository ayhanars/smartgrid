import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  Command,
  Copy,
  FilePlus,
  FolderOpen,
  Layers,
  Pencil,
  Redo2,
  Trash2,
  Undo2,
  Upload,
  PanelLeft,
  PanelRight,
  SquareSplitHorizontal,
  Square,
  Box,
  Cloud,
  CloudOff,
  Globe,
} from 'lucide-react'
import { IconButton } from '../components/IconButton'
import { emptyDocument, serializeDocument, useDocumentStore, useTemporalStore } from '../state/documentStore'
import { useViewStore } from '../state/viewStore'
import { createLocalProject, duplicateLocalProject, saveLocalProject } from '../lib/persistence/localProjects'
import { deleteProjectEverywhere } from '../lib/persistence/cloudSync'
import { UserMenu } from '../features/auth/UserMenu'
import { requireAccount } from '../features/auth/authGate'
import { useAuthStore } from '../features/auth/useAuthStore'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { useConnectivity } from '../lib/connectivity'
import { PublishDialog } from '../features/community/PublishDialog'
import { PlateTabs } from '../features/plates/PlateTabs'
import { importSvgFiles } from '../lib/import/importSvgFiles'
import type { ViewMode } from './AppShell'
import '../features/layers/LayerContextMenu.css'
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
  const navigate = useNavigate()
  const { undo, redo, pastStates, futureStates } = useTemporalStore()
  const projectId = useDocumentStore((s) => s.projectId)
  const projectName = useDocumentStore((s) => s.projectName)
  const setProjectName = useDocumentStore((s) => s.setProjectName)
  const printPreview = useViewStore((s) => s.printPreview)
  const setPrintPreview = useViewStore((s) => s.setPrintPreview)
  const saveStatus = useViewStore((s) => s.saveStatus)
  const cloudStatus = useViewStore((s) => s.cloudStatus)
  const online = useConnectivity((s) => s.online)
  const authLoading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const guest = isSupabaseConfigured && !authLoading && user === null

  const [menuOpen, setMenuOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [draft, setDraft] = useState(projectName)
  const workspaceRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setDraft(projectName), [projectName, editingName])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current && !menuRef.current.contains(t) && !workspaceRef.current?.contains(t)) setMenuOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [menuOpen])

  // Make sure the on-disk copy is current before it is duplicated — the
  // autosave may still be a few hundred ms behind the last edit.
  const saveNow = () => {
    if (projectId) saveLocalProject(projectId, serializeDocument(useDocumentStore.getState()))
  }
  const commitName = () => {
    setProjectName(draft)
    setEditingName(false)
  }
  const run = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }
  const goHome = () => navigate('/')
  const newProject = () => {
    const meta = createLocalProject(emptyDocument())
    navigate(`/p/${meta.id}`)
  }
  const duplicateProject = () => {
    if (!projectId) return
    saveNow()
    const copy = duplicateLocalProject(projectId)
    if (copy) navigate(`/p/${copy.id}`)
  }
  const deleteProject = () => {
    if (!projectId) return
    const where = cloudStatus === 'off' ? 'from this browser' : 'from this browser and the cloud'
    if (!window.confirm(`Delete "${projectName}" ${where}? This can't be undone.`)) return
    void deleteProjectEverywhere(projectId)
    navigate('/')
  }

  const menuPos = workspaceRef.current?.getBoundingClientRect()

  return (
    <header className="top-bar">
      <div className="top-bar__section">
        <button
          ref={workspaceRef}
          type="button"
          className={`top-bar__workspace ${menuOpen ? 'top-bar__workspace--open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="top-bar__logo">sg</span>
          <span>smartgrid</span>
          <ChevronDown size={14} />
        </button>
        {menuOpen && menuPos && (
          <div ref={menuRef} className="layer-context-menu top-bar__menu" style={{ left: menuPos.left, top: menuPos.bottom + 6 }} role="menu">
            <button type="button" role="menuitem" onClick={run(goHome)}>
              <FolderOpen size={13} />
              All projects
            </button>
            <button type="button" role="menuitem" onClick={run(newProject)}>
              <FilePlus size={13} />
              New project
            </button>
            <div className="layer-context-menu__divider" />
            <button type="button" role="menuitem" onClick={run(() => fileInputRef.current?.click())}>
              <Upload size={13} />
              Import SVG…
            </button>
            <div className="layer-context-menu__divider" />
            <button type="button" role="menuitem" onClick={run(() => setEditingName(true))}>
              <Pencil size={13} />
              Rename project
            </button>
            <button type="button" role="menuitem" disabled={!projectId} onClick={run(duplicateProject)}>
              <Copy size={13} />
              Duplicate project
            </button>
            {isSupabaseConfigured && (
              <>
                <div className="layer-context-menu__divider" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={!projectId}
                  onClick={run(() => {
                    if (requireAccount('community')) setPublishOpen(true)
                  })}
                >
                  <Globe size={13} />
                  Publish to community…
                </button>
              </>
            )}
            <div className="layer-context-menu__divider" />
            <button type="button" role="menuitem" className="layer-context-menu__danger" disabled={!projectId} onClick={run(deleteProject)}>
              <Trash2 size={13} />
              Delete project
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          hidden
          aria-label="Import SVG file"
          onChange={(e) => {
            if (e.target.files?.length) void importSvgFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="top-bar__divider" />
        <IconButton size="sm" aria-label="Undo" disabled={!pastStates.length} onClick={() => undo()}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton size="sm" aria-label="Redo" disabled={!futureStates.length} onClick={() => redo()}>
          <Redo2 size={15} />
        </IconButton>
      </div>

      <div className="top-bar__section top-bar__center">
        {editingName ? (
          <input
            className="top-bar__title-input"
            value={draft}
            autoFocus
            aria-label="Project name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              else if (e.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <button type="button" className="top-bar__title" title="Rename project" onClick={() => setEditingName(true)}>
            {projectName}
          </button>
        )}
        <span
          className={`top-bar__save ${cloudStatus === 'error' || cloudStatus === 'offline' ? 'top-bar__save--warn' : ''}`}
          aria-live="polite"
          title={
            cloudStatus === 'error'
              ? 'The last cloud save failed; your changes are still saved in this browser.'
              : cloudStatus === 'offline'
                ? 'No connection: changes are saved in this browser and will upload when you are back online.'
                : guest
                  ? 'Guest mode: this project is saved only in this browser.'
                  : undefined
          }
        >
          {saveStatus === 'saving'
            ? 'Saving…'
            : cloudStatus === 'syncing'
              ? 'Syncing to cloud…'
              : cloudStatus === 'synced'
                ? 'Saved to cloud'
                : cloudStatus === 'error'
                  ? 'Not uploaded to cloud'
                  : cloudStatus === 'offline'
                    ? 'Offline · not uploaded'
                    : saveStatus === 'saved'
                      ? guest
                        ? 'Saved in this browser'
                        : 'Saved locally'
                      : ''}
          {cloudStatus === 'synced' && <Cloud size={12} />}
          {(cloudStatus === 'error' || cloudStatus === 'offline') && <CloudOff size={12} />}
        </span>
        {guest && (
          <button type="button" className="top-bar__guest" title="You are not signed in. Click to learn what an account adds." onClick={() => requireAccount('cloud')}>
            Guest
          </button>
        )}
        {!online && !guest && cloudStatus !== 'offline' && (
          <span className="top-bar__offline" title="No connection: cloud features are paused until you are back online.">
            <CloudOff size={12} />
            Offline
          </span>
        )}
        <PlateTabs />
      </div>

      <div className="top-bar__section top-bar__right">
        <button type="button" className="top-bar__actions">
          <Command size={13} />
          <span>K</span>
        </button>
        <div className="top-bar__divider" />
        <button
          type="button"
          className={`top-bar__pill ${printPreview ? 'top-bar__pill--active' : ''}`}
          aria-pressed={printPreview}
          aria-label="Print preview"
          title="Watch the model build up layer by layer, with walls and infill"
          onClick={() => setPrintPreview(!printPreview)}
        >
          <Layers size={14} />
          <span>Print preview</span>
        </button>
        <div className="top-bar__divider" />
        <div className="top-bar__view-toggle">
          <IconButton size="sm" active={viewMode === '2d'} aria-label="2D only" onClick={() => onViewModeChange('2d')}>
            <Square size={15} />
          </IconButton>
          <IconButton size="sm" active={viewMode === 'split'} aria-label="Split view" onClick={() => onViewModeChange('split')}>
            <SquareSplitHorizontal size={15} />
          </IconButton>
          <IconButton size="sm" active={viewMode === '3d'} aria-label="3D only" onClick={() => onViewModeChange('3d')}>
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
        <div className="top-bar__divider" />
        <UserMenu compact />
      </div>
      {publishOpen && projectId && <PublishDialog projectId={projectId} onClose={() => setPublishOpen(false)} />}
    </header>
  )
}
