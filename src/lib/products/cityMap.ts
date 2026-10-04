import { bool, num, str, type PartRecipe, type ProductBuild, type ProductSpec, type ProductTemplate } from './types'
import type { Point2, ShapeRegion } from '../../types/document'
import { loadFont, textRegions } from '../text/textOutline'
import { cachedPatch, geocode, loadPatch, mapStatus, parseCoordinates, placeSync, SAMPLE_PLACE, type MapData, type RoadClass } from '../map/osm'
import { EMPTY, clip, polygonOf, regionsOf, simplify, strip, subtract, unionPolygons, unite, type Poly } from '../map/mapShapes'

/**
 * A relief map of a patch of a city, the kind that hangs on a wall:
 * the streets raised on a plate, the buildings as blocks, water sunk
 * and parks laid flat, each layer in its own colour, with the city's
 * name along the bottom. The map comes from OpenStreetMap for any place
 * (see ../map/osm.ts); Berlin Mitte is bundled.
 */
const COLORS = {
  base: '#e9e3d7',
  water: '#6fa8d1',
  green: '#9dbc8c',
  roads: '#ffffff',
  buildings: '#8d99a6',
  rail: '#4a4f57',
  frame: '#d8d0c2',
}

const FRAME_W = 2.5
const LABEL_BAND = 11
const LABEL_CAP = 5
const WATER_RECESS = 0.8
const GREEN_RAISE = 0.4
const ROAD_RAISE = 1.0
const RAIL_RAISE = 0.8
/** Relief heights of the building bands (by storeys), mm. */
const BUILDING_BANDS: { upTo: number; height: number }[] = [
  { upTo: 3, height: 1.6 },
  { upTo: 6, height: 2.4 },
  { upTo: 12, height: 3.6 },
  { upTo: Infinity, height: 6 },
]
const FLAT_BUILDING = 1.8
/** Widths of the road classes on the ground, metres. */
const ROAD_WIDTH: Record<RoadClass, number> = { motorway: 26, primary: 16, secondary: 12, tertiary: 9, residential: 7, path: 3.5 }
const MIN_STRIP = 0.9

interface MapLayer {
  name: string
  color: string
  regions: ShapeRegion[]
  /** Height over the plate's top, mm (negative: sunk). */
  relief: number
}

export interface MapLayout {
  width: number
  /** The plate's outline, product mm. */
  plate: Point2[]
  /** The window the map fills (inside the frame and over the label). */
  window: Point2[]
  layers: MapLayer[]
  label: { regions: ShapeRegion[]; height: number } | null
  patch: MapData | null
}

function plateRing(shape: string, w: number, inset: number, cx: number, cy: number): Point2[] {
  const size = w - 2 * inset
  if (shape === 'round') {
    const pts: Point2[] = []
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2
      pts.push({ x: cx + (size / 2) * Math.cos(a), y: cy + (size / 2) * Math.sin(a) })
    }
    return pts
  }
  if (shape === 'hex') {
    const pts: Point2[] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6
      pts.push({ x: cx + (size / 2) * Math.cos(a), y: cy + (size / 2) * Math.sin(a) })
    }
    return pts
  }
  const r = Math.min(4, size / 8)
  const h = size / 2 - r
  const pts: Point2[] = []
  const corners = [
    { x: cx + h, y: cy + h, from: 0 },
    { x: cx - h, y: cy + h, from: Math.PI / 2 },
    { x: cx - h, y: cy - h, from: Math.PI },
    { x: cx + h, y: cy - h, from: (3 * Math.PI) / 2 },
  ]
  for (const c of corners) for (let i = 0; i <= 6; i++) pts.push({ x: c.x + r * Math.cos(c.from + (i / 6) * (Math.PI / 2)), y: c.y + r * Math.sin(c.from + (i / 6) * (Math.PI / 2)) })
  return pts
}

const memo = new Map<string, MapLayout>()

/** The 2D layers of the map for a spec (memoised: the preview and the
 * build share it). */
