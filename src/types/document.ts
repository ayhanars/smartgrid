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
  rotation: number
}

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
  /** True for a shape drawn with the Hole tool: never rendered as its own
   * solid, instead subtracted from whatever it overlaps in the 3D scene. */
  isHole: boolean
  /** Membership in a group (see DocumentState.groups): clicking any member
   * on the canvas selects the whole group, like Figma. */
  groupId?: string
  polygonSides?: number
  starPoints?: number
  starInnerRatio?: number
}
