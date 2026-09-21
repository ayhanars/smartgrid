import type { Point2, SurfaceTexture } from '../../types/document'
import type { ShellOptions } from '../geometry/shell'

/** A value the user can set on a product: a number in mm (or a count),
 * a choice, or a switch. */
export type SpecValue = number | string | boolean

export type SpecField =
  | { kind: 'number'; id: string; label: string; unit?: 'mm' | ''; min: number; max: number; step?: number; hint?: string }
  | { kind: 'select'; id: string; label: string; options: { value: string; label: string }[]; hint?: string }
  | { kind: 'boolean'; id: string; label: string; hint?: string }

export type ProductSpec = Record<string, SpecValue>

/** One printable piece of a product, as the document will hold it: an
 * outline (a primitive or a drawn path), its height, its tilt, and what
 * to do to it once it exists. Positions are relative to the product's
 * top-left corner on the canvas (document mm). */
export interface PartRecipe {
  name: string
  color?: string
  outline: { kind: 'rect' | 'circle'; x: number; y: number; width: number; height: number } | { kind: 'path'; points: Point2[] }
  /** Extrusion height, mm. */
  depth: number
  cornerRadius?: number
  /** Fillet on both ends of the extrusion, mm (a peg rounded to fit a
   * round hole). */
  bevel?: number
  /** Height above the bed after the tilt is applied, mm. */
  z?: number
  rotation?: { x?: number; y?: number; z?: number }
  hollow?: ShellOptions
  texture?: SurfaceTexture
  isHole?: boolean
}

export interface ProductBuild {
  /** Footprint of the whole product on the canvas, mm. */
  width: number
  height: number
  parts: PartRecipe[]
  /** Whether the parts are meant to print as one body (the exporter
   * fuses them) — a box with its hooks, as opposed to a set of pieces. */
  fuse?: boolean
}

/** What the 2D fit preview draws: the board's pattern, the product seen
 * from the back (its silhouette) and where its tabs meet the sheet. */
export interface MountPreview {
  pattern: import('./boards').PegPattern
  /** Back-view silhouette, mm. */
  silhouette: { width: number; height: number }
  /** Tabs / pegs in silhouette coordinates (from its top-left), mm. */
  anchors: { x: number; y: number; width: number; height: number }[]
  caption?: string
}

export interface ProductTemplate {
  id: string
  name: string
  /** Short line under the name in the picker. */
  tagline: string
  category: string
  /** Keywords the search also matches. */
  keywords?: string[]
  fields: SpecField[]
  defaults: ProductSpec
  /** Lays the product out from a spec. Never throws for a spec within
   * the fields' ranges. */
  build: (spec: ProductSpec) => ProductBuild
  /** A few sentences on how it prints and mounts, shown under the form. */
  notes?: string
  /** The fit preview for a spec, when the product mounts on a board. */
  preview?: (spec: ProductSpec) => MountPreview
}

/** What a generated group remembers, so its specs can be changed later. */
export interface ProductRecipe {
  template: string
  spec: ProductSpec
  fuse?: boolean
}

export function num(spec: ProductSpec, id: string, fallback: number): number {
  const v = spec[id]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function str(spec: ProductSpec, id: string, fallback: string): string {
  const v = spec[id]
  return typeof v === 'string' ? v : fallback
}

export function bool(spec: ProductSpec, id: string, fallback: boolean): boolean {
  const v = spec[id]
  return typeof v === 'boolean' ? v : fallback
}

/** A spec with every value clamped into its field's range. */
export function cleanSpec(template: ProductTemplate, spec: ProductSpec): ProductSpec {
  const out: ProductSpec = { ...template.defaults }
  for (const f of template.fields) {
    const v = spec[f.id]
    if (f.kind === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) {
        const step = f.step ?? 0.1
        out[f.id] = Math.min(f.max, Math.max(f.min, Math.round(v / step) * step))
      }
    } else if (f.kind === 'select') {
      if (typeof v === 'string' && f.options.some((o) => o.value === v)) out[f.id] = v
    } else if (typeof v === 'boolean') out[f.id] = v
  }
  return out
}
