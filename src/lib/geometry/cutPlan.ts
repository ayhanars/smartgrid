import type * as THREE from 'three'
import type { ShapeLayer } from '../../types/document'
import { buildFlatCutGeometries, buildLayerCutters, buildLayerGeometries, isFlatHole, perforationTessellation } from './layerGeometry'
import type { PositionedGeometry } from './holeCut'

export interface CutPlan {
  /** The solid's bodies: already cut in 2D where a hole allowed it. */
  bodies: THREE.BufferGeometry[]
  /** Whether anything is left for the 3D boolean. */
  needsCsg: boolean
  /** What still has to be subtracted with the 3D boolean — built on first
   * use, since a cached result never needs it. */
  holes: () => PositionedGeometry[]
}

/**
 * What it takes to show `solid` with `holeLayers` cut out of it: straight
 * through-holes are subtracted in 2D up front (cheap), everything else —
 * pockets, tilted or beveled holes, cavities, perforation — goes to the
 * CSG worker. Shared by the viewport, the previews and the exporter so
 * they all build the same thing.
 */
export function planCut(solid: ShapeLayer, holeLayers: ShapeLayer[], scale: number, toWorld: (layer: ShapeLayer) => { worldX: number; worldY: number; worldZ: number }): CutPlan {
  const flat = holeLayers.filter((h) => isFlatHole(solid, h))
  const rest = holeLayers.filter((h) => !isFlatHole(solid, h))
  const bodies = flat.length > 0 ? buildFlatCutGeometries(solid, flat, scale) : buildLayerGeometries(solid, scale)
  // Cavities go first and, on a perforated body, are built at the same
  // subdivision: a cavity's few huge faces split against tens of
  // thousands of drilled-wall triangles takes ~40 s instead of 2.
  const tessellate = perforationTessellation(solid)
  const solidWorld = toWorld(solid)
  let built: PositionedGeometry[] | null = null
  const holes = () => {
    if (!built) {
      built = [
        ...rest.flatMap((hole) => {
          const w = toWorld(hole)
          return buildLayerGeometries(hole, scale, { tessellate }).map((geometry) => ({ geometry, ...w }))
        }),
        ...buildLayerCutters(solid, scale, holeLayers).map((geometry) => ({ geometry, ...solidWorld })),
      ]
    }
    return built
  }
  return { bodies, needsCsg: rest.length > 0 || !!solid.perforation, holes }
}
