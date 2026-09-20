import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { Bounds, ShapeLayer } from '../../types/document'
import { shapeWorldBounds } from '../../state/documentStore'
import { buildLayerCutters, buildLayerGeometries, perforationTessellation } from '../../lib/geometry/layerGeometry'
import { cutHolesAsync, type CsgJob } from '../../lib/geometry/csgClient'
import type { PositionedGeometry } from '../../lib/geometry/holeCut'
import { SCENE_SCALE } from './sceneScale'

function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/** Everything about a layer that changes its built geometry (not its
 * name, color, selection...), so a cut is redone only when it must be. */
function geometryKey(layer: ShapeLayer): string {
  const { name: _name, color: _color, opacity: _opacity, locked: _locked, ...rest } = layer
  return JSON.stringify(rest)
}

interface CutJob {
  key: string
  bodies: THREE.BufferGeometry[]
  holes: PositionedGeometry[]
  world: { worldX: number; worldY: number; worldZ: number }
}

interface CutResult {
  key: string
  geometries: THREE.BufferGeometry[]
}

export interface CutGeometries {
  /** Solids with every overlapping hole and their own perforation subtracted. */
  cutGeometriesById: Record<string, THREE.BufferGeometry[]>
  /** The same solids before the cut (outlines are traced on these). */
  uncutGeometriesById: Record<string, THREE.BufferGeometry[]>
  /** How many shapes are still being cut in the worker. */
  pending: number
}

const RESULT_CACHE_MAX = 48

/** Finished cuts, shared by every viewport and preview on the page so a
 * shape cut once (the editor, a thumbnail, a community spin) is not cut
 * again when another component shows it. */
const sharedResultCache = new Map<string, THREE.BufferGeometry[]>()

/** Holes whose footprint overlaps a visible solid — the ones doing real
 * cutting right now (as opposed to a cutter parked off to the side). */
export function activeHoleIds(layers: Record<string, ShapeLayer>, order: string[]): Set<string> {
  const solids = order.filter((id) => layers[id] && !layers[id].isHole && layers[id].visible).map((id) => shapeWorldBounds(layers[id]))
  const active = new Set<string>()
  for (const id of order) {
    const layer = layers[id]
    if (!layer?.isHole || !layer.visible) continue
    const bounds = shapeWorldBounds(layer)
    if (solids.some((b) => rectsOverlap(b, bounds))) active.add(id)
  }
  return active
}

/**
 * A hole is a cutting tool, not a printable shape: any solid whose XY
 * footprint overlaps a hole's gets that hole's volume subtracted from it
 * via a real 3D boolean, independent of the hole's own Z/depth; a shape's
 * own perforation is cut the same way. The boolean runs in a worker, so
 * the viewport keeps showing the previous result (or the uncut shape)
 * until the new one arrives instead of freezing.
 */
