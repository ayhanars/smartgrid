import { currentUserId, isSupabaseConfigured, supabase } from './client'
import { PRODUCT_TEMPLATES, type ProductTemplate } from '../products'

/** How the Create panel's products are shown on the home and community
 * pages: which are on, their picture, their order and a "New" badge
 * that expires (public.generator_cards, managed by admins). */
export interface GeneratorCard {
  template: string
  enabled: boolean
  thumbnailUrl: string | null
  sort: number
  newUntil: number | null
  /** The template behind it (the app knows the products, not the DB). */
  product: ProductTemplate
}

interface Row {
  template: string
  enabled: boolean
  thumbnail_url: string | null
  sort: number
  new_until: string | null
}

const fallback = (): GeneratorCard[] => PRODUCT_TEMPLATES.map((product, i) => ({ template: product.id, enabled: true, thumbnailUrl: null, sort: (i + 1) * 10, newUntil: null, product }))

/** Every product with its card; templates the table does not know yet
 * are on, with no picture. Without Supabase, all of them. */
export async function listGeneratorCards(): Promise<GeneratorCard[]> {
  if (!isSupabaseConfigured) return fallback()
  const { data, error } = await supabase.from('generator_cards').select('template, enabled, thumbnail_url, sort, new_until')
  if (error) throw error
  const rows = new Map((data as Row[]).map((r) => [r.template, r]))
  return PRODUCT_TEMPLATES.map((product, i) => {
    const r = rows.get(product.id)
    return {
      template: product.id,
      enabled: r ? r.enabled : true,
      thumbnailUrl: r?.thumbnail_url ?? null,
      sort: r ? r.sort : 1000 + i,
      newUntil: r?.new_until ? Date.parse(r.new_until) : null,
      product,
    }
  }).sort((a, b) => a.sort - b.sort)
}

export const isNewCard = (c: GeneratorCard) => c.newUntil !== null && c.newUntil > Date.now()

/** Admins only (RLS refuses everyone else). */
export async function saveGeneratorCard(template: string, patch: { enabled?: boolean; thumbnailUrl?: string | null; sort?: number; newUntil?: number | null }): Promise<void> {
  const row: Partial<Row> & { template: string; updated_at: string; updated_by: string | null } = { template, updated_at: new Date().toISOString(), updated_by: await currentUserId() }
  if (patch.enabled !== undefined) row.enabled = patch.enabled
  if (patch.thumbnailUrl !== undefined) row.thumbnail_url = patch.thumbnailUrl
  if (patch.sort !== undefined) row.sort = patch.sort
  if (patch.newUntil !== undefined) row.new_until = patch.newUntil === null ? null : new Date(patch.newUntil).toISOString()
  const { error } = await supabase.from('generator_cards').upsert(row)
  if (error) throw error
}

const THUMB_W = 960
const THUMB_H = 720

/** Fits the picture into 4:3 (cover crop) and uploads it under the
 * admin's own covers folder, which is what the storage policy allows. */
export async function uploadGeneratorThumbnail(template: string, file: File): Promise<string> {
  const owner = await currentUserId()
  if (!owner) throw new Error('Not signed in')
  const url = URL.createObjectURL(file)
  let blob: Blob
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That file is not an image we can read'))
      el.src = url
    })
    const scale = Math.max(THUMB_W / img.naturalWidth, THUMB_H / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    const canvas = document.createElement('canvas')
    canvas.width = THUMB_W
    canvas.height = THUMB_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process the image')
    ctx.drawImage(img, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/jpeg', 0.86))
  } finally {
    URL.revokeObjectURL(url)
  }
  const path = `${owner}/generators/${template}.jpg`
  const { error } = await supabase.storage.from('covers').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const { data } = supabase.storage.from('covers').getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}
