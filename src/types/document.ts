export interface Point2 {
  x: number
  y: number
}

export interface Contour {
  points: Point2[]
}

/** One paintable/extrudable region: an outer contour plus zero or more holes. */
export interface ShapeRegion {
  outer: Contour
  holes: Contour[]
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export type ShapeKind = 'rect' | 'circle' | 'polygon' | 'star' | 'hole'

export interface Transform2D {
  x: number
  y: number
  /** World-space print height (mm) of this shape's own bottom — independent
   * of everything else on the plate. 0 sits on the bed. A hole's z and
   * extrusionDepth are what make a recessed pocket possible: the cutter
   * doesn't have to span the full height of whatever it cuts. */
  z: number
  /** Euler angles in degrees, always applied in a fixed XYZ order in the
   * print frame (X/Y along the plate, Z up): `rotationX`/`rotationY` tilt
   * the object, `rotation` spins it about its own Z (the only one visible
   * in the 2D canvas). */
  rotationX: number
  rotationY: number
  rotation: number
}

export type InfillPattern = 'grid' | 'gyroid' | 'honeycomb' | 'lines' | 'triangles' | 'cubic'

/** Slicer-style settings the print preview simulates (mirrors the handful
 * of Bambu Studio "Quality/Strength" values that change what a printed
 * layer looks like). Saved with the project. */
export interface PrintSettings {
  /** mm per layer — what the preview slider steps through. */
  layerHeight: number
  wallLoops: number
  topLayers: number
  bottomLayers: number
  /** Sparse infill density, percent. */
  infillDensity: number
  infillPattern: InfillPattern
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  layerHeight: 0.2,
  wallLoops: 2,
  topLayers: 5,
  bottomLayers: 3,
  infillDensity: 15,
  infillPattern: 'grid',
}

export const LAYER_HEIGHT_PRESETS_MM = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28]

export const INFILL_PATTERNS: { id: InfillPattern; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'gyroid', label: 'Gyroid' },
  { id: 'honeycomb', label: 'Honeycomb' },
  { id: 'lines', label: 'Lines' },
  { id: 'triangles', label: 'Triangles' },
  { id: 'cubic', label: 'Cubic' },
]

export type TexturePattern = 'ripples' | 'flutes' | 'grid' | 'bricks' | 'diamonds' | 'honeycomb' | 'dots' | 'wood' | 'custom'

export type WallSide = 'front' | 'back' | 'left' | 'right'

/** Printable relief cut INTO a shape's surfaces (outer dimensions stay
 * exact): grooves on the side walls and/or the top face. On a hole
 * cutter it decorates the cavity walls instead. */
export interface SurfaceTexture {
  pattern: TexturePattern
  target: 'walls' | 'top' | 'both'
  /** Pattern repeat, mm. */
  size: number
  /** Groove depth, mm. */
  depth: number
  /** Which walls get the pattern (by the wall's outward direction on the
   * plate); missing = all of them. */
  sides?: WallSide[]
  /** Wall band, mm from the shape's bottom; missing = whole height. */
  wallFrom?: number
  wallTo?: number
  /** Plain rim left around the top-face pattern, mm. */
  topInset?: number
  /** Custom pattern: a small grayscale image (data URL) where dark = groove.
   * Only used when pattern === 'custom'. */
  tile?: string
  /** Custom pattern repeats (true) or is placed once, centered (false). */
  repeat?: boolean
}

export const TEXTURE_PATTERNS: { id: TexturePattern; label: string; hint: string }[] = [
  { id: 'ripples', label: 'Ripples', hint: 'horizontal waves' },
  { id: 'flutes', label: 'Flutes', hint: 'vertical waves' },
  { id: 'grid', label: 'Grid', hint: 'crossed grooves' },
  { id: 'bricks', label: 'Bricks', hint: 'running bond' },
  { id: 'diamonds', label: 'Diamonds', hint: 'diagonal knurl' },
  { id: 'honeycomb', label: 'Honeycomb', hint: 'hex cells' },
  { id: 'dots', label: 'Dimples', hint: 'rounded pits' },
  { id: 'wood', label: 'Wood grain', hint: 'wavy grain' },
  { id: 'custom', label: 'Your image', hint: 'uploaded SVG/PNG, dark = groove' },
]

export const DEFAULT_TEXTURE: SurfaceTexture = { pattern: 'grid', target: 'walls', size: 4, depth: 0.6 }

/** Real holes drilled through a shape's walls and/or top face in a
 * regular pattern — cut with CSG, so they go right through (or to a set
 * depth) and show up in the print. */
export interface Perforation {
  shape: 'round' | 'square' | 'hex'
  pattern: 'grid' | 'staggered'
  /** Hole diameter / side, mm. */
  size: number
  /** Center-to-center spacing, mm. */
  spacing: number
  target: 'walls' | 'top' | 'both'
  /** Hole depth from the surface, mm; null = right through. */
  depth: number | null
  sides?: WallSide[]
  wallFrom?: number
  wallTo?: number
  /** Plain margin kept around the top-face holes, mm. */
  topInset?: number
}

export const DEFAULT_PERFORATION: Perforation = { shape: 'round', pattern: 'grid', size: 3, spacing: 6, target: 'walls', depth: null }

export interface ShapeLayer {
  id: string
  kind: ShapeKind
  name: string
  visible: boolean
  locked: boolean
  color: string
  transform: Transform2D
  /** Local geometry, always starting at a (0,0) top-left local origin —
   * `transform.x/y` is where that origin lands on the document. */
  regions: ShapeRegion[]
  extrusionDepth: number
  cornerRadius: number
  /** Sharpness-adaptive corner softening intensity, in mm — unlike
   * `cornerRadius`, this only softens vertices whose interior angle is
   * already sharp, leaving gentle curves untouched. 0 = off. */
  smartPolish: number
  /** Requested straight chamfer into the bottom/top rim, in mm — the
   * geometry builder clamps each independently to whatever that shape's
   * outline can support without self-intersecting, so this is what the
   * user asked for, not necessarily what gets built. 0 = sharp edge. */
  bevelBottom: number
  bevelTop: number
  /** Optional printable surface relief (see SurfaceTexture). */
  texture?: SurfaceTexture
  /** Optional pattern of real holes (see Perforation). */
  perforation?: Perforation
  /** For hole cutters only: 'rim' (default) flares the bevels outward so
   * they round/countersink the mouth of the cut; 'shape' keeps the
   * cutter's own beveled edges, so a carved pocket has the tool's exact
   * shape (rounded floor edges from a bottom bevel, etc.). */
  bevelMode?: 'rim' | 'shape'
  /** True for a shape drawn with the Hole tool: never rendered as its own
   * solid, instead subtracted from whatever it overlaps in the 3D scene. */
  isHole: boolean
  /** 0–100 viewing opacity in both the 2D canvas and the 3D scene — a
   * see-through aid for lining things up, never exported (a print is
   * always solid). Missing means 100. */
  opacity?: number
  /** Membership in a group (see DocumentState.groups): clicking any member
   * on the canvas selects the whole group, like Figma. */
  groupId?: string
  polygonSides?: number
  starPoints?: number
  starInnerRatio?: number
}
