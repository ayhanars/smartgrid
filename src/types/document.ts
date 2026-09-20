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

export type TexturePattern =
  | 'ripples'
  | 'flutes'
  | 'waves'
  | 'stripes'
  | 'chevron'
  | 'grid'
  | 'checker'
  | 'bricks'
  | 'weave'
  | 'diamonds'
  | 'knurl'
  | 'honeycomb'
  | 'scales'
  | 'dots'
  | 'rings'
  | 'pebble'
  | 'carbon'
  | 'wood'
  | 'custom'

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
  /** 'cut' (default) sinks the pattern into the surface; 'raised' stands
   * it proud of the surface by the same depth. */
  relief?: 'cut' | 'raised'
  /** Turns the pattern on the wall, degrees (0 = as designed). */
  angle?: number
  /** The pattern fades to nothing over this many mm at the bottom and the
   * top of the wall. */
  fade?: number
  /** Through the wall: the shell cavity's wall follows the same pattern,
   * so the wall keeps its thickness and the inside shows the relief too. */
  through?: boolean
  /** Set on a cavity's texture derived from its solid's (see `through`):
   * pattern coordinates are measured on the solid's wall, so both line up. */
  derived?: { perimeter: number; height: number; phaseV: number }
}

export const TEXTURE_PATTERNS: { id: TexturePattern; label: string; hint: string }[] = [
  { id: 'ripples', label: 'Ripples', hint: 'horizontal waves' },
  { id: 'flutes', label: 'Flutes', hint: 'vertical waves' },
  { id: 'waves', label: 'Waves', hint: 'wavy lines' },
  { id: 'stripes', label: 'Stripes', hint: 'diagonal bands' },
  { id: 'chevron', label: 'Chevron', hint: 'zigzag lines' },
  { id: 'grid', label: 'Grid', hint: 'crossed grooves' },
  { id: 'checker', label: 'Checker', hint: 'raised squares' },
  { id: 'bricks', label: 'Bricks', hint: 'running bond' },
  { id: 'weave', label: 'Basket weave', hint: 'woven strips' },
  { id: 'diamonds', label: 'Diamonds', hint: 'diagonal grooves' },
  { id: 'knurl', label: 'Knurl', hint: 'fine grip pyramids' },
  { id: 'honeycomb', label: 'Honeycomb', hint: 'hex cells' },
  { id: 'scales', label: 'Scales', hint: 'overlapping arcs' },
  { id: 'dots', label: 'Dimples', hint: 'rounded pits' },
  { id: 'rings', label: 'Rings', hint: 'concentric circles' },
  { id: 'pebble', label: 'Leather', hint: 'pebbled grain' },
  { id: 'carbon', label: 'Carbon', hint: 'twill weave' },
  { id: 'wood', label: 'Wood grain', hint: 'wavy grain' },
  { id: 'custom', label: 'Your image', hint: 'uploaded SVG/PNG, dark = groove' },
]

export const DEFAULT_TEXTURE: SurfaceTexture = { pattern: 'grid', target: 'walls', size: 4, depth: 0.6 }

/** Real holes drilled through a shape's walls and/or top face in a
 * regular pattern — cut with CSG, so they go right through (or to a set
 * depth) and show up in the print. */
export type HoleShape = 'round' | 'square' | 'hex' | 'diamond' | 'triangle' | 'star' | 'slot-v' | 'slot-h' | 'slot-d'

export const HOLE_SHAPES: { id: HoleShape; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
  { id: 'hex', label: 'Hexagon' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'star', label: 'Star' },
  { id: 'slot-v', label: 'Vertical slot' },
  { id: 'slot-h', label: 'Horizontal slot' },
  { id: 'slot-d', label: 'Diagonal slot' },
]

export interface Perforation {
  shape: HoleShape
  pattern: 'grid' | 'staggered'
  /** Hole diameter / side, mm. */
  size: number
  /** Center-to-center spacing, mm. */
  spacing: number
  target: 'walls' | 'top' | 'both'
  /** Hole depth from the surface, mm; null = right through. */
  depth: number | null
  sides?: WallSide[]
  /** Plain margin left below the wall holes (from the shape's bottom) and
   * above them (from its top), mm. Margins rather than heights, so the
   * band follows the shape when its depth changes. Missing = 3 mm on a
   * shape 12 mm or taller, else none. */
  wallFrom?: number
  wallTopMargin?: number
  /** Plain margin kept around the top-face holes, mm. */
  topInset?: number
}

/** The default plain margin at the floor and the rim of a wall band. */
export function defaultWallMargin(depth: number): number {
  return depth >= 12 ? 3 : 0
}

/** A width profile along the height: control rings at heights (mm from
 * the shape's bottom) with the footprint's scale there (1 = as drawn).
 * Between rings the width follows a smooth curve, or straight lines. */
export interface ShapeProfile {
  points: ProfilePoint[]
  smooth: boolean
}

export interface ProfilePoint {
  z: number
  scale: number
}

export const DEFAULT_PERFORATION: Perforation = { shape: 'round', pattern: 'grid', size: 3, spacing: 5.5, target: 'walls', depth: null }

export interface ShellLink {
  solidId: string
  /** Wall thickness, mm. */
  wall: number
  /** Floor (or ceiling) thickness, mm, already rounded to whole layers. */
  floor: number
  openFrom: 'top' | 'bottom'
}

export interface ShapeLayer {
  id: string
  kind: ShapeKind
  name: string
  /** The build plate the shape sits on; missing means the first plate. */
  plateId?: string
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
  /** How wide the shape is along its height (a vase, a cone, a barrel):
   * the footprint scaled per height. Absent = straight walls. */
  profile?: ShapeProfile
  /** Twist: how far the footprint turns from the bottom to the top,
   * degrees (a twisted vase). Absent or 0 = none. */
  twist?: number
  /** For a layer that follows another (a shell cavity): the height frame
   * its profile and twist are measured in — the solid's bottom relative
   * to this layer's, and the solid's depth — so both bend identically. */
  bendFrame?: { z: number; depth: number }
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
  /** For a cavity made by "Hollow out": the solid it hollows and the wall
   * settings it was built with. The cavity is derived — whenever that
   * solid is resized, moved or reshaped, the cavity is rebuilt to match. */
  shellOf?: ShellLink
  polygonSides?: number
  starPoints?: number
  starInnerRatio?: number
}
