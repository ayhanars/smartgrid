import type { ProductPreview as ProductPreviewData } from '../../lib/products'
import { BoardPreview } from './BoardPreview'
import { TrayPreview } from './TrayPreview'
import { MapPreview } from './MapPreview'

/** The right simulator for a product: the pegboard fit, or the tray. */
export function ProductPreview({ preview, large = false }: { preview: ProductPreviewData; large?: boolean }) {
  if (preview.kind === 'tray') return <TrayPreview preview={preview} large={large} />
  if (preview.kind === 'map') return <MapPreview preview={preview} large={large} />
  return <BoardPreview preview={preview} large={large} />
}
