import { PRODUCT_TEMPLATES, cleanSpec, productTemplate } from './index'
import type { ProductSpec, ProductTemplate, SpecField } from './types'

/**
 * A product as a portable recipe: the template and its settings, which
 * is all the generator needs to rebuild it exactly. Shared as a prompt
 * (a plain-language description for an image or chat tool, with the
 * JSON under it), as the JSON alone, or as a link that opens the
 * Create panel on it.
 */
export interface ProductRecipe {
  template: string
  spec: ProductSpec
}

const SITE = 'https://ayhanars.github.io/smartgrid/'

function fieldText(f: SpecField, value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (f.kind === 'number') return `${f.label.toLowerCase()} ${value}${f.unit === 'mm' ? ' mm' : ''}`
  if (f.kind === 'select') {
    const o = f.options.find((x) => x.value === String(value))
    return `${f.label.toLowerCase()}: ${o?.label ?? String(value)}`
  }
  return value ? f.label.toLowerCase() : null
}

/** One paragraph a person (or an image model) can picture the piece from. */
export function describeProduct(t: ProductTemplate, spec: ProductSpec): string {
  const clean = cleanSpec(t, spec)
  const parts = t.fields.map((f) => fieldText(f, clean[f.id])).filter((x): x is string => !!x)
  const notes = t.notes ? ` ${t.notes}` : ''
  return `${t.name} (${t.category}): ${t.tagline}. Settings: ${parts.join(', ')}.${notes}`
}

export function recipeJson(t: ProductTemplate, spec: ProductSpec): string {
  return JSON.stringify({ smartgrid: 1, template: t.id, spec: cleanSpec(t, spec) }, null, 2)
}

/** Scenes and finishes the prompt picks from, so two people asking for
 * the same part do not get the same picture. */
const SCENES = [
  'hanging on a pegboard in a tidy home workshop, soft daylight from a window',
  'on a white studio background with a soft shadow, catalogue style',
  'on a pegboard above a wooden workbench, warm evening light',
  'in a bright kitchen, mounted on the wall beside the counter',
  'in a garage with tools around, cool neutral light',
  'in a craft room, pastel wall, morning light',
  'on a slatwall in a studio, dramatic side light',
]
const COLOURS = ['matte blue', 'matte white', 'matte black', 'matte light grey', 'matte orange', 'matte sage green', 'matte dark teal']
const pickOne = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

/** The prompt: what it is, what it looks like, how to get it back. */
export function buildPrompt(t: ProductTemplate, spec: ProductSpec): string {
  return [
    `Make one realistic product mockup, 16:9, of this 3D-printed part: ${describeProduct(t, spec)}`,
    `Show the whole part once, every hook, stud and compartment visible, as one object; no close-ups, no detail views, no exploded or multi-angle layout. ${pickOne(COLOURS)} PLA plastic with faint layer lines, ${pickOne(SCENES)}. Keep every proportion as the settings say; the settings are in mm.`,
    ``,
    `Recipe (keep it unchanged; pasting it into smartgrid → Create → Paste recipe rebuilds the exact part):`,
    '```json',
    recipeJson(t, spec),
    '```',
    `${SITE}#/new?create=${encodeURIComponent(t.id)}&spec=${encodeSpecParam(cleanSpec(t, spec))}`,
  ].join('\n')
}

export function encodeSpecParam(spec: ProductSpec): string {
  const json = JSON.stringify(spec)
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeSpecParam(param: string): ProductSpec | null {
  try {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))))
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ProductSpec) : null
  } catch {
    return null
  }
}

/** Reads a recipe out of pasted text: the JSON itself, or any text with
 * a `{ "template": …, "spec": … }` object in it (a prompt, a chat
 * answer), or a smartgrid link carrying one. */
export function parseRecipe(text: string): ProductRecipe | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const link = trimmed.match(/[?&]create=([^&\s]+)(?:&spec=([^&\s]+))?/)
  if (link) {
    const t = productTemplate(decodeURIComponent(link[1]))
    if (t) return { template: t.id, spec: cleanSpec(t, (link[2] && decodeSpecParam(link[2])) || {}) }
  }
  const candidates: string[] = []
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) candidates.push(fence[1])
  candidates.push(trimmed)
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c)
      const found = findRecipe(v)
      if (found) return found
    } catch {
      /* try the next form */
    }
  }
  return null
}

function findRecipe(v: unknown): ProductRecipe | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = typeof o.template === 'string' ? o.template : typeof o.id === 'string' ? o.id : null
  const t = id ? productTemplate(id) ?? PRODUCT_TEMPLATES.find((x) => x.name.toLowerCase() === id.toLowerCase()) : undefined
  if (t) {
    const spec = o.spec && typeof o.spec === 'object' ? (o.spec as ProductSpec) : (o as ProductSpec)
    return { template: t.id, spec: cleanSpec(t, spec) }
  }
  for (const k of Object.keys(o)) {
    const inner = findRecipe(o[k])
    if (inner) return inner
  }
  return null
}
