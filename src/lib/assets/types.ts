import type { Perforation, ShapeKind, ShapeRegion, SurfaceTexture } from '../../types/document'
import type { ShellOptions } from '../geometry/shell'

/**
 * One shape inside an asset, in mm relative to the asset's top-left
 * corner. Everything a layer can carry is allowed, so an asset is just a
 * recipe for the same layers a user could have drawn by hand — and a
 * user's own selection can be captured back into one.
 */
export interface AssetPart {
  kind: ShapeKind
  name: string
  x: number
  y: number
  width: number
  height: number
  depth: number
  /** Print height of the part's bottom, mm (default 0). */
  z?: number
  rotation?: number
  color?: string
  cornerRadius?: number
  smartPolish?: number
  bevelBottom?: number
  bevelTop?: number
  polygonSides?: number
  starPoints?: number
  starInnerRatio?: number
  isHole?: boolean
  bevelMode?: 'rim' | 'shape'
  texture?: SurfaceTexture
  perforation?: Perforation
  /** Hollow this part out after placing it (the cavity follows it). */
  hollow?: ShellOptions
  /** An exact outline (a pen path, an import) instead of the kind's
   * primitive scaled to width × height. */
  regions?: ShapeRegion[]
}

export interface AssetDefinition {
  id: string
  name: string
  category: string
  description: string
  /** Footprint, mm. */
  width: number
  height: number
  parts: AssetPart[]
  /** Built-in assets ship with the app; the rest are the user's own. */
  builtin?: boolean
}
