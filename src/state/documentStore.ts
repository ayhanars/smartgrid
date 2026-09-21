import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import { DEFAULT_PRINT_SETTINGS, type Bounds, type Point2, type PrintSettings, type ShapeKind, type Perforation, type ShapeLayer, type ShapeProfile, type SurfaceTexture } from '../types/document'
import type { DocumentSnapshot } from '../lib/persistence/localProjects'
import type { ImportedShape } from '../lib/import/svgImport'
import { createShapeRegions, contourBounds, defaultShapeName } from '../lib/geometry/primitives'
import type { AssetDefinition } from '../lib/assets/types'
import { rotatedLocalPoints, shapeWorldBounds } from '../lib/geometry/layerBounds'
import { restingHeight, unitDropDelta, unitRest } from '../lib/geometry/stacking'
import { nearestPlate } from '../lib/geometry/plateLayout'
import { buildShellCavity, type ShellCavity, type ShellOptions } from '../lib/geometry/shell'
import { useViewStore } from './viewStore'
import { buildLayerCutters, buildLayerGeometries, effectiveContour, solidPerimeter } from '../lib/geometry/layerGeometry'
import { cutHolesFromSolid } from '../lib/geometry/holeCut'
import { holeOutline, prism } from '../lib/geometry/perforation'

export { rotatedLocalPoints, shapeWorldBounds }
import { DEFAULT_BED_ID, getBedPreset } from '../lib/geometry/bedPresets'
import { applyBooleanOp, type BooleanOp } from '../lib/geometry/boolean'
import { cleanSpec, productTemplate, type ProductRecipe, type ProductSpec } from '../lib/products'

