import type { Point2 } from '../../types/document'
import { artboardSize, useDocumentStore } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { importSvg } from './svgImport'

/**
 * Imports every .svg in `files` into the current document, centered on
 * `at` (document mm) or on the plate, and reports what happened through
 * the view store's notice. Shared by the top-bar menu and canvas drop.
 */
export async function importSvgFiles(files: FileList | File[], at?: Point2): Promise<string[]> {
  const svgFiles = Array.from(files).filter((f) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name))
  const notify = useViewStore.getState().setNotice
  if (svgFiles.length === 0) {
    notify('Drop an .svg file to import it.')
    return []
  }
  const allIds: string[] = []
  let offset = 0
  for (const file of svgFiles) {
    let text: string
    try {
      text = await file.text()
    } catch {
      notify(`Couldn't read ${file.name}.`)
      continue
    }
    try {
      const result = importSvg(text)
      if (result.shapes.length === 0) {
        notify(`${file.name}: nothing importable found${result.skippedText ? ' (text needs to be converted to outlines first)' : ''}.`)
        continue
      }
      const state = useDocumentStore.getState()
      const bed = artboardSize(state)
      const center = at ?? { x: bed.width / 2, y: bed.height / 2 }
      const origin = { x: center.x - result.widthMM / 2 + offset, y: center.y - result.heightMM / 2 + offset }
      const ids = state.addImportedShapes(result.shapes, origin, file.name.replace(/\.svg$/i, ''))
      allIds.push(...ids)
      offset += 10
      const skipped = result.skippedText + result.skippedOther
      notify(
        `Imported ${ids.length} shape${ids.length === 1 ? '' : 's'} from ${file.name} (${Math.round(result.widthMM)} × ${Math.round(result.heightMM)} mm)` +
          (skipped ? ` — ${result.skippedText ? `${result.skippedText} text element${result.skippedText === 1 ? '' : 's'} skipped (convert text to outlines first)` : `${skipped} unsupported element${skipped === 1 ? '' : 's'} skipped`}` : ''),
      )
    } catch (err) {
      notify(`${file.name}: ${err instanceof Error ? err.message : 'import failed'}`)
    }
  }
  return allIds
}
