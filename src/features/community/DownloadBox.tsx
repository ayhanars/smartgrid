import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import '../layers/LayerContextMenu.css'
import type { DocumentSnapshot } from '../../lib/persistence/localProjects'
import { bedPresets, getBedPreset } from '../../lib/geometry/bedPresets'
import { shapeWorldBounds } from '../../lib/geometry/layerBounds'
import { layerZRange } from '../../lib/geometry/layerGeometry'
import { buildExportMeshes, downloadBlob } from '../../lib/export/exportMeshes'
import { writeBinaryStl } from '../../lib/export/stl'
import { write3mf } from '../../lib/export/threeMf'
import { recordCommunityDownload } from '../../lib/supabase/community'
import { defaultPlates, layerPlateId } from '../../state/documentStore'
import './community.css'

/** Footprint and height of the model, mm. With several plates it is the
 * largest plate's footprint: each plate has to fit the printer on its own. */
function modelSize(snapshot: DocumentSnapshot): { width: number; depth: number; height: number; plates: number } {
  const plates = snapshot.plates && snapshot.plates.length > 0 ? snapshot.plates : defaultPlates()
  const size = { width: 0, depth: 0, height: 0, plates: plates.length }
  let any = false
  for (const plate of plates) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of snapshot.order) {
      const l = snapshot.layers[id]
      if (!l || !l.visible || l.isHole || layerPlateId(l, plates) !== plate.id) continue
      const b = shapeWorldBounds(l)
      minX = Math.min(minX, b.x)
      minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width)
      maxY = Math.max(maxY, b.y + b.height)
      size.height = Math.max(size.height, layerZRange(l).topZ)
    }
    if (!Number.isFinite(minX)) continue
    any = true
    size.width = Math.max(size.width, maxX - minX)
    size.depth = Math.max(size.depth, maxY - minY)
  }
  return any ? size : { width: 0, depth: 0, height: 0, plates: plates.length }
}

/**
 * Download the model straight from the community page, without making a
 * project: pick a printer (only those the model fits on are enabled) and
 * get a 3MF that carries the printer's plate size and the print settings,
 * or a plain STL.
 */
export function DownloadBox({ itemId, title, snapshot }: { itemId: string; title: string; snapshot: DocumentSnapshot }) {
  const size = useMemo(() => modelSize(snapshot), [snapshot])
  const fits = (id: string) => {
    const bed = getBedPreset(id)
    if (!bed) return false
    // Either orientation on the plate counts.
    return ((size.width <= bed.width && size.depth <= bed.height) || (size.depth <= bed.width && size.width <= bed.height)) && size.height <= bed.maxZ
  }
  const defaultPrinter = fits(snapshot.bedPresetId) ? snapshot.bedPresetId : (bedPresets.find((p) => fits(p.id))?.id ?? snapshot.bedPresetId)
  const [printer, setPrinter] = useState(defaultPrinter)
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
  const slug = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'model'

  const exportAs = async (format: '3mf' | 'stl') => {
    if (busy) return
    setBusy(format)
    try {
      const bed = getBedPreset(printer)
      const plates = snapshot.plates && snapshot.plates.length > 1 ? snapshot.plates : undefined
      const layout = plates && bed ? { plates, bedWidth: bed.width, bedDepth: bed.height } : undefined
      const meshes = await buildExportMeshes(snapshot.layers, snapshot.order, layout)
      if (meshes.length === 0) return
      if (format === 'stl') {
        downloadBlob(writeBinaryStl(meshes), `${slug}.stl`, 'model/stl')
      } else {
        const ps = snapshot.printSettings as unknown as Record<string, unknown>
        downloadBlob(
          write3mf(meshes, {
            plates: plates?.map((p) => p.name),
            metadata: {
            Title: title,
            Printer: bed?.label,
            PlateWidthMM: bed?.width,
            PlateDepthMM: bed?.height,
            PlateMaxZMM: bed?.maxZ,
            LayerHeightMM: typeof ps.layerHeight === 'number' ? ps.layerHeight : undefined,
            WallLoops: typeof ps.wallLoops === 'number' ? ps.wallLoops : undefined,
            InfillPercent: typeof ps.infillDensity === 'number' ? ps.infillDensity : undefined,
            InfillPattern: typeof ps.infillPattern === 'string' ? ps.infillPattern : undefined,
            },
          }),
          `${slug}-${printer}.3mf`,
          'model/3mf',
        )
      }
      void recordCommunityDownload(itemId)
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