export function mapLayout(spec: ProductSpec): MapLayout {
  const place = placeSync(str(spec, 'place', SAMPLE_PLACE.name)) ?? SAMPLE_PLACE
  const span = num(spec, 'span', 1500)
  const width = num(spec, 'width', 150)
  const shape = str(spec, 'outline', 'square')
  const frame = bool(spec, 'frame', true)
  const label = str(spec, 'label', '').trim()
  const relief = str(spec, 'relief', 'levels')
  const show = { water: bool(spec, 'water', true), green: bool(spec, 'green', true), roads: bool(spec, 'roads', true), buildings: bool(spec, 'buildings', true), rail: bool(spec, 'rail', false) }
  const patch = cachedPatch(place, span)
  const key = JSON.stringify([place.lat, place.lon, span, width, shape, frame, label, relief, show, patch?.source ?? null, patch?.buildings.length ?? -1])
  const hit = memo.get(key)
  if (hit) return hit

  const cx = width / 2, cy = width / 2
  const plate = plateRing(shape, width, 0, cx, cy)
  const inset = frame ? FRAME_W : 0
  let windowPoly: Poly = [polygonOf([plateRing(shape, width, inset, cx, cy)])]
  const labelOut = label ? textRegions(label, LABEL_CAP, 0.3) : null
  if (labelOut) {
    // The band along the bottom, inside the frame.
    const top = width - inset - LABEL_BAND
    windowPoly = subtract(windowPoly, [polygonOf([[{ x: -1, y: top }, { x: width + 1, y: top }, { x: width + 1, y: width + 1 }, { x: -1, y: width + 1 }]])])
  }
  const windowRing = regionsOf(windowPoly, 0, 0)[0]?.outer.points ?? plate

  const layers: MapLayer[] = []
  if (patch) {
    const scale = width / span
    const toMm = (p: Point2): Point2 => ({ x: cx + p.x * scale, y: cy - p.y * scale })
    const polys = (list: Point2[][][]) => unionPolygons(list.map((rings) => rings.map((r) => simplify(r.map(toMm), 0.08))))
    const strips = (lines: { points: Point2[]; width: number }[]) => unite(...lines.map((l) => strip(simplify(l.points.map(toMm), 0.1), Math.max(MIN_STRIP, l.width * scale))))

    const water = show.water ? clip(unite(polys(patch.water), strips(patch.rivers)), windowPoly) : EMPTY
    const roads = show.roads ? clip(strips(patch.roads.filter((r) => r.cls !== 'path' || span <= 1200).map((r) => ({ points: r.points, width: ROAD_WIDTH[r.cls] }))), windowPoly) : EMPTY
    const rail = show.rail ? clip(strips(patch.rail.map((points) => ({ points, width: 6 }))), windowPoly) : EMPTY
    const green = show.green ? subtract(clip(polys(patch.green), windowPoly), water, roads, rail) : EMPTY

    if (water.length) layers.push({ name: 'Water', color: COLORS.water, regions: regionsOf(water, 0.6), relief: -WATER_RECESS })
    if (green.length) layers.push({ name: 'Parks', color: COLORS.green, regions: regionsOf(green, 1), relief: GREEN_RAISE })
    if (roads.length) layers.push({ name: 'Streets', color: COLORS.roads, regions: regionsOf(roads, 0.3), relief: ROAD_RAISE })
    if (rail.length) layers.push({ name: 'Rail', color: COLORS.rail, regions: regionsOf(rail, 0.3), relief: RAIL_RAISE })

    if (show.buildings) {
      const bands = relief === 'levels' ? BUILDING_BANDS : [{ upTo: Infinity, height: FLAT_BUILDING }]
      let taller: Poly = EMPTY
      const built: { height: number; poly: Poly }[] = []
      for (let i = bands.length - 1; i >= 0; i--) {
        const lower = i > 0 ? bands[i - 1].upTo : 0
        const inBand = patch.buildings.filter((b) => b.levels > lower && b.levels <= bands[i].upTo).map((b) => b.rings)
        let poly = subtract(clip(polys(inBand), windowPoly), water, roads, rail, taller)
        poly = poly.filter((p) => Math.abs(polyRingArea(p[0])) >= 1)
        if (poly.length) built.unshift({ height: bands[i].height, poly })
        taller = unite(taller, poly)
      }
      for (const b of built) layers.push({ name: bands.length > 1 ? `Buildings ${b.height} mm` : 'Buildings', color: COLORS.buildings, regions: regionsOf(b.poly, 1), relief: b.height })
    }
  }

  let labelLayer: MapLayout['label'] = null
  if (labelOut && labelOut.regions.length) {
    const x0 = cx - labelOut.width / 2
    const y0 = width - inset - LABEL_BAND / 2 + LABEL_CAP / 2
    // The font's y is up; the plate's is down.
    const regions = labelOut.regions.map((r) => ({ outer: { points: r.outer.points.map((p) => ({ x: x0 + p.x, y: y0 - p.y })) }, holes: r.holes.map((h) => ({ points: h.points.map((p) => ({ x: x0 + p.x, y: y0 - p.y })) })) }))
    labelLayer = { regions, height: ROAD_RAISE }
  }

  const out: MapLayout = { width, plate, window: windowRing, layers, label: labelLayer, patch }
  if (memo.size > 12) memo.delete(memo.keys().next().value!)
  memo.set(key, out)
  return out
}

