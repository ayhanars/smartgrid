import type { Point2 } from '../../types/document'
import type { PartRecipe, ProductBuild } from './types'
import { arcPoints } from '../geometry/tube'

/** A tab-through-an-opening mount, in mm: the tab goes through the
 * opening and a lip drops behind the sheet. Shared by every pegboard. */
export interface MountDims {
  /** Vertical thickness of the tab (and of the lip). */
  tabThickness: number
  /** Thickness of the lip behind the sheet, front to back. */
  lipThickness: number
  /** Room for the sheet between the part's face and the lip. */
  gap: number
  /** How far the lip drops behind the sheet. */
  lipDrop: number
  /** Width of the tab along the sheet: what the opening allows. */
  tabWidth: number
  /** Fillet on the tab's side faces, mm: rounds a peg for a round hole. */
  round?: number
  /** Set for a lip that turns UP behind the sheet (a classic pegboard
   * hook, hung by tilting) instead of dropping; `lipDrop` is ignored.
   * Standing, it prints as a column on the shank, no chamfer needed. */
  lipRise?: number
}

/**
 * Side profile of a mounting tab, as (h, b): h up from the tab's own
 * bottom, b backward from the mounting face (negative = into the part).
 * The lip's underside and the tab's underside are 45° so the part
 * prints standing up with no support.
 */
export function mountProfile(m: MountDims, embed: number): { points: { h: number; b: number }[]; height: number } {
  const { tabThickness: t, lipThickness: lt, gap, lipDrop } = m
  if (m.lipRise) {
    // Shank from the part through the sheet, lip rising behind it,
    // joined by a pipe-like elbow.
    const height = t + m.lipRise
    return { height, points: [{ h: 0, b: -embed }, ...elbowUp(t, gap, height), { h: t, b: -embed }] }
  }
  const height = t + Math.max(lipDrop, gap + embed)
  const top = height
  const back = gap + lt
  const points = [
    { h: top, b: -embed },
    { h: top, b: back },
    { h: top - t - lipDrop, b: back },
    // Chamfer under the lip, up toward the sheet.
    { h: top - t - lipDrop + lt, b: gap },
    { h: top - t, b: gap },
    // Gusset under the tab, down to the part.
    { h: top - t - (gap + embed), b: -embed },
  ]
  return { points, height }
}

/**
 * The bend of a shank into an upward lip, as (h, b) from the end of the
 * shank's underside round to the end of its top: a pipe elbow whose
 * centreline radius is the pipe's own thickness (outer radius 1.5 t,
 * inner 0.5 t), then the lip up to `height` and back down its front.
 */
function elbowUp(t: number, gap: number, height: number): { h: number; b: number }[] {
  const back = gap + t
  const ro = 1.5 * t
  const ri = 0.5 * t
  const c = { h: ro, b: back - ro }
  const arc = (r: number, from: number, to: number, steps: number) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / steps
      return { h: c.h + r * Math.sin(a), b: c.b + r * Math.cos(a) }
    })
  return [
    ...arc(ro, -Math.PI / 2, 0, 8),
    { h: height, b: back },
    { h: height, b: gap },
    ...arc(ri, 0, -Math.PI / 2, 6),
  ]
}

/** Side profile → canvas path standing up (rotation y 90°): canvas x
 * becomes height, canvas y stays depth; the extrusion becomes the width,
 * centred on the profile's x centre. */
export function standingPath(points: { h: number; b: number }[], centerX: number, height: number, faceY: number): Point2[] {
  // The tilt maps canvas x to height with x growing DOWNWARD (the
  // footprint's near edge ends up on top), hence the mirror.
  return points.map((p) => ({ x: centerX + height / 2 - p.h, y: faceY - p.b }))
}

/**
 * A round hook as one swept tube, for a round-hole board: a shank
 * through the sheet, a quarter bend (centreline radius = the peg's
 * diameter) and a lip rising behind the sheet. Standing (a bin's hook):
 * `cx` is the hook's centre across the board, `faceY` the mounting face
 * on the canvas, `c` the shank's centre height. Lying flat (a hook that
 * prints on its side): `faceX` is the mounting face along canvas x (the
 * hook's depth axis), `shankY` the shank's centre on canvas y with up =
 * canvas y decreasing, `zc` the tube's centre height above the bed.
 */