export function useCutGeometries(
  layers: Record<string, ShapeLayer>,
  order: string[],
  artboardWidth: number,
  artboardHeight: number,
  tileVersion: number,
): CutGeometries {
  // Built inputs, reused across renders while a shape's key is unchanged:
  // building a big textured body is itself a few hundred ms.
  const builtCache = useRef(new Map<string, CutJob>())

  const jobs = useMemo(() => {
    const out: Record<string, CutJob> = {}
    const holeIds = order.filter((id) => layers[id]?.isHole && layers[id]?.visible)
    if (holeIds.length === 0 && !order.some((id) => layers[id]?.perforation && !layers[id]?.isHole)) return out

    const toWorld = (layer: ShapeLayer) => ({
      worldX: (layer.transform.x - artboardWidth / 2) * SCENE_SCALE,
      worldY: layer.transform.z * SCENE_SCALE,
      worldZ: (layer.transform.y - artboardHeight / 2) * SCENE_SCALE,
    })

    const used = new Map<string, CutJob>()
    for (const id of order) {
      const layer = layers[id]
      if (!layer || layer.isHole || !layer.visible) continue
      const solidBounds = shapeWorldBounds(layer)
      const overlappingHoles = holeIds.filter((hid) => hid !== id && rectsOverlap(solidBounds, shapeWorldBounds(layers[hid])))
      if (overlappingHoles.length === 0 && !layer.perforation) continue

      const key = JSON.stringify([geometryKey(layer), overlappingHoles.map((hid) => geometryKey(layers[hid])), artboardWidth, artboardHeight, tileVersion])
      let job = builtCache.current.get(key)
      if (!job) {
        const world = toWorld(layer)
        const holeLayers = overlappingHoles.map((hid) => layers[hid])
        // Cavities go first and, on a perforated body, are built at the
        // same subdivision: a cavity's few huge faces split against tens
        // of thousands of drilled-wall triangles takes ~40 s instead of 2.
        const tessellate = perforationTessellation(layer)
        const holes: PositionedGeometry[] = [
          ...holeLayers.flatMap((holeLayer) => {
            const holeWorld = toWorld(holeLayer)
            return buildLayerGeometries(holeLayer, SCENE_SCALE, { tessellate }).map((geometry) => ({ geometry, ...holeWorld }))
          }),
          ...buildLayerCutters(layer, SCENE_SCALE, holeLayers).map((geometry) => ({ geometry, ...world })),
        ]
        if (holes.length === 0) continue
        job = { key, bodies: buildLayerGeometries(layer, SCENE_SCALE), holes, world }
      }
      used.set(key, job)
      out[id] = job
    }
    builtCache.current = used
    return out
  }, [layers, order, artboardWidth, artboardHeight, tileVersion])

  const [results, setResults] = useState<Record<string, CutResult>>({})
  const inFlight = useRef(new Map<string, CsgJob>())
  const resultCache = useRef(sharedResultCache)

  useEffect(() => {
    const wanted = new Set(Object.values(jobs).map((j) => j.key))
    // Drop queued work nobody wants any more.
    for (const [key, job] of inFlight.current) {
      if (!wanted.has(key)) {
        job.cancel()
        inFlight.current.delete(key)
      }
    }
    for (const [id, job] of Object.entries(jobs)) {
      const cached = resultCache.current.get(job.key)
      if (cached) {
        setResults((r) => (r[id]?.key === job.key ? r : { ...r, [id]: { key: job.key, geometries: cached } }))
        continue
      }
      if (inFlight.current.has(job.key)) continue
      const jobPromises = job.bodies.map((geo) => cutHolesAsync({ geometry: geo, ...job.world }, job.holes))
      const handle: CsgJob = {
        promise: Promise.all(jobPromises.map((j) => j.promise)).then((geometries) => {
          inFlight.current.delete(job.key)
          resultCache.current.set(job.key, geometries)
          while (resultCache.current.size > RESULT_CACHE_MAX) {
            const oldest = resultCache.current.keys().next().value
            if (oldest === undefined) break
            resultCache.current.delete(oldest)
          }
          setResults((r) => ({ ...r, [id]: { key: job.key, geometries } }))
          return geometries[0]
        }),
        cancel: () => jobPromises.forEach((j) => j.cancel()),
      }
      handle.promise.catch((err) => {
        inFlight.current.delete(job.key)
        // CSG on arbitrary/degenerate geometry is best-effort: leave this
        // shape uncut rather than taking the viewport down with it.
        console.error(`Hole cut failed for shape ${id}, rendering it uncut instead:`, err)
        resultCache.current.set(job.key, job.bodies)
        setResults((r) => ({ ...r, [id]: { key: job.key, geometries: job.bodies } }))
      })
      inFlight.current.set(job.key, handle)
    }
  }, [jobs])

  return useMemo(() => {
    const cutGeometriesById: Record<string, THREE.BufferGeometry[]> = {}
    const uncutGeometriesById: Record<string, THREE.BufferGeometry[]> = {}
    let pending = 0
    for (const [id, job] of Object.entries(jobs)) {
      uncutGeometriesById[id] = job.bodies
      const result = results[id]
      if (result?.key === job.key) cutGeometriesById[id] = result.geometries
      else {
        pending++
        // Keep the last cut of this shape on screen while the new one
        // computes; a shape cut for the first time shows uncut meanwhile.
        cutGeometriesById[id] = result?.geometries ?? job.bodies
      }
    }
    return { cutGeometriesById, uncutGeometriesById, pending }
  }, [jobs, results])
}
