/**
 * Map data for the city-map product: the features of a patch of the
 * world (water, parks, roads, rail, buildings) as polygons and lines in
 * local metres about the patch's centre (x east, y north).
 *
 * The data comes from OpenStreetMap (© OpenStreetMap contributors,
 * ODbL): the Overpass API returns every tagged way in a bounding box
 * with its geometry, and Photon / Nominatim turn a place name into
 * coordinates. Both are open and need no key; the one obligation is the
 * credit, which the product's notes carry. (Google's map data may not
 * be extracted or turned into derived works under its terms, and its
 * APIs give no vector geometry anyway.)
 *
 * Fetched patches are cached for the session so the product's build,
 * which must be synchronous, can read them; a bundled sample (Berlin
 * Mitte) works offline and stands in when a fetch fails.
 */
import type { Point2 } from '../../types/document'
import { BERLIN_MITTE, type SampleElement } from './berlinMitte'

export type RoadClass = 'motorway' | 'primary' | 'secondary' | 'tertiary' | 'residential' | 'path'

export interface MapData {
  /** Where the patch came from, for the status line. */
  source: 'osm' | 'sample'
  center: { lat: number; lon: number }
  /** Side of the square patch, metres. */
  span: number
  /** Polygons (outer ring first, holes after) in metres. */
  water: Point2[][][]
  green: Point2[][][]
  buildings: { rings: Point2[][]; levels: number }[]
  /** Centre lines in metres with a width in metres. */
  rivers: { points: Point2[]; width: number }[]
  roads: { points: Point2[]; cls: RoadClass }[]
  rail: Point2[][]
}

interface OsmElement {
  type: 'way' | 'relation' | 'node'
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[]
}

const METRES_PER_DEG_LAT = 110_574

/** A local flat projection about a centre: x east, y north, metres. */
export function projector(center: { lat: number; lon: number }) {
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180)
  return (lat: number, lon: number): Point2 => ({ x: (lon - center.lon) * kx, y: (lat - center.lat) * METRES_PER_DEG_LAT })
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

function overpassQuery(center: { lat: number; lon: number }, span: number): string {
  // A margin round the patch so edge features are whole; the builder
  // clips to the plate.
  const half = (span / 2) * 1.15
  const dLat = half / METRES_PER_DEG_LAT
  const dLon = half / (111_320 * Math.cos((center.lat * Math.PI) / 180))
  const bbox = `${(center.lat - dLat).toFixed(6)},${(center.lon - dLon).toFixed(6)},${(center.lat + dLat).toFixed(6)},${(center.lon + dLon).toFixed(6)}`
  return `[out:json][timeout:40];(
way["building"](${bbox});relation["building"]["type"="multipolygon"](${bbox});
way["natural"="water"](${bbox});relation["natural"="water"]["type"="multipolygon"](${bbox});
way["waterway"~"^(riverbank|river|canal)$"](${bbox});
way["leisure"~"^(park|garden|playground|pitch|golf_course|nature_reserve)$"](${bbox});relation["leisure"~"^(park|garden|nature_reserve)$"]["type"="multipolygon"](${bbox});
way["landuse"~"^(grass|forest|meadow|cemetery|recreation_ground|village_green|orchard|allotments)$"](${bbox});relation["landuse"~"^(forest|cemetery|recreation_ground)$"]["type"="multipolygon"](${bbox});
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian|service|footway|cycleway|path)$"](${bbox});
way["railway"~"^(rail|light_rail|tram)$"](${bbox});
);out geom;`
}

function roadClass(tags: Record<string, string>): RoadClass | null {
  const h = tags.highway ?? ''
  if (tags.tunnel === 'yes' || tags.layer?.startsWith('-')) return null
  if (/^(motorway|trunk)/.test(h)) return 'motorway'
  if (/^primary/.test(h)) return 'primary'
  if (/^secondary/.test(h)) return 'secondary'
  if (/^tertiary/.test(h)) return 'tertiary'
  if (/^(unclassified|residential|living_street|pedestrian|service)$/.test(h)) return h === 'service' && tags.service ? null : 'residential'
  if (/^(footway|cycleway|path)$/.test(h)) return 'path'
  return null
}

function isGreen(tags: Record<string, string>): boolean {
  return !!(tags.leisure && /^(park|garden|playground|pitch|golf_course|nature_reserve)$/.test(tags.leisure)) || !!(tags.landuse && /^(grass|forest|meadow|cemetery|recreation_ground|village_green|orchard|allotments)$/.test(tags.landuse))
}

