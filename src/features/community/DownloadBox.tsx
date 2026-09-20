import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { DocumentSnapshot } from '../../lib/persistence/localProjects'
import { bedPresets, getBedPreset } from '../../lib/geometry/bedPresets'
import { shapeWorldBounds } from '../../lib/geometry/layerBounds'
import { layerZRange } from '../../lib/geometry/layerGeometry'
import { buildExportMeshes, downloadBlob } from '../../lib/export/exportMeshes'
import { writeBinaryStl } from '../../lib/export/stl'
import { write3mf } from '../../lib/export/threeMf'
import { recordCommunityDownload } from '../../lib/supabase/community'
import './community.css'

/** Footprint and height of the model, mm. */
function modelSize(snapshot: DocumentSnapshot): { width: number; depth: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let height = 0
  for (const id of snapshot.order) {
    const l = snapshot.layers[id]
    if (!l || !l.visible || l.isHole) continue
    const b = shapeWorldBounds(l)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
    height = Math.max(height, layerZRange(l).topZ)
  }
  if (!Number.isFinite(minX)) return { width: 0, depth: 0, height: 0 }
  return { width: maxX - minX, depth: maxY - minY, height }
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
  const supported = bedPresets.filter((p) => fits(p.id)).length
  const slug = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'model'

  const exportAs = async (format: '3mf' | 'stl') => {
    if (busy) return
    setBusy(format)
    try {
      const meshes = await buildExportMeshes(snapshot.layers, snapshot.order)
      if (meshes.length === 0) return
      if (format === 'stl') {
        downloadBlob(writeBinaryStl(meshes), `${slug}.stl`, 'model/stl')
      } else {
        const bed = getBedPreset(printer)
        const ps = snapshot.printSettings as unknown as Record<string, unknown>
        downloadBlob(
          write3mf(meshes, {
            Title: title,
            Printer: bed?.label,
            PlateWidthMM: bed?.width,
            PlateDepthMM: bed?.height,
            PlateMaxZMM: bed?.maxZ,
            LayerHeightMM: typeof ps.layerHeight === 'number' ? ps.layerHeight : undefined,
            WallLoops: typeof ps.wallLoops === 'number' ? ps.wallLoops : undefined,
            InfillPercent: typeof ps.infillDensity === 'number' ? ps.infillDensity : undefined,
            InfillPattern: typeof ps.infillPattern === 'string' ? ps.infillPattern : undefined,
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
      <div className="download-box__row">
        <button type="button" disabled={busy !== null || size.width === 0} onClick={() => void exportAs('3mf')}>
          <Download size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {busy === '3mf' ? 'Preparing…' : 'Download 3MF'}
        </button>
        <button type="button" disabled={busy !== null || size.width === 0} onClick={() => void exportAs('stl')}>
          {busy === 'stl' ? 'Preparing…' : 'Download STL'}
        </button>
      </div>
      <p className="download-box__hint">
        {Math.round(size.width)} × {Math.round(size.depth)} × {Math.round(size.height)} mm · fits {supported} of {bedPresets.length} printers. The 3MF carries the chosen plate size and the author's print settings; nothing is added to your projects.
      </p>
    </div>
  )
}
