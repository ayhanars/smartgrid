import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Download, Globe } from 'lucide-react'
import { artboardSize, layerPlateId, orderOnPlate, useDocumentStore } from '../../state/documentStore'
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
  const plates = useDocumentStore((s) => s.plates)
  const activePlateId = useDocumentStore((s) => s.activePlateId)
  const projectId = useDocumentStore((s) => s.projectId)
  const projectName = useDocumentStore((s) => s.projectName)
  const fileBase = projectName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'smartgrid'
  const multiPlate = plates.length > 1
  const solids = order.filter((id) => layers[id] && !layers[id].isHole && layers[id].visible)
  const activePlate = plates.find((p) => p.id === activePlateId) ?? plates[0]
  const solidsOnActive = solids.filter((id) => layerPlateId(layers[id], plates) === activePlateId)
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
      const state = useDocumentStore.getState()
      const bed = artboardSize(state)
      if (format === '3mf') {
        // A 3MF carries every plate: Bambu Studio opens it with the same plates.
        const meshes = await buildExportMeshes(layers, order, { plates, bedWidth: bed.width, bedDepth: bed.height })
        if (meshes.length === 0) return
        downloadBlob(write3mf(meshes, { plates: plates.map((p) => p.name) }), `${fileBase}.3mf`, 'model/3mf')
      } else {
        // STL has no plates, so it holds the plate you are looking at.
        const meshes = await buildExportMeshes(layers, orderOnPlate(state, activePlateId))
        if (meshes.length === 0) return
        const suffix = multiPlate ? `-${activePlate.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : ''
        downloadBlob(writeBinaryStl(meshes), `${fileBase}${suffix}.stl`, 'model/stl')
      }
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
            <span className="inspector-footer__menu-hint">{multiPlate ? `all ${plates.length} plates, colors kept` : 'colors kept per shape'}</span>
          </button>
          <button type="button" role="menuitem" disabled={solidsOnActive.length === 0} onClick={() => void exportAs('stl')}>
            Export STL
            <span className="inspector-footer__menu-hint">{multiPlate ? `${activePlate.name} only, geometry` : 'geometry only'}</span>
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