function levelsOf(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? '')
  if (Number.isFinite(h) && h > 0) return Math.max(1, h / 3.2)
  const l = parseFloat(tags['building:levels'] ?? '')
  if (Number.isFinite(l) && l > 0) return l
  return /^(church|cathedral|tower)$/.test(tags.building ?? '') ? 8 : 4
}

function closed(ring: Point2[]): boolean {
  const a = ring[0], b = ring[ring.length - 1]
  return ring.length > 3 && Math.hypot(a.x - b.x, a.y - b.y) < 0.01
}

/** Member ways of a multipolygon chained into rings. */
function chainRings(pieces: Point2[][]): Point2[][] {
  const rest = pieces.map((p) => p.slice()).filter((p) => p.length > 1)
  const rings: Point2[][] = []
  const same = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05
  while (rest.length > 0) {
    const ring = rest.shift()!
    let grew = true
    while (!closed(ring) && grew) {
      grew = false
      for (let i = 0; i < rest.length; i++) {
        const p = rest[i]
        const end = ring[ring.length - 1]
        if (same(end, p[0])) ring.push(...p.slice(1))
        else if (same(end, p[p.length - 1])) ring.push(...p.slice(0, -1).reverse())
        else continue
        rest.splice(i, 1)
        grew = true
        break
      }
    }
    if (closed(ring)) rings.push(ring.slice(0, -1))
  }
  return rings
}

/** Elements (Overpass `out geom` JSON) as map data about `center`. */
export function parseElements(elements: OsmElement[], center: { lat: number; lon: number }, span: number, source: MapData['source']): MapData {
  const proj = projector(center)
  const data: MapData = { source, center, span, water: [], green: [], buildings: [], rivers: [], roads: [], rail: [] }
  const toPoints = (g: { lat: number; lon: number }[] | undefined) => (g ?? []).map((p) => proj(p.lat, p.lon))
  for (const el of elements) {
    const tags = el.tags ?? {}
    let polygons: Point2[][][] = []
    let line: Point2[] = []
    if (el.type === 'way') {
      const pts = toPoints(el.geometry)
      if (pts.length < 2) continue
      if (closed(pts)) polygons = [[pts.slice(0, -1)]]
      line = pts
    } else if (el.type === 'relation') {
      const outers = chainRings((el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => toPoints(m.geometry)))
      const inners = chainRings((el.members ?? []).filter((m) => m.type === 'way' && m.role === 'inner').map((m) => toPoints(m.geometry)))
      // Each outer takes the holes inside it (by a point test).
      polygons = outers.map((o) => [o, ...inners.filter((h) => pointInRing(h[0], o))])
    } else continue

    if (tags.building && polygons.length) {
      const levels = levelsOf(tags)
      for (const rings of polygons) data.buildings.push({ rings, levels })
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank' || (tags.waterway && polygons.length && tags.area === 'yes')) {
      data.water.push(...polygons)
    } else if (tags.waterway && line.length > 1) {
      const w = parseFloat(tags.width ?? '')
      data.rivers.push({ points: line, width: Number.isFinite(w) && w > 0 ? w : tags.waterway === 'canal' ? 20 : 30 })
    } else if (isGreen(tags) && polygons.length) {
      data.green.push(...polygons)
    } else if (tags.highway && line.length > 1 && !closed(line)) {
      const cls = roadClass(tags)
      if (cls) data.roads.push({ points: line, cls })
    } else if (tags.highway && line.length > 1 && (tags.area !== 'yes')) {
      // A closed way that is a road loop (a roundabout, a ring road).
      const cls = roadClass(tags)
      if (cls) data.roads.push({ points: line, cls })
    } else if (tags.railway && line.length > 1 && tags.tunnel !== 'yes' && !tags.layer?.startsWith('-')) {
      data.rail.push(line)
    }
  }
  return data
}