const polyRingArea = (ring: [number, number][]) => ring.reduce((s, [x, y], i) => s + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * y, 0) / 2

function build(spec: ProductSpec): ProductBuild {
  const layout = mapLayout(spec)
  const width = layout.width
  const base = num(spec, 'base', 3)
  const frame = bool(spec, 'frame', true)
  const parts: PartRecipe[] = [{ name: 'Plate', color: COLORS.base, outline: { kind: 'path', points: layout.plate }, depth: base }]
  if (frame) {
    const inner = plateRing(str(spec, 'outline', 'square'), width, FRAME_W, width / 2, width / 2)
    parts.push({ name: 'Frame', color: COLORS.frame, outline: { kind: 'regions', regions: [{ outer: { points: layout.plate }, holes: [{ points: inner }] }] }, depth: base + ROAD_RAISE + 0.4, z: 0 })
  }
  for (const layer of layout.layers) {
    if (layer.relief < 0) {
      // Sunk: cut the plate through here and fill the hole lower.
      parts.push({ name: `${layer.name} cut`, outline: { kind: 'regions', regions: layer.regions }, depth: base + 2, z: -1, isHole: true, cuts: 0 })
      parts.push({ name: layer.name, color: layer.color, outline: { kind: 'regions', regions: layer.regions }, depth: base + layer.relief, z: 0 })
    } else {
      // Raised: starts a little inside the plate so the two fuse.
      parts.push({ name: layer.name, color: layer.color, outline: { kind: 'regions', regions: layer.regions }, depth: layer.relief + 0.2, z: base - 0.2 })
    }
  }
  if (layout.label) parts.push({ name: 'Label', color: COLORS.roads, outline: { kind: 'regions', regions: layout.label.regions }, depth: layout.label.height + 0.2, z: base - 0.2 })
  return { width, height: width, parts, fuse: true }
}

/** The map's 2D picture for the Create panel. */
export interface MapPreview {
  kind: 'map'
  width: number
  plate: Point2[]
  window: Point2[]
  layers: { name: string; color: string; regions: ShapeRegion[] }[]
  label: ShapeRegion[] | null
  caption: string
}

function preview(spec: ProductSpec): MapPreview {
  const layout = mapLayout(spec)
  const place = str(spec, 'place', SAMPLE_PLACE.name)
  const status = mapStatus()
  const caption = layout.patch ? `${layout.patch.source === 'sample' ? 'Bundled sample of ' : ''}${place}, ${num(spec, 'span', 1500)} m across on ${layout.width} mm (1 mm = ${(num(spec, 'span', 1500) / layout.width).toFixed(1)} m). North is up.` : status.kind === 'error' ? status.message : `Loading the map of ${place}…`
  return { kind: 'map', width: layout.width, plate: layout.plate, window: layout.window, layers: layout.layers.map((l) => ({ name: l.name, color: l.color, regions: l.regions })), label: layout.label?.regions ?? null, caption }
}

