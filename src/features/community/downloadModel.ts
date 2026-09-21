import type { DocumentSnapshot } from '../../lib/persistence/localProjects'
import { bedPresets, getBedPreset } from '../../lib/geometry/bedPresets'
import { shapeWorldBounds } from '../../lib/geometry/layerBounds'
import { layerZRange } from '../../lib/geometry/layerGeometry'
import { buildExportMeshes, downloadBlob } from '../../lib/export/exportMeshes'
import { writeBinaryStl } from '../../lib/export/stl'
import { write3mf } from '../../lib/export/threeMf'
import { defaultPlates, layerPlateId } from '../../state/documentStore'

/** Footprint and height of the model, mm. With several plates it is the
 * largest plate's footprint: each plate has to fit the printer on its own. */
export function modelSize(snapshot: DocumentSnapshot): { width: number; depth: number; height: number; plates: number } {
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

/** True when every plate of the model fits this printer, in either orientation. */
export function fitsPrinter(size: { width: number; depth: number; height: number }, printerId: string): boolean {
  const bed = getBedPreset(printerId)
  if (!bed) return false
  return ((size.width <= bed.width && size.depth <= bed.height) || (size.depth <= bed.width && size.width <= bed.height)) && size.height <= bed.maxZ
}

/** The printer to offer first: the author's, or the first one the model fits. */
export function defaultPrinterFor(snapshot: DocumentSnapshot): string {
  const size = modelSize(snapshot)
  return fitsPrinter(size, snapshot.bedPresetId) ? snapshot.bedPresetId : (bedPresets.find((p) => fitsPrinter(size, p.id))?.id ?? snapshot.bedPresetId)
}

export const slugify = (title: string) => title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'model'

/** Builds and downloads a 3MF (every plate, printer + print settings) or an
 * STL of a shared model. Returns false when there is nothing to export. */
export async function downloadSnapshot(snapshot: DocumentSnapshot, title: string, format: '3mf' | 'stl', printer: string): Promise<boolean> {
  const bed = getBedPreset(printer)
  const plates = snapshot.plates && snapshot.plates.length > 1 ? snapshot.plates : undefined
  const layout = bed ? { plates: plates ?? [{ id: 'plate-1', name: 'Plate 1' }], bedWidth: bed.width, bedDepth: bed.height } : undefined
  const meshes = await buildExportMeshes(snapshot.layers, snapshot.order, layout)
  if (meshes.length === 0) return false
  const slug = slugify(title)
  if (format === 'stl') {
    downloadBlob(writeBinaryStl(meshes), `${slug}.stl`, 'model/stl')
    return true
  }
  const ps = snapshot.printSettings as unknown as Record<string, unknown>
  downloadBlob(
    write3mf(meshes, {
      plates: plates?.map((p) => p.name),
      bambu: { bedPresetId: printer, printSettings: snapshot.printSettings },
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
  return true
}