function pointInRing(p: Point2, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// ---- Places -------------------------------------------------------------

export interface Place {
  name: string
  lat: number
  lon: number
}

/** The bundled patch: used without the network, and as the fallback. */
export const SAMPLE_PLACE: Place = { name: 'Berlin Mitte', lat: BERLIN_MITTE.center.lat, lon: BERLIN_MITTE.center.lon }

const placeCache = new Map<string, Place>()

/** "52.52, 13.40" → coordinates; anything else is looked up. */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1]), lon = parseFloat(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

/** The place for a text without the network: coordinates, the sample
 * place, or a lookup already made. */
export function placeSync(text: string): Place | null {
  const q = text.trim()
  const coords = parseCoordinates(q)
  if (coords) return { name: q, ...coords }
  const key = q.toLowerCase()
  if (!q || key === SAMPLE_PLACE.name.toLowerCase() || key === 'berlin-mitte' || key === 'mitte, berlin') return SAMPLE_PLACE
  return placeCache.get(key) ?? null
}

export async function geocode(text: string): Promise<Place | null> {
  const q = text.trim()
  if (!q) return null
  const coords = parseCoordinates(q)
  if (coords) return { name: q, ...coords }
  const key = q.toLowerCase()
  if (key === SAMPLE_PLACE.name.toLowerCase() || key === 'berlin-mitte' || key === 'mitte, berlin') return SAMPLE_PLACE
  const hit = placeCache.get(key)
  if (hit) return hit
  const found = (await photon(q).catch(() => null)) ?? (await nominatim(q).catch(() => null))
  if (found) placeCache.set(key, found)
  return found
}

async function photon(q: string): Promise<Place | null> {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`)
  if (!r.ok) return null
  const j = (await r.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: { name?: string; city?: string; country?: string } }[] }
  const f = j.features?.[0]
  if (!f) return null
  const p = f.properties
  return { name: [p.name, p.city, p.country].filter(Boolean).join(', '), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }
}

async function nominatim(q: string): Promise<Place | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`)
  if (!r.ok) return null
  const j = (await r.json()) as { lat: string; lon: string; display_name: string }[]
  const f = j[0]
  return f ? { name: f.display_name.split(',').slice(0, 2).join(','), lat: parseFloat(f.lat), lon: parseFloat(f.lon) } : null
}

// ---- Patches ------------------------------------------------------------

export interface MapStatus {
  kind: 'idle' | 'loading' | 'ready' | 'sample' | 'error'
  message: string
}

const patches = new Map<string, MapData>()
const inflight = new Map<string, Promise<MapData>>()
let status: MapStatus = { kind: 'idle', message: '' }

export const mapStatus = () => status

export function patchKey(place: { lat: number; lon: number }, span: number): string {
  return `${place.lat.toFixed(4)},${place.lon.toFixed(4)},${Math.round(span)}`
}

/** The patch for a place if it has been loaded (the sample for the
 * sample place, always). */
export function cachedPatch(place: { lat: number; lon: number }, span: number): MapData | null {
  const hit = patches.get(patchKey(place, span))
  if (hit) return hit
  if (isSamplePlace(place)) return samplePatch(span)
  return null
}

function isSamplePlace(place: { lat: number; lon: number }): boolean {
  return Math.abs(place.lat - SAMPLE_PLACE.lat) < 1e-4 && Math.abs(place.lon - SAMPLE_PLACE.lon) < 1e-4
}

function samplePatch(span: number): MapData {
  const key = `sample:${Math.round(span)}`
  const hit = patches.get(key)
  if (hit) return hit
  const elements: OsmElement[] = BERLIN_MITTE.elements.map((e: SampleElement, i) => ({ type: 'way', id: i, tags: e.tags, geometry: e.points.map(([lon, lat]) => ({ lat, lon })) }))
  const data = parseElements(elements, BERLIN_MITTE.center, span, 'sample')
  patches.set(key, data)
  return data
}

/** Fetches the patch about `place` (cached per place and span). The
 * bundled sample stands in for its own place and when nothing can be
 * fetched. */
export function loadPatch(place: Place, span: number): Promise<MapData> {
  const key = patchKey(place, span)
  const hit = patches.get(key)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running
  const p = (async () => {
    status = { kind: 'loading', message: `Loading the map of ${place.name}…` }
    let lastError = ''
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQuery(place, span)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        if (!r.ok) {
          lastError = `${r.status}`
          continue
        }
        const j = (await r.json()) as { elements: OsmElement[] }
        const data = parseElements(j.elements, place, span, 'osm')
        patches.set(key, data)
        status = { kind: 'ready', message: `${place.name}: ${data.buildings.length} buildings, ${data.roads.length} roads, ${data.water.length + data.rivers.length} water, ${data.green.length} green areas (OpenStreetMap).` }
        return data
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    if (isSamplePlace(place)) {
      status = { kind: 'sample', message: 'Berlin Mitte from the bundled sample (approximate); live OpenStreetMap data could not be fetched.' }
      return samplePatch(span)
    }
    status = { kind: 'error', message: `Could not load the map of ${place.name} (${lastError || 'no connection'}). Check the connection and try again, or pick Berlin Mitte for the bundled sample.` }
    throw new Error(status.message)
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