export function roundHookParts(o: { d: number; gap: number; rise: number; embed: number; color: string; name: string } & ({ standing: true; cx: number; faceY: number; c: number } | { standing: false; faceX: number; shankY: number; zc: number })): PartRecipe[] {
  const { d, gap, rise, embed, color, name } = o
  const R = d
  const r = d / 2
  const points = o.standing
    ? [
        { x: o.cx, y: o.faceY + embed, z: o.c },
        { x: o.cx, y: o.faceY - gap, z: o.c },
        ...arcPoints({ x: o.cx, y: o.faceY - gap, z: o.c + R }, R, { x: 0, y: 0, z: -1 }, { x: 0, y: -1, z: 0 }, 0, Math.PI / 2, 8).slice(1),
        { x: o.cx, y: o.faceY - gap - R, z: o.c + rise },
      ]
    : [
        { x: o.faceX - embed, y: o.shankY, z: o.zc },
        { x: o.faceX + gap, y: o.shankY, z: o.zc },
        ...arcPoints({ x: o.faceX + gap, y: o.shankY - R, z: o.zc }, R, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 0, Math.PI / 2, 8).slice(1),
        { x: o.faceX + gap + R, y: o.shankY - rise, z: o.zc },
      ]
  return [{ name, color, outline: { kind: 'tube', radius: r, points }, depth: d }]
}

/**
 * A J-hook that prints lying on its side: a back plate against the
 * sheet, the mounting tab at its top, an arm forward with an upturned
 * tip. `width` is the extrusion (along the sheet). A hook wider than
 * its opening gets the tab as a narrower piece centred on the plate,
 * fused at export.
 */
export function jHook(o: { mount: MountDims; reach: number; width: number; arm: number; tip: number; plateH: number; color: string }): ProductBuild {
  const { reach, width, arm, tip, plateH, color } = o
  const { tabThickness: t, lipThickness: lt, gap, lipDrop, tabWidth } = o.mount
  const plateT = 4
  const top = plateH + t
  const back = gap + lt
  const offset = plateT + reach
  const rise = o.mount.lipRise ?? 0
  // (b, h): b backward from the sheet face (negative = in front), h up;
  // lying flat on the canvas x is the depth axis (front to the left) and
  // y is height (top of the hook toward the top of the canvas).
  const toCanvas = (p: { b: number; h: number }): Point2 => ({ x: p.b + offset, y: top + rise - p.h })
  const tab: { b: number; h: number }[] = o.mount.lipRise
    ? // The elbow runs from the shank's underside round to its top; the
      // hook's outline goes the other way, so it is reversed and lifted
      // to the plate's top.
      elbowUp(t, gap, t + o.mount.lipRise)
        .map((p) => ({ b: p.b, h: p.h + top - t }))
        .reverse()
    : [
        { b: back, h: top },
        { b: back, h: top - t - lipDrop },
        { b: gap, h: top - t - lipDrop + lt },
        { b: gap, h: top - t },
      ]
  const body: { b: number; h: number }[] = [
    { b: 0, h: top },
    ...tab,
    { b: 0, h: top - t },
    { b: 0, h: 0 },
    { b: -offset, h: 0 },
    { b: -offset, h: arm + tip },
    { b: -offset + Math.min(arm, reach), h: arm + tip },
    { b: -offset + Math.min(arm, reach), h: arm },
    { b: -plateT, h: arm },
    { b: -plateT, h: top },
  ]
  const peg = Math.min(width, tabWidth)
  if (peg >= width - 0.05) {
    return { width: offset + back, height: top + rise, parts: [{ name: 'Hook', color, outline: { kind: 'path', points: body.map(toCanvas) }, depth: width }] }
  }
  // Plate and arm at full width; the tab as its own narrower piece,
  // embedded one plate thickness into the plate so the union is solid.
  const plate: { b: number; h: number }[] = [
    { b: 0, h: top },
    { b: 0, h: 0 },
    { b: -offset, h: 0 },
    { b: -offset, h: arm + tip },
    { b: -offset + Math.min(arm, reach), h: arm + tip },
    { b: -offset + Math.min(arm, reach), h: arm },
    { b: -plateT, h: arm },
    { b: -plateT, h: top },
  ]
  const tabPiece: { b: number; h: number }[] = [{ b: -plateT + 0.5, h: top }, ...tab, { b: -plateT + 0.5, h: top - t }]
  const parts: PartRecipe[] = [
    { name: 'Hook', color, outline: { kind: 'path', points: plate.map(toCanvas) }, depth: width },
    { name: 'Tab', color, outline: { kind: 'path', points: tabPiece.map(toCanvas) }, depth: peg, z: (width - peg) / 2, bevel: o.mount.round },
  ]
  return { width: offset + back, height: top + rise, parts, fuse: true }
}
