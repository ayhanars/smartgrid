import type { ProductTemplate } from './types'
import { skadisContainer, skadisHook } from './skadis'
import { brorBin, brorHook } from './bror'

export * from './types'
export { SKADIS } from './skadis'
export * from './boards'

/** Every product the Create panel offers, in display order. */
export const PRODUCT_TEMPLATES: ProductTemplate[] = [skadisContainer, skadisHook, brorBin, brorHook]

export function productTemplate(id: string): ProductTemplate | undefined {
  return PRODUCT_TEMPLATES.find((t) => t.id === id)
}

export function searchTemplates(query: string, category?: string): ProductTemplate[] {
  const q = query.trim().toLowerCase()
  return PRODUCT_TEMPLATES.filter((t) => {
    if (category && t.category !== category) return false
    if (!q) return true
    return [t.name, t.tagline, t.category, ...(t.keywords ?? [])].some((s) => s.toLowerCase().includes(q))
  })
}
