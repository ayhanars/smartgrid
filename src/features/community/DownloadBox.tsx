import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import '../layers/LayerContextMenu.css'
import type { DocumentSnapshot } from '../../lib/persistence/localProjects'
import { bedPresets } from '../../lib/geometry/bedPresets'
import { recordCommunityDownload } from '../../lib/supabase/community'
import { defaultPrinterFor, downloadSnapshot, fitsPrinter, modelSize } from './downloadModel'
import './community.css'

/**
 * Download the model straight from the community page, without making a
 * project: pick a printer (only those the model fits on are enabled) and
 * get a 3MF that carries the printer's plate size and the print settings,
 * or a plain STL.
 */
export function DownloadBox({ itemId, title, snapshot }: { itemId: string; title: string; snapshot: DocumentSnapshot }) {
  const size = useMemo(() => modelSize(snapshot), [snapshot])
  const fits = (id: string) => fitsPrinter(size, id)
  const [printer, setPrinter] = useState(() => defaultPrinterFor(snapshot))
  const [busy, setBusy] = useState<'3mf' | 'stl' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [menuOpen])
  const supported = bedPresets.filter((p) => fits(p.id)).length

  const exportAs = async (format: '3mf' | 'stl') => {
    if (busy) return
    setBusy(format)
    try {
      if (await downloadSnapshot(snapshot, title, format, printer)) void recordCommunityDownload(itemId)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="download-box">
      <h2>Print it as is</h2>
      <div className="download-box__printers" role="group" aria-label="Printer">
        {bedPresets.map((p) => (
          <button key={p.id} type="button" aria-pressed={printer === p.id} disabled={!fits(p.id)} title={fits(p.id) ? `${p.width} × ${p.height} × ${p.maxZ} mm` : 'The model does not fit this printer'} onClick={() => setPrinter(p.id)}>
            {p.label.replace('Bambu Lab ', '')}
          </button>
        ))}
      </div>
      <div className="download-box__split" ref={menuRef}>
        <button type="button" className="download-box__primary" disabled={busy !== null || size.width === 0} onClick={() => void exportAs('3mf')}>
          <Download size={15} />
          {busy ? 'Preparing…' : 'Download 3MF'}
        </button>
        <button type="button" className="download-box__more" aria-label="Other formats" aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy !== null || size.width === 0} onClick={() => setMenuOpen((o) => !o)}>
          <ChevronDown size={15} />
        </button>
        {menuOpen && (
          <div className="layer-context-menu download-box__menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                void exportAs('3mf')
              }}
            >
              Download 3MF
              <span className="download-box__menu-hint">{size.plates > 1 ? `${size.plates} plates + print settings` : 'plate + print settings'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                void exportAs('stl')
              }}
            >
              Download STL
              <span className="download-box__menu-hint">geometry only</span>
            </button>
          </div>
        )}
      </div>
      <p className="download-box__hint">
        {size.plates > 1 ? `${size.plates} plates, largest ` : ''}
        {Math.round(size.width)} × {Math.round(size.depth)} × {Math.round(size.height)} mm · fits {supported} of {bedPresets.length} printers. The 3MF carries the chosen plate size{size.plates > 1 ? ', every plate' : ''} and the author's print settings; nothing is added to your projects.
      </p>
    </div>
  )
}