export const cityMap: ProductTemplate = {
  id: 'city-map',
  name: 'City map',
  tagline: 'A relief map of any city block: streets, buildings, water and parks in their own colours.',
  category: 'Decor',
  keywords: ['map', 'city', 'relief', 'streets', 'openstreetmap', 'wall art', 'berlin'],
  prepare: async (spec) => {
    await loadFont().catch(() => undefined)
    const text = str(spec, 'place', SAMPLE_PLACE.name)
    const place = (await geocode(text).catch(() => null)) ?? (parseCoordinates(text) ? null : SAMPLE_PLACE)
    if (!place) return
    await loadPatch(place, num(spec, 'span', 1500)).catch(() => undefined)
  },
  status: (spec) => {
    const text = str(spec, 'place', SAMPLE_PLACE.name)
    const place = placeSync(text)
    if (!place) return `Looking up "${text}"…`
    const s = mapStatus()
    if (cachedPatch(place, num(spec, 'span', 1500))?.source === 'sample') return 'Berlin Mitte from the bundled sample (approximate). Map data © OpenStreetMap contributors.'
    return s.kind === 'idle' ? null : `${s.message}${s.kind === 'ready' ? ' Map data © OpenStreetMap contributors.' : ''}`
  },
  fields: [
    { kind: 'text', id: 'place', label: 'Place', maxLength: 80, placeholder: 'City, district, address or "52.52, 13.40"', hint: 'The centre of the map: a place name (looked up on OpenStreetMap) or latitude, longitude.' },
    { kind: 'number', id: 'span', label: 'Area', unit: '', min: 400, max: 4000, step: 50, hint: 'Width of the patch of the city on the plate, in metres.' },
    { kind: 'number', id: 'width', label: 'Width', unit: 'mm', min: 80, max: 250, step: 5, hint: 'Width of the printed plate.' },
    {
      kind: 'select',
      id: 'outline',
      label: 'Shape',
      options: [
        { value: 'square', label: 'Square' },
        { value: 'round', label: 'Round' },
        { value: 'hex', label: 'Hexagon' },
      ],
    },
    { kind: 'number', id: 'base', label: 'Base', unit: 'mm', min: 2, max: 6, step: 0.5, hint: 'Thickness of the plate under the map.' },
    { kind: 'boolean', id: 'frame', label: 'Frame', hint: 'A raised rim round the edge.' },
    { kind: 'text', id: 'label', label: 'Label', maxLength: 30, placeholder: 'City name', hint: 'Lettering along the bottom edge; leave empty for none.' },
    { kind: 'boolean', id: 'roads', label: 'Streets', hint: 'Streets raised 1 mm, wider for the main roads.' },
    { kind: 'boolean', id: 'buildings', label: 'Buildings', hint: 'Building footprints as blocks.' },
    {
      kind: 'select',
      id: 'relief',
      label: 'Block height',
      options: [
        { value: 'levels', label: 'By storeys' },
        { value: 'flat', label: 'All the same' },
      ],
      hint: 'By storeys: four heights from the storey counts in the map data.',
    },
    { kind: 'boolean', id: 'water', label: 'Water', hint: 'Rivers and lakes sunk 0.8 mm into the plate.' },
    { kind: 'boolean', id: 'green', label: 'Parks', hint: 'Parks and gardens as a flat layer.' },
    { kind: 'boolean', id: 'rail', label: 'Railways', hint: 'Surface railway and tram lines.' },
  ],
  defaults: { place: SAMPLE_PLACE.name, span: 1500, width: 150, outline: 'square', base: 3, frame: true, label: 'BERLIN', roads: true, buildings: true, relief: 'levels', water: true, green: true, rail: false },
  build,
  preview,
  notes: 'Prints flat in one go, no support. Each layer is its own colour (streets, buildings, water, parks, label) for a multi-colour printer; on one colour the relief alone reads as a map. Map data © OpenStreetMap contributors (ODbL).',
}