let idCounter = 0
function generateId() {
  idCounter += 1
  return `shape-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
}

/** Same bounding-box overlap test the actual 3D hole/solid cut uses (see
 * ExtrudedShapeMesh) — real XY footprint overlap, not just "on the same
 * plate". */
function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export interface CarveOptions {
  /** inplace: cut exactly where the tool sits now; top/bottom: a pocket of
   * `depth` mm from that face; through: the whole height. */
  mode: 'inplace' | 'top' | 'bottom' | 'through'
  depth?: number
}

export interface Guide {
  id: string
  orientation: 'horizontal' | 'vertical'
  /** Document mm position: Y for a horizontal guide, X for a vertical one. */
  position: number
}

export interface ShapeGroup {
  id: string
  name: string
  /** Set on a group the Create panel generated: the product and the
   * specs it was built from, so they can be changed and rebuilt. */
  recipe?: ProductRecipe
}

/** One build plate: the printer bed printed once. A project can have up
 * to MAX_PLATES; every layer belongs to exactly one. */
export interface Plate {
  id: string
  name: string
}

export const MAX_PLATES = 5
export const DEFAULT_ARTBOARD_COLOR = '#ffffff'
export const FIRST_PLATE_ID = 'plate-1'

/** The plate a layer sits on (older layers carry none and mean the first). */
export const layerPlateId = (layer: Pick<ShapeLayer, 'plateId'>, plates: Plate[]) => layer.plateId ?? plates[0]?.id ?? FIRST_PLATE_ID

export const defaultPlates = (): Plate[] => [{ id: FIRST_PLATE_ID, name: 'Plate 1' }]

export interface DocumentState {
  layers: Record<string, ShapeLayer>
  groups: Record<string, ShapeGroup>
  plates: Plate[]
  /** The plate being edited: the 2D canvas, the layers panel and the
   * print preview show it alone. */
  activePlateId: string
  /** 3D view: every plate side by side (true) or the active one (false). */
  showAllPlates: boolean
  /** Back-to-front draw order (also top-to-bottom in the Layers panel, reversed for display). */
  order: string[]
  selection: string[]
  /** A drag (slider, wheel, gizmo) is in progress: the viewport shows the
   * shapes uncut until it ends, so every move stays responsive. */
  editing: boolean
  /** Document-level, not per-shape — applies regardless of what's selected. */
  bedPresetId: string
  pinnedBedPresetId: string | null
  /** Only meaningful when bedPresetId === CUSTOM_BED_ID. */
  customBedWidth: number
  customBedHeight: number
  guides: Guide[]
  rulersVisible: boolean
  /** Display-only unit for every mm field in the inspector — the store
   * itself always keeps values in mm regardless of this. */
  displayUnit: 'mm' | 'cm' | 'in'
  /** Background of the 2D artboard (a dark one for white designs). */
  artboardColor: string
  /** The local project this document is saved as (null before a project
   * has been opened, e.g. in tests). */
  projectId: string | null
  projectName: string
  printSettings: PrintSettings
}

interface DocumentActions {
  setProjectName: (name: string) => void
  setPrintSettings: (patch: Partial<PrintSettings>) => void
  /** Replaces the whole document with a saved snapshot and wipes undo
   * history, so "undo" can never walk back into a different project. */
  loadDocument: (projectId: string, snapshot: DocumentSnapshot) => void
  addShape: (kind: ShapeKind, bounds: Bounds) => string
  addPenShape: (documentSpacePoints: Point2[]) => string
  /** A tube swept along `points` (document mm; z up from the bed) with
   * the given radius, as a solid layer whose footprint is its bounds. */
  addTubeShape: (points: { x: number; y: number; z: number }[], radius: number) => string
  moveShapesBy: (ids: string[], dx: number, dy: number) => void
  resizeShape: (id: string, bounds: Bounds) => void
  duplicateShapes: (ids: string[]) => string[]
  pasteShapes: (sourceLayers: ShapeLayer[]) => string[]
  /** Adds shapes redrawn from an imported file (see svgImport.ts) with
   * their top-left corner at `origin`, grouped when there are several. */
  addImportedShapes: (shapes: ImportedShape[], origin: Point2, groupName?: string) => string[]
  removeShapes: (ids: string[]) => void
  setSelection: (ids: string[]) => void
  toggleVisibility: (id: string) => void
  toggleLocked: (id: string) => void
  renameLayer: (id: string, name: string) => void
  renameGroup: (groupId: string, name: string) => void
  /** Show/hide or lock/unlock several layers at once (a whole group). */
  setVisible: (ids: string[], visible: boolean) => void
  setLocked: (ids: string[], locked: boolean) => void
  setColor: (id: string, color: string) => void
  setOpacity: (id: string, opacity: number) => void
  setExtrusionDepth: (id: string, depth: number) => void
  setCornerRadius: (id: string, radius: number) => void
  setSmartPolish: (id: string, intensity: number) => void
  setBevelBottom: (id: string, amount: number) => void
  setBevelTop: (id: string, amount: number) => void
  setLayerZ: (id: string, z: number) => void
  /** Perfect Fit: lift each shape so its bottom sits exactly on the top of
   * whatever solid lies under its footprint (no-op for a shape with
   * nothing under it). */
  restOnShapeBelow: (ids: string[]) => void
  /** Perfect Fit: put each shape's bottom on the bed. */
  dropToBed: (ids: string[]) => void
  setRotation: (id: string, rotation: { x?: number; y?: number; z?: number }) => void
  /** Wraps a continuous drag (dial, slider) so it lands in undo history as
   * ONE step instead of hundreds — begin on pointer-down, commit on
   * pointer-up. Commit is a no-op for history if nothing changed. */
  beginTransientEdit: () => void
  commitTransientEdit: () => void
  snapHoleToPocket: (id: string, floorThicknessMM: number) => void
  /** Shell: adds a hole object that hollows the solid out to walls of the
   * given thickness (floor rounded up to whole print layers), grouped with
   * it. Returns the new cavity's id, or null if the outline is too narrow. */
  hollowOut: (id: string, options: ShellOptions) => { cavityId: string; wall: number } | null
  /** Places an asset (see lib/assets) with its top-left at `origin`,
   * grouped under the asset's name, cavities included. Returns the ids. */
  addAsset: (asset: AssetDefinition, origin: Point2) => string[]
  /** Changes the wall/floor of an existing cavity (see ShapeLayer.shellOf)
   * and rebuilds it. */
  updateShell: (cavityId: string, options: Partial<ShellOptions>) => void
  /** Moves layers in the Layers panel: `ids` land directly above or below
   * `target` in the panel (panel order is front-to-back, so "above" is
   * later in `order`). `groupId` joins that group (null leaves any group,
   * undefined keeps membership as is). */
  moveLayersTo: (ids: string[], target: { id: string; position: 'above' | 'below' }, groupId?: string | null) => void
  /** Surface relief on a shape; null removes it. */
  setTexture: (id: string, texture: SurfaceTexture | null) => void
  /** Pattern of real holes on a shape; null removes it. */
  setPerforation: (id: string, perforation: Perforation | null) => void
  /** The width profile of a solid; its shell cavity follows it. */
  setProfile: (id: string, profile: ShapeProfile | undefined) => void
  /** Twist (degrees bottom to top) of a solid; its shell cavity follows. */
  setTwist: (id: string, twist: number) => void
  /** How a cutter's bevels are read (see ShapeLayer.bevelMode). */
  setBevelMode: (id: string, mode: 'rim' | 'shape') => void
  /** Carve: turns `toolId` into a hole cutter positioned against `baseId`
   * (from its top, from its bottom, or right through) and groups the two,
   * so the pair reads and moves as one object. */
  carveWith: (baseId: string, toolId: string, options: CarveOptions) => void
  setBedPreset: (id: string) => void
  setActivePlate: (id: string) => void
  setShowAllPlates: (on: boolean) => void
  addPlate: () => string | null
  renamePlate: (id: string, name: string) => void
  /** Deletes the plate and everything on it. */
  removePlate: (id: string) => void
  moveShapesToPlate: (ids: string[], plateId: string) => void
  /** Cuts a shape that is larger than the bed into pieces that fit, one per
   * new plate (up to MAX_PLATES). Returns the piece ids, or null when it
   * already fits or there are not enough plates. */
  splitForBed: (id: string) => string[] | null
  togglePinnedBedPreset: (id: string) => void
  setCustomBedSize: (width: number, height: number) => void
  setDisplayUnit: (unit: DocumentState['displayUnit']) => void
  setArtboardColor: (color: string) => void
  applyBoolean: (op: BooleanOp) => void
  addGuide: (orientation: Guide['orientation'], position: number) => string
  updateGuidePosition: (id: string, position: number) => void
  removeGuide: (id: string) => void
  toggleRulersVisible: () => void
  alignShapes: (ids: string[], mode: AlignMode) => void
  groupShapes: (ids: string[]) => string | null
  ungroupShapes: (ids: string[]) => void
  reorderLayer: (id: string, where: 'front' | 'back') => void
  /** Builds a product from the Create panel on the active plate, as a
   * group of ordinary shapes that remembers its recipe. Returns the
   * group id, or null when the template is unknown. */
  generateProduct: (templateId: string, spec: ProductSpec) => string | null
  /** Rebuilds a generated group from new specs, in place (same plate,
   * same corner). Parts edited by hand are replaced. */
  regenerateProduct: (groupId: string, spec: ProductSpec) => string | null
}

/** The ids that a click on `id` should select: every member of its group,
 * or just itself when it isn't grouped. */
export function expandToGroup(layers: Record<string, ShapeLayer>, order: string[], id: string): string[] {
  const groupId = layers[id]?.groupId
  if (!groupId) return [id]
  return order.filter((oid) => layers[oid]?.groupId === groupId)
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hspace' | 'vspace'

/** Current plate size in mm — the artboard every single-shape alignment
 * snaps to. */
/** `plateId` for a layer created while a plate other than the first is
 * active (the first plate is the implicit default). */
function platePatch(state: Pick<DocumentState, 'plates' | 'activePlateId'>): { plateId?: string } {
  return state.activePlateId === state.plates[0]?.id ? {} : { plateId: state.activePlateId }
}

/** Layer ids on one plate, in draw order. */
/** When the selection is one solid together with its own shell cavities
 * (what clicking a hollowed shape selects), the solid: the whole thing is
 * edited through it, since the cavity is rebuilt from the solid anyway. */
export function shellUnitSolid(layers: Record<string, ShapeLayer>, ids: string[]): ShapeLayer | null {
  if (ids.length < 2) return null
  const members = ids.map((id) => layers[id]).filter((l): l is ShapeLayer => !!l)
  if (members.length !== ids.length) return null
  const solids = members.filter((l) => !l.shellOf)
  if (solids.length !== 1 || solids[0].isHole) return null
  const solid = solids[0]
  return members.every((l) => l === solid || l.shellOf?.solidId === solid.id) ? solid : null
}

export function orderOnPlate(state: Pick<DocumentState, 'layers' | 'order' | 'plates'>, plateId: string): string[] {
  return state.order.filter((id) => state.layers[id] && layerPlateId(state.layers[id], state.plates) === plateId)
}

export function artboardSize(state: Pick<DocumentState, 'bedPresetId' | 'customBedWidth' | 'customBedHeight'>) {
  const preset = getBedPreset(state.bedPresetId)
  return { width: preset?.width ?? state.customBedWidth, height: preset?.height ?? state.customBedHeight }
}

/** A corner for a new `width` × `height` product on the active plate:
 * the middle of the bed, nudged right (then down) until it overlaps
 * nothing already there. */
function freeSpot(state: DocumentState, width: number, height: number): Point2 {
  const bed = artboardSize(state)
  const others = orderOnPlate(state, state.activePlateId).map((id) => shapeWorldBounds(state.layers[id]))
  const clear = (x: number, y: number) => !others.some((b) => x < b.x + b.width + 4 && x + width + 4 > b.x && y < b.y + b.height + 4 && y + height + 4 > b.y)
  const start = { x: Math.max(0, Math.round(bed.width / 2 - width / 2)), y: Math.max(0, Math.round(bed.height / 2 - height / 2)) }
  if (clear(start.x, start.y)) return start
  const step = 10
  for (let ring = 1; ring < 60; ring++) {
    for (const [dx, dy] of [
      [ring, 0],
      [-ring, 0],
      [0, ring],
      [0, -ring],
      [ring, ring],
      [-ring, ring],
      [ring, -ring],
      [-ring, -ring],
    ]) {
      const x = start.x + dx * step
      const y = start.y + dy * step
      if (x < 0 || y < 0 || x + width > bed.width || y + height > bed.height) continue
      if (clear(x, y)) return { x, y }
    }
  }
  return start
}

/** Creates a product's parts at `origin` (document mm), groups them and
 * stores the recipe on the group. One undo step. */
function buildProduct(templateId: string, spec: ProductSpec, build: { parts: import('../lib/products').PartRecipe[]; fuse?: boolean }, origin: Point2, plateId: string | null, name?: string): string | null {
  const api = useDocumentStore.getState()
  const template = productTemplate(templateId)
  if (!template) return null
  const wasEditing = useDocumentStore.getState().editing
  if (!wasEditing) api.beginTransientEdit()
  const ids: string[] = []
  for (const part of build.parts) {
    let id: string
    if (part.outline.kind === 'tube') {
      id = api.addTubeShape(
        part.outline.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y, z: p.z })),
        part.outline.radius,
      )
      ids.push(id)
      api.renameLayer(id, part.name)
      if (part.color) api.setColor(id, part.color)
      continue
    }
    if (part.outline.kind === 'path') {
      id = api.addPenShape(part.outline.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })))
    } else {
      const kind = part.isHole ? 'hole' : part.outline.kind
      id = api.addShape(kind, { x: part.outline.x + origin.x, y: part.outline.y + origin.y, width: part.outline.width, height: part.outline.height })
    }
    ids.push(id)
    api.renameLayer(id, part.name)
    if (part.color) api.setColor(id, part.color)
    api.setExtrusionDepth(id, part.depth)
    if (part.cornerRadius) api.setCornerRadius(id, part.cornerRadius)
    if (part.bevel) {
      api.setBevelBottom(id, part.bevel)
      api.setBevelTop(id, part.bevel)
    }
    if (part.rotation) api.setRotation(id, part.rotation)
    // Always explicit: a new shape otherwise climbs onto whatever is
    // under its footprint (a hook onto its box).
    api.setLayerZ(id, part.z ?? 0)
    if (part.texture) api.setTexture(id, part.texture)
    if (part.hollow) {
      const made = api.hollowOut(id, part.hollow)
      if (made) ids.push(made.cavityId)
    }
  }
  if (plateId && plateId !== useDocumentStore.getState().plates[0]?.id) api.moveShapesToPlate(ids, plateId)
  const groupId = api.groupShapes(ids)
  if (groupId) {
    api.renameGroup(groupId, name ?? template.name)
    useDocumentStore.setState((s) => ({ groups: { ...s.groups, [groupId]: { ...s.groups[groupId], recipe: { template: templateId, spec, fuse: build.fuse } } } }))
  }
  if (!wasEditing) api.commitTransientEdit()
  return groupId
}

export type DocumentStore = DocumentState & DocumentActions

/** A solid drawn inside a bigger one is almost always meant to sit ON it
 * (a logo on a plate, a boss on a base) — starting it at Z=0 would bury it
 * invisibly inside the bigger solid. Only near-complete containment
 * triggers this; a big plate drawn over small parts stays on the bed. */
const AUTO_REST_MIN_CONTAINMENT = 0.9
function perfectFitOnCreate(layer: ShapeLayer, state: Pick<DocumentState, 'layers' | 'order' | 'plates'>): ShapeLayer {
  if (layer.isHole) return layer
  // Only shapes on the same plate can be under it.
  const z = restingHeight(layer, state.layers, orderOnPlate(state, layerPlateId(layer, state.plates)), AUTO_REST_MIN_CONTAINMENT)
  return z == null ? layer : { ...layer, transform: { ...layer.transform, z } }
}

let transientSnapshot: Pick<DocumentState, 'layers' | 'order' | 'groups'> | null = null

/** After copying layers: a copied cavity follows the COPY of its solid
 * when that was copied too, and becomes a plain hole otherwise. */
function relinkShells(layers: Record<string, ShapeLayer>, idRemap: Map<string, string>) {
  for (const newId of idRemap.values()) {
    const layer = layers[newId]
    const link = layer?.shellOf
    if (!link) continue
    const solidCopy = idRemap.get(link.solidId)
    if (solidCopy) layers[newId] = { ...layer, shellOf: { ...link, solidId: solidCopy } }
    else {
      const { shellOf: _dropped, ...rest } = layer
      layers[newId] = rest
    }
  }
}

// The pinned ("default") bed preset is a user preference, not part of any
// one document: it survives reloads and seeds every new project.
const PINNED_BED_KEY = 'smartgrid:pinnedBed'
function readPinnedBedPreset(): string | null {
  try {
    const v = localStorage.getItem(PINNED_BED_KEY)
    if (v === null) return DEFAULT_BED_ID
    return v === '' ? null : v
  } catch {
    return DEFAULT_BED_ID
  }
}
function writePinnedBedPreset(id: string | null) {
  try {
    localStorage.setItem(PINNED_BED_KEY, id ?? '')
  } catch {
    /* preference just won't persist */
  }
}

type Patch = Partial<DocumentStore>

/** The hole layer that hollows `solid` out (see hollowOut), or null when
 * the outline is too narrow for the wall. The floor is rounded UP to
 * whole print layers — a floor thinner than a layer can't be printed. */
function makeCavityLayer(solid: ShapeLayer, options: ShellOptions, layerHeight: number, groupId: string | undefined): ShapeLayer | null {
  const floorLayers = Math.max(1, Math.ceil(Math.max(0, options.floor) / layerHeight - 1e-6))
  const floor = floorLayers * layerHeight
  const cavity = buildShellCavity(solid, { ...options, floor })
  if (!cavity) return null
  const cavityId = generateId()
  return {
    id: cavityId,
    kind: 'hole',
    name: `${solid.name} cavity`,
    visible: true,
    locked: false,
    color: solid.color,
    transform: { x: cavity.x, y: cavity.y, z: cavity.z, rotationX: 0, rotationY: 0, rotation: 0 },
    regions: cavity.regions,
    extrusionDepth: cavity.depth,
    cornerRadius: 0,
    smartPolish: 0,
    bevelBottom: cavity.bevelBottom,
    bevelTop: cavity.bevelTop,
    bevelMode: 'shape',
    isHole: true,
    ...(groupId ? { groupId } : {}),
    ...(solid.plateId ? { plateId: solid.plateId } : {}),
    shellOf: { solidId: solid.id, wall: options.wall, floor, openFrom: options.openFrom },
  }
}

/** The layers an asset places at `origin` (mm), as ordinary shapes: used
 * when dropping an asset into a document and to preview one in 3D. */
export function buildAssetLayers(asset: AssetDefinition, origin: Point2, layerHeight: number): { layers: Record<string, ShapeLayer>; order: string[]; group: ShapeGroup | null } {
  const layers: Record<string, ShapeLayer> = {}
  const order: string[] = []
  const needsGroup = asset.parts.length > 1 || asset.parts.some((p) => p.hollow)
  const groupId = needsGroup ? generateId() : undefined
  for (const part of asset.parts) {
    const id = generateId()
    const regions = part.regions ?? createShapeRegions(part.kind, part.width, part.height, { sides: part.polygonSides, starPoints: part.starPoints, starInnerRatio: part.starInnerRatio })
    const layer: ShapeLayer = {
      id,
      kind: part.kind,
      name: part.name,
      visible: true,
      locked: false,
      color: part.color ?? '#4d8dff',
      transform: { x: origin.x + part.x, y: origin.y + part.y, z: part.z ?? 0, rotationX: 0, rotationY: 0, rotation: part.rotation ?? 0 },
      regions,
      extrusionDepth: part.depth,
      cornerRadius: part.cornerRadius ?? 0,
      smartPolish: part.smartPolish ?? 0,
      bevelBottom: part.bevelBottom ?? 0,
      bevelTop: part.bevelTop ?? 0,
      isHole: !!part.isHole,
      ...(part.bevelMode ? { bevelMode: part.bevelMode } : {}),
      ...(part.texture ? { texture: part.texture } : {}),
      ...(part.perforation ? { perforation: part.perforation } : {}),
      ...(part.polygonSides ? { polygonSides: part.polygonSides } : {}),
      ...(part.starPoints ? { starPoints: part.starPoints, starInnerRatio: part.starInnerRatio ?? 0.45 } : {}),
      ...(groupId ? { groupId } : {}),
    }
    layers[id] = layer
    order.push(id)
    if (part.hollow && !layer.isHole) {
      const cavity = makeCavityLayer(layer, part.hollow, layerHeight, groupId)
      if (cavity) {
        layers[cavity.id] = cavity
        order.push(cavity.id)
      }
    }
  }
  return { layers, order, group: groupId ? { id: groupId, name: asset.name } : null }
}

/** A cavity layer updated to a freshly built shell cavity. */
/** The cavity's texture when its solid's goes "through the wall": the same
 * pattern, measured on the solid's wall, pulling the cavity surface the
 * same way the solid's is pushed — so the wall keeps its thickness. A
 * cavity texture the user set stays as it is. */
/** The solid's wall outline expressed in the cavity's local frame (the
 * cavity bakes the solid's spin and re-origins at its own bounds). */
function solidRingInCavityFrame(solid: ShapeLayer, cavity: ShapeLayer): Point2[] | undefined {
  const contour = effectiveContour(solid)
  if (!contour) return undefined
  const round = (v: number) => Math.round(v * 1000) / 1000
  return rotatedLocalPoints(solid, contour).map((p) => ({ x: round(p.x + solid.transform.x - cavity.transform.x), y: round(p.y + solid.transform.y - cavity.transform.y) }))
}

function withDerivedTexture(solid: ShapeLayer, cavity: ShapeLayer): ShapeLayer {
  const src = solid.texture
  const wantsThrough = !!src && src.through && src.depth > 0 && (src.target === 'walls' || src.target === 'both')
  if (wantsThrough && src) {
    const texture: SurfaceTexture = {
      ...src,
      target: 'walls',
      through: false,
      // Solid: cut = inward. Cavity: 'raised' is what moves its surface inward.
      relief: (src.relief ?? 'cut') === 'cut' ? 'raised' : 'cut',
      derived: {
        perimeter: solidPerimeter(solid),
        height: Math.max(0.2, solid.extrusionDepth),
        phaseV: cavity.transform.z - solid.transform.z,
        ring: solidRingInCavityFrame(solid, cavity),
        wall: cavity.shellOf?.wall,
      },
    }
    if (JSON.stringify(cavity.texture) === JSON.stringify(texture)) return cavity
    return { ...cavity, texture }
  }
  if (cavity.texture?.derived) {
    const { texture: _dropped, ...rest } = cavity
    return rest
  }
  return cavity
}

/** The cavity's share of its solid's bends. The twist is the same; the
 * profile is re-scaled so the wall keeps its thickness where the body
 * narrows or widens: at a height where the solid is scaled by s, an
 * outline r from the centre sits at s·r, so the cavity (inset by the
 * wall w) must be at s·r − w, i.e. scaled by (s·r − w) / (r − w). Both
 * are measured in the solid's height frame (`bendFrame`). */
function withSolidBends(solid: ShapeLayer, cavity: ShapeLayer): ShapeLayer {
  const { profile: _p, twist: _t, bendFrame: _f, ...rest } = cavity
  const bends = (solid.profile && solid.profile.points.length > 0) || !!solid.twist
  if (!bends) return rest
  const out: ShapeLayer = { ...rest, bendFrame: { z: cavity.transform.z - solid.transform.z, depth: Math.max(0.2, solid.extrusionDepth) } }
  if (solid.twist) out.twist = solid.twist
  if (solid.profile && solid.profile.points.length > 0) {
    const bounds = shapeWorldBounds(solid)
    const r = Math.max(1e-3, Math.min(bounds.width, bounds.height) / 2)
    const w = Math.min(cavity.shellOf?.wall ?? 0, r * 0.95)
    out.profile = {
      ...solid.profile,
      points: solid.profile.points.map((p) => ({ z: p.z, scale: Math.max(0.05, (p.scale * r - w) / (r - w)) })),
    }
  }
  return out
}

function applyCavity(cavity: ShapeLayer, built: ShellCavity): ShapeLayer {
  return {
    ...cavity,
    regions: built.regions,
    extrusionDepth: built.depth,
    transform: { ...cavity.transform, x: built.x, y: built.y, z: built.z, rotation: 0 },
    bevelBottom: built.bevelBottom,
    bevelTop: built.bevelTop,
    bevelMode: 'shape',
  }
}

/**
 * Keeps every "Hollow out" cavity glued to its solid: after any change to
 * the layers, a cavity whose solid changed is rebuilt from the solid's
 * current outline, position and depth (same wall settings), and a cavity
 * whose solid is gone goes with it. Runs inside the same store update, so
 * undo treats the solid edit and the cavity rebuild as one step.
 */
function syncShells(state: DocumentStore, patch: Patch): Patch {
  if (!patch.layers || patch.layers === state.layers) return patch
  let layers = patch.layers
  let order = patch.order ?? state.order
  let selection = patch.selection ?? state.selection
  let changed = false
  for (const id of Object.keys(layers)) {
    const cavity = layers[id]
    const link = cavity?.shellOf
    if (!link) continue
    const solid = layers[link.solidId]
    if (!solid || solid.isHole) {
      if (!changed) layers = { ...layers }
      changed = true
      delete layers[id]
      order = order.filter((oid) => oid !== id)
      selection = selection.filter((sid) => sid !== id)
      continue
    }
    if (solid === state.layers[link.solidId] && cavity === state.layers[id]) continue
    const rebuilt = buildShellCavity(solid, link)
    if (!rebuilt) continue
    const next: ShapeLayer = withDerivedTexture(solid, withSolidBends(solid, { ...applyCavity(cavity, rebuilt), groupId: solid.groupId }))
    if (JSON.stringify(next) === JSON.stringify(cavity)) continue
    if (!changed) layers = { ...layers }
    changed = true
    layers[id] = next
  }
  return changed ? { ...patch, layers, order, selection } : patch
}

export const useDocumentStore = create<DocumentStore>()(
  temporal(
    (rawSet, get) => {
      const set = (partial: Patch | ((state: DocumentStore) => Patch)) =>
        rawSet((state) => syncShells(state, typeof partial === 'function' ? partial(state) : partial))
      return {
      layers: {},
      groups: {},
      plates: defaultPlates(),
      activePlateId: FIRST_PLATE_ID,
      showAllPlates: false,
      order: [],
      selection: [],
      editing: false,
      bedPresetId: DEFAULT_BED_ID,
      pinnedBedPresetId: readPinnedBedPreset(),
      customBedWidth: 256,
      customBedHeight: 256,
      guides: [],
      rulersVisible: true,
      displayUnit: 'mm',
      artboardColor: DEFAULT_ARTBOARD_COLOR,
      projectId: null,
      projectName: 'Untitled project',
      printSettings: DEFAULT_PRINT_SETTINGS,

      setProjectName: (name) => set({ projectName: name.trim() || 'Untitled project' }),

      setPrintSettings: (patch) =>
        set((state) => {
          const next = { ...state.printSettings, ...patch }
          next.layerHeight = Math.min(1, Math.max(0.04, next.layerHeight))
          next.wallLoops = Math.max(1, Math.round(next.wallLoops))
          next.topLayers = Math.max(0, Math.round(next.topLayers))
          next.bottomLayers = Math.max(0, Math.round(next.bottomLayers))
          next.infillDensity = Math.min(100, Math.max(0, next.infillDensity))
          return { printSettings: next }
        }),

      loadDocument: (projectId, snapshot) => {
        const plates = snapshot.plates && snapshot.plates.length > 0 ? snapshot.plates : defaultPlates()
        set({
          projectId,
          projectName: snapshot.name,
          layers: snapshot.layers,
          order: snapshot.order,
          groups: snapshot.groups ?? {},
          plates,
          activePlateId: plates[0].id,
          showAllPlates: false,
          selection: [],
          bedPresetId: snapshot.bedPresetId,
          customBedWidth: snapshot.customBedWidth,
          customBedHeight: snapshot.customBedHeight,
          guides: snapshot.guides ?? [],
          displayUnit: snapshot.displayUnit ?? 'mm',
          artboardColor: snapshot.artboardColor ?? DEFAULT_ARTBOARD_COLOR,
          printSettings: { ...DEFAULT_PRINT_SETTINGS, ...snapshot.printSettings },
        })
        useDocumentStore.temporal.getState().clear()
      },

      addShape: (kind, bounds) => {
        const id = generateId()
        const width = Math.max(1, bounds.width)
        const height = Math.max(1, bounds.height)
        const layer: ShapeLayer = {
          id,
          kind,
          name: defaultShapeName(kind),
          visible: true,
          locked: false,
          color: '#4d8dff',
          transform: { x: bounds.x, y: bounds.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
          regions: createShapeRegions(kind, width, height),
          extrusionDepth: 3,
          cornerRadius: 0,
          smartPolish: 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: kind === 'hole',
          ...(kind === 'polygon' ? { polygonSides: 6 } : {}),
          ...(kind === 'star' ? { starPoints: 5, starInnerRatio: 0.45 } : {}),
        }
        set((state) => ({
          layers: { ...state.layers, [id]: perfectFitOnCreate({ ...layer, ...platePatch(state) }, state) },
          order: [...state.order, id],
          selection: [id],
        }))
        return id
      },

      moveShapesBy: (ids, dx, dy) => {
        if (!dx && !dy) return
        set((state) => {
          const layers = { ...state.layers }
          for (const id of ids) {
            const layer = layers[id]
            if (!layer || layer.locked) continue
            layers[id] = {
              ...layer,
              transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy },
            }
          }
          return { layers }
        })
      },

      resizeShape: (id, bounds) => {
        set((state) => {
          const layer = state.layers[id]
          if (!layer || layer.locked) return {}
          const allPoints = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
          const current = contourBounds(allPoints)
          const scaleX = current.width > 0 ? Math.max(1, bounds.width) / current.width : 1
          const scaleY = current.height > 0 ? Math.max(1, bounds.height) / current.height : 1
          const scalePoints = (points: { x: number; y: number }[]) =>
            points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }))
          const regions = layer.regions.map((region) => ({
            outer: { points: scalePoints(region.outer.points) },
            holes: region.holes.map((h) => ({ points: scalePoints(h.points) })),
          }))
          return {
            layers: {
              ...state.layers,
              [id]: { ...layer, regions, transform: { ...layer.transform, x: bounds.x, y: bounds.y } },
            },
          }
        })
      },

      addTubeShape: (points, radius) => {
        const id = generateId()
        const r = Math.max(0.2, radius)
        const minX = Math.min(...points.map((p) => p.x)) - r
        const maxX = Math.max(...points.map((p) => p.x)) + r
        const minY = Math.min(...points.map((p) => p.y)) - r
        const maxY = Math.max(...points.map((p) => p.y)) + r
        const minZ = Math.min(...points.map((p) => p.z)) - r
        const maxZ = Math.max(...points.map((p) => p.z)) + r
        const layer: ShapeLayer = {
          id,
          kind: 'rect',
          name: 'Tube',
          visible: true,
          locked: false,
          color: '#4d8dff',
          transform: { x: minX, y: minY, z: minZ, rotation: 0, rotationX: 0, rotationY: 0 },
          regions: createShapeRegions('rect', Math.max(0.2, maxX - minX), Math.max(0.2, maxY - minY)),
          extrusionDepth: Math.max(0.2, maxZ - minZ),
          cornerRadius: 0,
          smartPolish: 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: false,
          tube: { radius: r, points: points.map((p) => ({ x: p.x - minX, y: p.y - minY, z: p.z - minZ })) },
        }
        set((state) => ({
          layers: { ...state.layers, [id]: { ...layer, ...platePatch(state) } },
          order: [...state.order, id],
          selection: [id],
        }))
        return id
      },

      addPenShape: (documentSpacePoints) => {
        const id = generateId()
        const bounds = contourBounds(documentSpacePoints)
        const localPoints = documentSpacePoints.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))
        const layer: ShapeLayer = {
          id,
          kind: 'polygon',
          name: 'Path',
          visible: true,
          locked: false,
          color: '#4d8dff',
          transform: { x: bounds.x, y: bounds.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
          regions: [{ outer: { points: localPoints }, holes: [] }],
          extrusionDepth: 3,
          cornerRadius: 0,
          smartPolish: 0,
          bevelBottom: 0,
          bevelTop: 0,
          isHole: false,
          ...platePatch(get()),
        }
        set((state) => ({
          layers: { ...state.layers, [id]: perfectFitOnCreate(layer, state) },
          order: [...state.order, id],
          selection: [id],
        }))
        return id
      },

      applyBoolean: (op) => {
        set((state) => {
          const orderedIds = state.order.filter((id) => state.selection.includes(id))
          if (orderedIds.length < 2) return {}
          const orderedLayers = orderedIds.map((id) => state.layers[id])
          const result = applyBooleanOp(op, orderedLayers)
          if (!result) return {}

          const opNames: Record<BooleanOp, string> = {
            union: 'Union',
            subtract: 'Subtract',
            intersect: 'Intersect',
            exclude: 'Exclude',
          }
          const base = orderedLayers[0]
          const { polygonSides: _polygonSides, starPoints: _starPoints, starInnerRatio: _starInnerRatio, ...baseRest } = base
          const id = generateId()
          const newLayer: ShapeLayer = {
            ...baseRest,
            id,
            kind: 'polygon',
            name: opNames[op],
            transform: { ...base.transform, x: result.origin.x, y: result.origin.y },
            regions: result.regions,
          }

          const firstIndex = state.order.indexOf(orderedIds[0])
          const insertIndex = state.order.slice(0, firstIndex).filter((oid) => !orderedIds.includes(oid)).length
          const order = state.order.filter((oid) => !orderedIds.includes(oid))
          order.splice(insertIndex, 0, id)

          const layers = { ...state.layers }
          for (const rid of orderedIds) delete layers[rid]
          layers[id] = newLayer

          return { layers, order, selection: [id] }
        })
      },

      duplicateShapes: (ids) => {
        const newIds: string[] = []
        set((state) => {
          const layers = { ...state.layers }
          const order = [...state.order]
          const groups = { ...state.groups }
          // Copies of grouped shapes land in a fresh group of their own
          // rather than being folded into the original's.
          const groupRemap = new Map<string, string>()
          const idRemap = new Map<string, string>()
          for (const id of ids) {
            const layer = state.layers[id]
            if (!layer) continue
            const newId = generateId()
            newIds.push(newId)
            let groupId = layer.groupId
            if (groupId) {
              let mapped = groupRemap.get(groupId)
              if (!mapped) {
                mapped = generateId()
                groupRemap.set(groupId, mapped)
                groups[mapped] = { id: mapped, name: `${state.groups[groupId]?.name ?? 'Group'} copy` }
              }
              groupId = mapped
            }
            layers[newId] = {
              ...layer,
              id: newId,
              name: `${layer.name} copy`,
              transform: { ...layer.transform, x: layer.transform.x + 10, y: layer.transform.y + 10 },
              ...(groupId ? { groupId } : {}),
            }
            idRemap.set(id, newId)
            order.push(newId)
          }
          relinkShells(layers, idRemap)
          return { layers, order, groups, selection: newIds }
        })
        return newIds
      },

      // Takes cloned layer snapshots rather than ids, so pasting still works
      // after the copied shapes were deleted or the selection changed — the
      // clipboard doesn't depend on the originals still existing.
      pasteShapes: (sourceLayers) => {
        const newIds: string[] = []
        set((state) => {
          const layers = { ...state.layers }
          const order = [...state.order]
          const idRemap = new Map<string, string>()
          for (const source of sourceLayers) {
            const newId = generateId()
            newIds.push(newId)
            layers[newId] = {
              ...source,
              id: newId,
              transform: { ...source.transform, x: source.transform.x + 10, y: source.transform.y + 10 },
              plateId: state.activePlateId,
            }
            idRemap.set(source.id, newId)
            order.push(newId)
          }
          relinkShells(layers, idRemap)
          return { layers, order, selection: newIds }
        })
        return newIds
      },

      addImportedShapes: (shapes, origin, groupName) => {
        const newIds: string[] = []
        set((state) => {
          const layers = { ...state.layers }
          const order = [...state.order]
          const groupId = shapes.length > 1 ? generateId() : null
          for (const shape of shapes) {
            const all = shape.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)])
            if (all.length < 3) continue
            const bounds = contourBounds(all)
            const localize = (pts: Point2[]) => pts.map((p) => ({ x: p.x - bounds.x, y: p.y - bounds.y }))
            const id = generateId()
            newIds.push(id)
            layers[id] = {
              id,
              kind: 'polygon',
              name: shape.name,
              visible: true,
              locked: false,
              color: shape.color,
              transform: { x: origin.x + bounds.x, y: origin.y + bounds.y, z: 0, rotationX: 0, rotationY: 0, rotation: 0 },
              regions: shape.regions.map((r) => ({ outer: { points: localize(r.outer.points) }, holes: r.holes.map((h) => ({ points: localize(h.points) })) })),
              extrusionDepth: 3,
              cornerRadius: 0,
              smartPolish: 0,
              bevelBottom: 0,
              bevelTop: 0,
              isHole: false,
              ...(groupId ? { groupId } : {}),
              ...platePatch(state),
            }
            order.push(id)
          }
          if (newIds.length === 0) return {}
          const groups = groupId && newIds.length > 1 ? { ...state.groups, [groupId]: { id: groupId, name: groupName ?? 'Imported SVG' } } : state.groups
          if (groupId && newIds.length === 1) delete layers[newIds[0]].groupId
          return { layers, order, groups, selection: newIds }
        })
        return newIds
      },

      removeShapes: (ids) => {
        const notices: string[] = []
        set((state) => {
          // Locked shapes are protected from deletion, same as move/resize —
          // only unlocking one first allows it to be removed.
          const idSet = new Set(ids.filter((id) => !state.layers[id]?.locked))
          const layers = { ...state.layers }
          for (const id of idSet) {
            // Deleting a cavity leaves a solid block: wall holes that were
            // meant to open into it would just tunnel through, so they go.
            const link = layers[id]?.shellOf
            const solid = link ? layers[link.solidId] : undefined
            if (solid?.perforation && !idSet.has(solid.id)) {
              const { perforation: _dropped, ...rest } = solid
              layers[solid.id] = rest
              notices.push(`Removed the holes from ${solid.name} too — without the cavity they would just go through a solid block.`)
            }
            delete layers[id]
          }
          return {
            layers,
            order: state.order.filter((id) => !idSet.has(id)),
            selection: state.selection.filter((id) => !idSet.has(id)),
          }
        })
        if (notices.length) useViewStore.getState().setNotice(notices[0])
      },

      setSelection: (ids) => set({ selection: ids }),

      toggleVisibility: (id) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, visible: !layer.visible } } }
        }),

      toggleLocked: (id) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, locked: !layer.locked } } }
        }),

      renameLayer: (id, name) =>
        set((state) => {
          const layer = state.layers[id]
          const clean = name.trim()
          if (!layer || !clean || clean === layer.name) return {}
          return { layers: { ...state.layers, [id]: { ...layer, name: clean } } }
        }),

      renameGroup: (groupId, name) =>
        set((state) => {
          const group = state.groups[groupId]
          const clean = name.trim()
          if (!group || !clean || clean === group.name) return {}
          return { groups: { ...state.groups, [groupId]: { ...group, name: clean } } }
        }),

      setVisible: (ids, visible) =>
        set((state) => {
          const layers = { ...state.layers }
          for (const id of ids) if (layers[id]) layers[id] = { ...layers[id], visible }
          return { layers }
        }),

      setLocked: (ids, locked) =>
        set((state) => {
          const layers = { ...state.layers }
          for (const id of ids) if (layers[id]) layers[id] = { ...layers[id], locked }
          return { layers }
        }),

      setColor: (id, color) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, color } } }
        }),

      setOpacity: (id, opacity) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, opacity: Math.min(100, Math.max(0, opacity)) } } }
        }),

      setExtrusionDepth: (id, depth) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, extrusionDepth: Math.max(0, depth) } } }
        }),

      setCornerRadius: (id, radius) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, cornerRadius: Math.max(0, radius) } } }
        }),

      setSmartPolish: (id, intensity) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, smartPolish: Math.max(0, intensity) } } }
        }),

      setBevelBottom: (id, amount) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, bevelBottom: Math.max(0, amount) } } }
        }),

      setBevelTop: (id, amount) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, bevelTop: Math.max(0, amount) } } }
        }),

      setLayerZ: (id, z) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer || layer.locked) return {}
          return { layers: { ...state.layers, [id]: { ...layer, transform: { ...layer.transform, z: Math.max(0, z) } } } }
        }),

      // Several shapes (a group) move as ONE rigid unit: the same Z change
      // for all of them, so their arrangement is preserved.
      restOnShapeBelow: (ids) =>
        set((state) => {
          const movable = ids.filter((id) => state.layers[id] && !state.layers[id].locked)
          if (movable.length === 0) return {}
          const rest = unitRest(movable, state.layers, orderOnPlate(state, layerPlateId(state.layers[movable[0]], state.plates)))
          if (!rest || Math.abs(rest.delta) < 1e-6) return {}
          const layers = { ...state.layers }
          for (const id of movable) {
            const layer = layers[id]
            layers[id] = { ...layer, transform: { ...layer.transform, z: Math.round((layer.transform.z + rest.delta) * 1e6) / 1e6 } }
          }
          return { layers }
        }),

      dropToBed: (ids) =>
        set((state) => {
          const movable = ids.filter((id) => state.layers[id] && !state.layers[id].locked)
          if (movable.length === 0) return {}
          const delta = unitDropDelta(movable, state.layers)
          if (Math.abs(delta) < 1e-6) return {}
          const layers = { ...state.layers }
          for (const id of movable) {
            const layer = layers[id]
            layers[id] = { ...layer, transform: { ...layer.transform, z: Math.max(0, Math.round((layer.transform.z + delta) * 1e6) / 1e6) } }
          }
          return { layers }
        }),

      setRotation: (id, rotation) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer || layer.locked) return {}
          return {
            layers: {
              ...state.layers,
              [id]: {
                ...layer,
                transform: {
                  ...layer.transform,
                  rotationX: rotation.x ?? layer.transform.rotationX,
                  rotationY: rotation.y ?? layer.transform.rotationY,
                  rotation: rotation.z ?? layer.transform.rotation,
                },
              },
            },
          }
        }),

      beginTransientEdit: () => {
        const { layers, order, groups } = get()
        transientSnapshot = { layers, order, groups }
        useDocumentStore.temporal.getState().pause()
        set({ editing: true })
      },

      // zundo records the pre-change state on every tracked set, so while
      // paused nothing is recorded. To end up with exactly one entry for the
      // whole drag: silently restore the pre-drag snapshot, resume tracking,
      // then re-apply the final state as a single tracked change.
      commitTransientEdit: () => {
        const temporal = useDocumentStore.temporal.getState()
        const snapshot = transientSnapshot
        transientSnapshot = null
        if (!snapshot) {
          temporal.resume()
          set({ editing: false })
          return
        }
        const { layers, order, groups } = get()
        const changed = layers !== snapshot.layers || order !== snapshot.order || groups !== snapshot.groups
        if (!changed) {
          temporal.resume()
          set({ editing: false })
          return
        }
        set(snapshot)
        temporal.resume()
        set({ layers, order, groups, editing: false })
      },

      // Sinks a hole (a magnet pocket) down to the BOTTOM of whatever solids
      // it overlaps in XY, leaving a floor of whole print layers under it.
      // Its own depth (the magnet's thickness) is kept, so the pocket is a
      // hidden cavity closed over by the layers above — pause the print at
      // the layer where the pocket tops out, drop the magnet in, resume.
      // A hole's z/depth are otherwise independent of anything underneath
      // it (never touched by any future auto-stack/floating-shape logic,
      // which should treat holes as non-physical) — this is the one place
      // that deliberately moves a hole based on what it overlaps.
      snapHoleToPocket: (id, floorThicknessMM) => {
        set((state) => {
          const hole = state.layers[id]
          if (!hole || !hole.isHole || hole.locked) return {}
          const holeBounds = shapeWorldBounds(hole)
          const overlapping = state.order
            .map((oid) => state.layers[oid])
            .filter(
              (l): l is ShapeLayer =>
                !!l && !l.isHole && l.id !== id && rectsOverlap(holeBounds, shapeWorldBounds(l)),
            )
          if (overlapping.length === 0) return {}

          const bottomZ = Math.min(...overlapping.map((l) => l.transform.z))
          const layerHeight = state.printSettings.layerHeight
          // Round the floor UP to whole layers — a floor thinner than a
          // layer can't be printed, and a partial layer would just shift
          // every layer boundary above it.
          const floorLayers = Math.max(1, Math.ceil(Math.max(0, floorThicknessMM) / layerHeight - 1e-6))
          const newZ = Math.round(Math.max(0, bottomZ + floorLayers * layerHeight) * 1e6) / 1e6

          return {
            layers: {
              ...state.layers,
              [id]: { ...hole, transform: { ...hole.transform, z: newZ } },
            },
          }
        })
      },

      hollowOut: (id, options) => {
        const state = get()
        const solid = state.layers[id]
        if (!solid || solid.isHole) return null
        // The cavity belongs with its solid: join its group, or start one.
        const groupId = solid.groupId ?? generateId()
        const built = makeCavityLayer({ ...solid, groupId }, options, state.printSettings.layerHeight, groupId)
        if (!built) return null
        const cavity = withSolidBends(solid, built)
        set((s) => {
          const layers = { ...s.layers }
          let groups = s.groups
          if (!solid.groupId) {
            groups = { ...groups, [groupId]: { id: groupId, name: `${solid.name} shell` } }
            layers[id] = { ...solid, groupId }
          }
          layers[cavity.id] = cavity
          const at = s.order.indexOf(id)
          const order = [...s.order]
          order.splice(at + 1, 0, cavity.id)
          return { layers, groups, order, selection: [cavity.id] }
        })
        return { cavityId: cavity.id, wall: cavity.shellOf!.wall }
      },

      addAsset: (asset, origin) => {
        const ids: string[] = []
        set((state) => {
          const built = buildAssetLayers(asset, origin, state.printSettings.layerHeight)
          ids.push(...built.order)
          const plate = platePatch(state)
          const placed = Object.fromEntries(Object.entries(built.layers).map(([id, l]) => [id, { ...l, ...plate }]))
          return {
            layers: { ...state.layers, ...placed },
            order: [...state.order, ...built.order],
            groups: built.group ? { ...state.groups, [built.group.id]: built.group } : state.groups,
            selection: built.order,
          }
        })
        return ids
      },

      updateShell: (cavityId, options) =>
        set((state) => {
          const cavity = state.layers[cavityId]
          const link = cavity?.shellOf
          if (!link) return {}
          const solid = state.layers[link.solidId]
          if (!solid) return {}
          const layerHeight = state.printSettings.layerHeight
          const floorRaw = options.floor ?? link.floor
          const floor = Math.max(1, Math.ceil(Math.max(0, floorRaw) / layerHeight - 1e-6)) * layerHeight
          const nextLink = { ...link, ...options, wall: Math.max(0.4, options.wall ?? link.wall), floor }
          const rebuilt = buildShellCavity(solid, nextLink)
          if (!rebuilt) return {}
          return {
            layers: {
              ...state.layers,
              [cavityId]: { ...applyCavity(cavity, rebuilt), shellOf: nextLink },
            },
          }
        }),

      moveLayersTo: (ids, target, groupId) =>
        set((state) => {
          const moving = ids.filter((id) => state.layers[id] && id !== target.id)
          if (moving.length === 0 || !state.layers[target.id]) return {}
          const rest = state.order.filter((id) => !moving.includes(id))
          const at = rest.indexOf(target.id)
          if (at < 0) return {}
          const order = [...rest]
          // Panel lists front (end of `order`) at the top.
          order.splice(target.position === 'above' ? at + 1 : at, 0, ...moving)
          if (groupId === undefined) return { order }
          const layers = { ...state.layers }
          for (const id of moving) {
            const { groupId: _old, ...layer } = layers[id]
            layers[id] = groupId ? { ...layer, groupId } : layer
          }
          return { order, layers }
        }),

      setTexture: (id, texture) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          if (!texture) {
            const { texture: _dropped, ...rest } = layer
            return { layers: { ...state.layers, [id]: rest } }
          }
          const clean: SurfaceTexture = {
            ...texture,
            size: Math.min(50, Math.max(0.5, texture.size)),
            depth: Math.min(5, Math.max(0, texture.depth)),
            angle: texture.angle ? Math.max(-90, Math.min(90, texture.angle)) : undefined,
            fade: texture.fade ? Math.max(0, texture.fade) : undefined,
          }
          return { layers: { ...state.layers, [id]: { ...layer, texture: clean } } }
        }),

      setPerforation: (id, perforation) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          if (!perforation) {
            const { perforation: _dropped, ...rest } = layer
            return { layers: { ...state.layers, [id]: rest } }
          }
          const size = Math.min(50, Math.max(0.3, perforation.size))
          // Older projects stored the band's top as a height; it is a
          // margin now, so that value is dropped rather than misread.
          const { wallTo: _legacyTop, ...incoming } = perforation as Perforation & { wallTo?: number }
          const clean: Perforation = {
            ...incoming,
            size,
            spacing: Math.max(size + 0.4, perforation.spacing),
            depth: perforation.depth == null ? null : Math.max(0.1, perforation.depth),
          }
          return { layers: { ...state.layers, [id]: { ...layer, perforation: clean } } }
        }),

      setProfile: (id, profile) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          // A shell cavity follows through syncShells.
          return { layers: { ...state.layers, [id]: { ...layer, profile } } }
        }),

      setTwist: (id, twistIn) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          const twist = Math.abs(twistIn) < 1e-6 ? undefined : Math.max(-360, Math.min(360, twistIn))
          return { layers: { ...state.layers, [id]: { ...layer, twist } } }
        }),

      setBevelMode: (id, mode) =>
        set((state) => {
          const layer = state.layers[id]
          if (!layer) return {}
          return { layers: { ...state.layers, [id]: { ...layer, bevelMode: mode } } }
        }),

      carveWith: (baseId, toolId, options) =>
        set((state) => {
          const base = state.layers[baseId]
          const tool = state.layers[toolId]
          if (!base || !tool || base.isHole || baseId === toolId) return {}
          const OVERSHOOT = 1
          const baseTop = base.transform.z + base.extrusionDepth
          const d = Math.max(0.05, options.depth ?? tool.extrusionDepth)
          let z = tool.transform.z
          let depth = tool.extrusionDepth
          if (options.mode === 'through') {
            z = base.transform.z - OVERSHOOT
            depth = base.extrusionDepth + 2 * OVERSHOOT
          } else if (options.mode === 'top') {
            z = baseTop - d
            depth = d + OVERSHOOT
          } else if (options.mode === 'bottom') {
            z = base.transform.z - OVERSHOOT
            depth = d + OVERSHOOT
          }
          const layers = { ...state.layers }
          let groups = state.groups
          let groupId = base.groupId
          if (!groupId) {
            groupId = generateId()
            groups = { ...groups, [groupId]: { id: groupId, name: `${base.name} carved` } }
            layers[baseId] = { ...base, groupId }
          }
          const { perforation: _noPerforation, ...toolRest } = tool
          layers[toolId] = {
            ...toolRest,
            kind: 'hole',
            isHole: true,
            // The cut has the tool's exact shape — its bevels stay edges of
            // the cut, not a flared rim.
            bevelMode: 'shape',
            name: tool.isHole ? tool.name : `${tool.name} cutter`,
            transform: { ...tool.transform, z: Math.round(z * 1e6) / 1e6 },
            extrusionDepth: Math.round(depth * 1e6) / 1e6,
            groupId,
          }
          return { layers, groups, selection: [baseId, toolId] }
        }),

      setBedPreset: (id) => set({ bedPresetId: id }),
      setActivePlate: (id) =>
        set((state) => (state.plates.some((p) => p.id === id) && id !== state.activePlateId ? { activePlateId: id, selection: [] } : {})),
      setShowAllPlates: (on) => set({ showAllPlates: on }),
      addPlate: () => {
        const state = get()
        if (state.plates.length >= MAX_PLATES) return null
        const id = `plate-${generateId()}`
        const taken = new Set(state.plates.map((p) => p.name))
        let n = state.plates.length + 1
        while (taken.has(`Plate ${n}`)) n++
        set({ plates: [...state.plates, { id, name: `Plate ${n}` }], activePlateId: id, selection: [] })
        return id
      },
      renamePlate: (id, name) =>
        set((state) => ({ plates: state.plates.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)) })),
      removePlate: (id) =>
        set((state) => {
          if (state.plates.length <= 1) return {}
          const index = state.plates.findIndex((p) => p.id === id)
          if (index < 0) return {}
          const plates = state.plates.filter((p) => p.id !== id)
          // Nothing is lost: the plate's shapes move to the nearest plate in
          // the layout (the one just before it in the same row, usually).
          const bed = artboardSize(state)
          const target = state.plates[nearestPlate(index, state.plates.length, bed.width, bed.height)].id
          const layers = { ...state.layers }
          for (const lid of state.order) {
            const l = layers[lid]
            if (l && layerPlateId(l, state.plates) === id) layers[lid] = { ...l, plateId: target }
          }
          return {
            plates,
            layers,
            activePlateId: state.activePlateId === id ? target : state.activePlateId,
            selection: state.activePlateId === id ? [] : state.selection,
          }
        }),
      moveShapesToPlate: (ids, plateId) =>
        set((state) => {
          if (!state.plates.some((p) => p.id === plateId)) return {}
          const layers = { ...state.layers }
          // A group moves as a whole, and a shell cavity with its solid.
          const targets = new Set(ids.flatMap((id) => expandToGroup(state.layers, state.order, id)))
          for (const id of [...targets]) {
            for (const lid of state.order) {
              const l = state.layers[lid]
              if (l?.shellOf?.solidId === id) targets.add(lid)
            }
          }
          for (const id of targets) if (layers[id]) layers[id] = { ...layers[id], plateId }
          return { layers, selection: [] }
        }),
      splitForBed: (id) => {
        const state = get()
        const layer = state.layers[id]
        if (!layer || layer.isHole) return null
        const bed = artboardSize(state)
        const bounds = shapeWorldBounds(layer)
        const nx = Math.max(1, Math.ceil(bounds.width / bed.width - 1e-6))
        const ny = Math.max(1, Math.ceil(bounds.height / bed.height - 1e-6))
        if (nx === 1 && ny === 1) return null
        const pieces = nx * ny
        // The original's plate is reused for the first piece.
        if (state.plates.length - 1 + pieces > MAX_PLATES) return null
        const pieceW = bounds.width / nx
        const pieceH = bounds.height / ny
        const holes = state.order.filter((hid) => state.layers[hid]?.isHole && layerPlateId(state.layers[hid], state.plates) === layerPlateId(layer, state.plates))
        const plates = [...state.plates]
        const layers = { ...state.layers }
        const order = state.order.filter((lid) => lid !== id)
        const ids: string[] = []
        let plateIdx = 0
        const ownPlate = layerPlateId(layer, state.plates)
        for (let iy = 0; iy < ny; iy++) {
          for (let ix = 0; ix < nx; ix++) {
            const cut = { x: bounds.x + ix * pieceW, y: bounds.y + iy * pieceH, width: pieceW, height: pieceH }
            const knife: ShapeLayer = { ...layer, id: 'knife', kind: 'rect', regions: createShapeRegions('rect', cut.width, cut.height), transform: { ...layer.transform, x: cut.x, y: cut.y, rotation: 0 }, cornerRadius: 0, smartPolish: 0 }
            const result = applyBooleanOp('intersect', [layer, knife])
            if (!result || result.regions.length === 0) continue
            const plateId = plateIdx === 0 ? ownPlate : (plates[plateIdx]?.id ?? (plates.push({ id: `plate-${generateId()}`, name: `Plate ${plates.length + 1}` }), plates[plates.length - 1].id))
            plateIdx++
            const pieceId = generateId()
            const pb = contourBounds(result.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((h) => h.points)]))
            // Each piece is centred on its plate, with its outline re-based at 0,0.
            const regions = result.regions.map((r) => ({ outer: { points: r.outer.points.map((pt) => ({ x: pt.x - pb.x, y: pt.y - pb.y })) }, holes: r.holes.map((h) => ({ points: h.points.map((pt) => ({ x: pt.x - pb.x, y: pt.y - pb.y })) })) }))
            const piece: ShapeLayer = {
              ...layer,
              id: pieceId,
              name: `${layer.name} ${iy * nx + ix + 1}/${pieces}`,
              kind: 'polygon',
              regions,
              transform: { ...layer.transform, x: (bed.width - pb.width) / 2, y: (bed.height - pb.height) / 2, rotation: 0 },
              cornerRadius: 0,
              smartPolish: 0,
              plateId,
              groupId: undefined,
              shellOf: undefined,
            }
            layers[pieceId] = piece
            order.push(pieceId)
            ids.push(pieceId)
            // Cutters that overlap this piece follow it, keeping their relative position.
            for (const hid of holes) {
              const hole = state.layers[hid]
              const hb = shapeWorldBounds(hole)
              const overlaps = hb.x < pb.x + pb.width && hb.x + hb.width > pb.x && hb.y < pb.y + pb.height && hb.y + hb.height > pb.y
              if (!overlaps) continue
              const cid = generateId()
              layers[cid] = { ...hole, id: cid, plateId, groupId: undefined, transform: { ...hole.transform, x: hole.transform.x - pb.x + piece.transform.x, y: hole.transform.y - pb.y + piece.transform.y } }
              order.push(cid)
            }
          }
        }
        delete layers[id]
        // Cavities of the original go with it.
        for (const lid of state.order) if (state.layers[lid]?.shellOf?.solidId === id) { delete layers[lid]; const i = order.indexOf(lid); if (i >= 0) order.splice(i, 1) }
        set({ layers, order, plates, selection: ids.slice(0, 1), activePlateId: ownPlate })
        return ids
      },

      togglePinnedBedPreset: (id) =>
        set((state) => {
          const next = state.pinnedBedPresetId === id ? null : id
          writePinnedBedPreset(next)
          return { pinnedBedPresetId: next }
        }),

      setCustomBedSize: (width, height) =>
        set({ customBedWidth: Math.max(10, width), customBedHeight: Math.max(10, height) }),

      setDisplayUnit: (unit) => set({ displayUnit: unit }),
      setArtboardColor: (color) => set({ artboardColor: color }),

      addGuide: (orientation, position) => {
        const id = generateId()
        set((state) => ({ guides: [...state.guides, { id, orientation, position }] }))
        return id
      },

      updateGuidePosition: (id, position) =>
        set((state) => ({ guides: state.guides.map((g) => (g.id === id ? { ...g, position } : g)) })),

      removeGuide: (id) => set((state) => ({ guides: state.guides.filter((g) => g.id !== id) })),

      toggleRulersVisible: () => set((state) => ({ rulersVisible: !state.rulersVisible })),

      groupShapes: (ids) => {
        const members = ids.filter((id, i) => ids.indexOf(id) === i)
        if (members.length === 0) return null
        const groupId = generateId()
        set((state) => {
          const layers = { ...state.layers }
          for (const id of members) {
            const layer = layers[id]
            if (layer) layers[id] = { ...layer, groupId }
          }
          const groupCount = Object.keys(state.groups).length + 1
          // Drop any group that this regrouping emptied out.
          const groups: Record<string, ShapeGroup> = { ...state.groups, [groupId]: { id: groupId, name: `Group ${groupCount}` } }
          for (const gid of Object.keys(groups)) {
            if (!Object.values(layers).some((l) => l.groupId === gid)) delete groups[gid]
          }
          return { layers, groups, selection: members }
        })
        return groupId
      },

      ungroupShapes: (ids) =>
        set((state) => {
          const affectedGroups = new Set(ids.map((id) => state.layers[id]?.groupId).filter((g): g is string => !!g))
          if (affectedGroups.size === 0) return {}
          const layers = { ...state.layers }
          for (const [id, layer] of Object.entries(layers)) {
            if (layer.groupId && affectedGroups.has(layer.groupId)) {
              const { groupId: _dropped, ...rest } = layer
              layers[id] = rest
            }
          }
          const groups = { ...state.groups }
          for (const gid of affectedGroups) delete groups[gid]
          return { layers, groups }
        }),

      generateProduct: (templateId, spec) => {
        const template = productTemplate(templateId)
        if (!template) return null
        const state = get()
        const build = template.build(cleanSpec(template, spec))
        return buildProduct(templateId, cleanSpec(template, spec), build, freeSpot(state, build.width, build.height), null)
      },

      regenerateProduct: (groupId, spec) => {
        const state = get()
        const group = state.groups[groupId]
        const template = group?.recipe ? productTemplate(group.recipe.template) : undefined
        if (!group || !template) return null
        const members = state.order.filter((id) => state.layers[id]?.groupId === groupId)
        if (members.length === 0) return null
        let x = Infinity
        let y = Infinity
        for (const id of members) {
          const b = shapeWorldBounds(state.layers[id])
          x = Math.min(x, b.x)
          y = Math.min(y, b.y)
        }
        const plateId = layerPlateId(state.layers[members[0]], state.plates)
        const clean = cleanSpec(template, spec)
        const build = template.build(clean)
        get().beginTransientEdit()
        get().removeShapes(members)
        const id = buildProduct(template.id, clean, build, { x, y }, plateId, group.name)
        get().commitTransientEdit()
        return id
      },

      reorderLayer: (id, where) =>
        set((state) => {
          if (!state.layers[id]) return {}
          const moving = expandToGroup(state.layers, state.order, id)
          const rest = state.order.filter((oid) => !moving.includes(oid))
          return { order: where === 'front' ? [...rest, ...moving] : [...moving, ...rest] }
        }),

      // Figma semantics: with several shapes selected, align them to the
      // selection's own combined bounds; with one, align it to the artboard.
      alignShapes: (ids, mode) =>
        set((state) => {
          const targets = ids.map((id) => state.layers[id]).filter((l): l is ShapeLayer => !!l && !l.locked)
          if (targets.length === 0) return {}
          // A group (a solid with its shell cavity, say) moves as one unit.
          const unitOf = (l: ShapeLayer) => l.groupId ?? l.id
          const units = new Map<string, { members: ShapeLayer[]; bounds: Bounds }>()
          for (const layer of targets) {
            const key = unitOf(layer)
            const b = shapeWorldBounds(layer)
            const unit = units.get(key)
            if (!unit) units.set(key, { members: [layer], bounds: { ...b } })
            else {
              unit.members.push(layer)
              const minX = Math.min(unit.bounds.x, b.x)
              const minY = Math.min(unit.bounds.y, b.y)
              const maxX = Math.max(unit.bounds.x + unit.bounds.width, b.x + b.width)
              const maxY = Math.max(unit.bounds.y + unit.bounds.height, b.y + b.height)
              unit.bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
            }
          }
          const list = [...units.values()]
          const layers = { ...state.layers }
          const moveUnit = (unit: { members: ShapeLayer[] }, dx: number, dy: number) => {
            if (!dx && !dy) return
            for (const layer of unit.members) {
              layers[layer.id] = { ...layer, transform: { ...layer.transform, x: layer.transform.x + dx, y: layer.transform.y + dy } }
            }
          }

          if (mode === 'hspace' || mode === 'vspace') {
            // Equal gaps: the outermost two stay, the rest spread between
            // them. When they do not fit without touching, they are laid
            // out from the first one with a small equal gap instead.
            if (list.length < 3) return {}
            const horizontal = mode === 'hspace'
            const size = (b: Bounds) => (horizontal ? b.width : b.height)
            const pos = (b: Bounds) => (horizontal ? b.x : b.y)
            const sorted = [...list].sort((u, v) => pos(u.bounds) + size(u.bounds) / 2 - (pos(v.bounds) + size(v.bounds) / 2))
            const first = sorted[0].bounds
            const last = sorted[sorted.length - 1].bounds
            const span = pos(last) + size(last) - pos(first)
            const filled = sorted.reduce((n, u) => n + size(u.bounds), 0)
            const MIN_GAP = 4
            let gap = (span - filled) / (sorted.length - 1)
            const rest = gap < MIN_GAP ? sorted.slice(1) : sorted.slice(1, -1)
            if (gap < MIN_GAP) gap = MIN_GAP
            let cursor = pos(first) + size(first) + gap
            for (const unit of rest) {
              const delta = cursor - pos(unit.bounds)
              moveUnit(unit, horizontal ? delta : 0, horizontal ? 0 : delta)
              cursor += size(unit.bounds) + gap
            }
            return { layers }
          }

          // One unit aligns to the artboard; several align to their common box.
          let ref: Bounds
          if (list.length > 1) {
            const minX = Math.min(...list.map((u) => u.bounds.x))
            const minY = Math.min(...list.map((u) => u.bounds.y))
            const maxX = Math.max(...list.map((u) => u.bounds.x + u.bounds.width))
            const maxY = Math.max(...list.map((u) => u.bounds.y + u.bounds.height))
            ref = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
          } else {
            const { width, height } = artboardSize(state)
            ref = { x: 0, y: 0, width, height }
          }
          for (const unit of list) {
            const b = unit.bounds
            let dx = 0
            let dy = 0
            if (mode === 'left') dx = ref.x - b.x
            else if (mode === 'hcenter') dx = ref.x + ref.width / 2 - (b.x + b.width / 2)
            else if (mode === 'right') dx = ref.x + ref.width - (b.x + b.width)
            else if (mode === 'top') dy = ref.y - b.y
            else if (mode === 'vcenter') dy = ref.y + ref.height / 2 - (b.y + b.height / 2)
            else dy = ref.y + ref.height - (b.y + b.height)
            moveUnit(unit, dx, dy)
          }
          return { layers }
        }),
    }
    },
    {
      // Selection is transient UI state, not something Cmd+Z should walk
      // back through — only the shape data itself belongs in history.
      partialize: (state) => ({ layers: state.layers, order: state.order, groups: state.groups, plates: state.plates }),
      // Without this zundo records an entry on EVERY set — including a
      // plain selection change that leaves the document untouched — so
      // undo would sometimes appear to do nothing. Store updates are
      // immutable, so reference equality of the tracked slices is exact.
      equality: (a, b) => a.layers === b.layers && a.order === b.order && a.groups === b.groups && a.plates === b.plates,
      limit: 100,
    },
  ),
)

export function useTemporalStore() {
  return useStore(useDocumentStore.temporal, (state) => state)
}

/** The shape's local points with its Z-spin (`rotation`) applied about the
 * footprint center — the outline the 2D canvas actually shows. Tilts
 * (rotationX/Y) can't be drawn in 2D and are left to the 3D geometry. */
/** The saveable part of the document (see localProjects.ts). */
export function serializeDocument(state: DocumentState): DocumentSnapshot {
  return {
    version: 1,
    name: state.projectName,
    layers: state.layers,
    order: state.order,
    groups: state.groups,
    plates: state.plates,
    bedPresetId: state.bedPresetId,
    customBedWidth: state.customBedWidth,
    customBedHeight: state.customBedHeight,
    guides: state.guides,
    displayUnit: state.displayUnit,
    artboardColor: state.artboardColor,
    printSettings: state.printSettings,
  }
}

/** A fresh, empty document for a new project. */
export function emptyDocument(name = 'Untitled project'): DocumentSnapshot {
  const s = useDocumentStore.getState()
  return {
    version: 1,
    name,
    layers: {},
    order: [],
    groups: {},
    plates: defaultPlates(),
    bedPresetId: s.pinnedBedPresetId ?? DEFAULT_BED_ID,
    customBedWidth: 256,
    customBedHeight: 256,
    guides: [],
    displayUnit: 'mm',
    artboardColor: DEFAULT_ARTBOARD_COLOR,
    printSettings: DEFAULT_PRINT_SETTINGS,
  }
}

// Dev-only handle so browser automation/debugging can reach the live store
// (stripped from production builds by the DEV guard).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __smartgrid: { useDocumentStore: typeof useDocumentStore; shapeWorldBounds: typeof shapeWorldBounds; buildLayerGeometries: typeof buildLayerGeometries; buildLayerCutters: typeof buildLayerCutters; cutHolesFromSolid: typeof cutHolesFromSolid; prism: typeof prism; holeOutline: typeof holeOutline } }).__smartgrid = { useDocumentStore, shapeWorldBounds, buildLayerGeometries, buildLayerCutters, cutHolesFromSolid, prism, holeOutline }
}
