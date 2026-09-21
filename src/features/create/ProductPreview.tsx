import type { ProductPreview as ProductPreviewData } from '../../lib/products'
import { BoardPreview } from './BoardPreview'
import { TrayPreview } from './TrayPreview'

/** The right simulator for a product: the pegboard fit, or the tray. */
export function ProductPreview({ preview }: { preview: ProductPreviewData }) {
  if (preview.kind === 'tray') return <TrayPreview preview={preview} />
  return <BoardPreview preview={preview} />
}
