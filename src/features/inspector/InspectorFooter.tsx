import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Download, Globe } from 'lucide-react'
import { useDocumentStore } from '../../state/documentStore'
import { buildExportMeshes, downloadBlob } from '../../lib/export/exportMeshes'
import { writeBinaryStl } from '../../lib/export/stl'
import { write3mf } from '../../lib/export/threeMf'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { requireAccount } from '../auth/authGate'
import { PublishDialog } from '../community/PublishDialog'
import '../layers/LayerContextMenu.css'

/**
 * Pinned to the bottom of the right panel whatever is selected: Export
 * (a small menu with the formats) stacked over Publish to community.
 */
export function InspectorFooter() {
  const layers = useDocumentStore((s) => s.layers)
  const order = useDocumentStore((s) => s.order)
  const projectId = useDocumentStore((s) => s.projectId)
  const solids = order.filter((id) => layers[id] && !layers[id].isHole && layers[id].visible)
  const colorCount = new Set(solids.map((id) => layers[id].color)).size

  const [menuOpen, setMenuOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [menuOpen])

  const exportAs = async (format: '3mf' | 'stl') => {
    setMenuOpen(false)
    if (preparing) return
    setPreparing(true)
    try {
      const meshes = await buildExportMeshes(layers, order)
      if (meshes.length === 0) return
      if (format === '3mf') downloadBlob(write3mf(meshes), 'smartgrid.3mf', 'model/3mf')
      else downloadBlob(writeBinaryStl(meshes), 'smartgrid.stl', 'model/stl')
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="inspector-footer" ref={ref}>
      {menuOpen && (
        <div className="layer-context-menu inspector-footer__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void exportAs('3mf')}>
            Export 3MF
            <span className="inspector-footer__menu-hint">colors kept per shape</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void exportAs('stl')}>
            Export STL
            <span className="inspector-footer__menu-hint">geometry only</span>
          </button>
          <div className="layer-context-menu__divider" />
          <div className="inspector-footer__menu-note">
            {solids.length} solid{solids.length === 1 ? '' : 's'}, {colorCount} color{colorCount === 1 ? '' : 's'}. Holes are already cut.
          </div>
        </div>
      )}
      <button
        type="button"
        className="inspector-footer__btn inspector-footer__btn--primary"
        disabled={solids.length === 0 || preparing}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={solids.length === 0 ? 'Draw a solid shape to export' : 'Download for your printer'}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Download size={14} />
        {preparing ? 'Preparing…' : 'Export'}
        <ChevronUp size={13} className="inspector-footer__chevron" />
      </button>
      {isSupabaseConfigured && (
        <button
          type="button"
          className="inspector-footer__btn"
          disabled={!projectId}
          title="Share a copy of this project with everyone"
          onClick={() => {
            if (requireAccount('community')) setPublishOpen(true)
          }}
        >
          <Globe size={14} />
          Publish to community
        </button>
      )}
      {publishOpen && projectId && <PublishDialog projectId={projectId} onClose={() => setPublishOpen(false)} />}
    </div>
  )
}
