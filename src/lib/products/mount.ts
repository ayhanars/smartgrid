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

/** The bend of a round hook: a short sweep of `HOOK_BEND` degrees on a
 * radius of `HOOK_RADIUS` pegs, then a short lip. Short enough to tilt
 * into the hole, and it still looks up behind the sheet. */
export const HOOK_BEND = (40 * Math.PI) / 180
export const HOOK_RADIUS = 0.6

/** How far a round hook of peg diameter `d` reaches behind the sheet
 * face (past the gap), and how high its tip rises above the shank. */
export function roundHookReach(d: number, rise: number): { back: number; up: number } {
  const R = HOOK_RADIUS * d
  return { back: R * Math.sin(HOOK_BEND) + rise * Math.cos(HOOK_BEND) + d / 2, up: R * (1 - Math.cos(HOOK_BEND)) + rise * Math.sin(HOOK_BEND) + d / 2 }
}

/**
 * The rod of a round-hole board, copied 1:1 off a printed BROR holder
 * (the reference STL: a Ø5.5 rod). It rests on top of the back wall
 * rather than through it: its underside is `ROD_LIFT` above the wall's
 * top, it reaches `ROD_BEYOND` past the sheet with a flat, vertical end
 * (no upturn at all), a 45° gusset fills the corner under its root, and
 * over the wall it dips into the wall's top so it merges with the body
 * instead of ending in a stub. Everything scales with the rod diameter
 * except the two small lengths, which are what the reference has.
 */
export const ROD_LIFT = 2.1
export const ROD_GUSSET = 2.3
export const ROD_BEYOND = 5.6

/** How far the rod reaches behind the sheet face (past the gap), and
 * how far it rises above the wall it sits on. */
export function rodReach(d: number): { back: number; up: number } {
  return { back: ROD_BEYOND, up: ROD_LIFT + d }
}

/** The rod (a swept tube) with its gusset, standing (a bin's back wall,
 * `top` = the wall's top height, `wall` its thickness, the face at
 * `faceY` with the bin toward larger y) or lying flat (a hook's plate:
 * the back face at `faceX`, the plate's top edge at canvas `topY`, the
 * rod's centre `zc` above the bed). */
export function rodParts(o: { d: number; gap: number; wall: number; color: string; name: string } & ({ standing: true; cx: number; faceY: number; top: number } | { standing: false; faceX: number; topY: number; zc: number })): PartRecipe[] {
  const { d, gap, wall, color, name } = o
  const reach = gap + ROD_BEYOND
  const axis = ROD_LIFT + d / 2
  // Where the centreline meets the inner face, above the wall's top.
  const dip = 0.25 * d
  const bend = ROD_GUSSET + 0.2
  // (b, h): b behind the face, h above the wall's top.
  const gusset = [
    { b: 0, h: 0 },
    { b: ROD_GUSSET, h: ROD_LIFT },
    { b: ROD_GUSSET, h: axis },
    { b: -wall, h: dip },
    { b: -wall, h: 0 },
  ]
  if (o.standing) {
    const points = [
      { x: o.cx, y: o.faceY - reach, z: o.top + axis },
      { x: o.cx, y: o.faceY - bend, z: o.top + axis },
      { x: o.cx, y: o.faceY + wall, z: o.top + dip },
    ]
    return [
      { name, color, outline: { kind: 'tube', radius: d / 2, points }, depth: d },
      { name: `${name} gusset`, color, outline: { kind: 'path', points: standingPath(gusset, o.cx, axis, o.faceY) }, depth: d, rotation: { y: 90 }, z: o.top },
    ]
  }
  const points = [
    { x: o.faceX + reach, y: o.topY - axis, z: o.zc },
    { x: o.faceX + bend, y: o.topY - axis, z: o.zc },
    { x: o.faceX - wall, y: o.topY - dip, z: o.zc },
  ]
  return [
    { name, color, outline: { kind: 'tube', radius: d / 2, points }, depth: d },
    { name: `${name} gusset`, color, outline: { kind: 'path', points: gusset.map((p) => ({ x: o.faceX + p.b, y: o.topY - p.h })) }, depth: d, z: o.zc - d / 2 },
  ]
}

/** A bin's footprint with rounded front corners and sharp back corners
 * (the back sits against the board): the slicer's layer seam then has a
 * sharp edge to hide in. `boxY` is the outline's top on the canvas, the
 * back; the front is toward larger y. */
export function binOutline(width: number, depth: number, corner: number, boxY: number): Point2[] {
  const r = Math.max(0, Math.min(corner, width / 2 - 0.1, depth / 2 - 0.1))
  const pts: Point2[] = [
    { x: 0, y: boxY },
    { x: width, y: boxY },
  ]
  const arc = (cx: number, cy: number, from: number, to: number) => {
    const n = 8
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }
  if (r > 0) {
    arc(width - r, boxY + depth - r, 0, Math.PI / 2)
    arc(r, boxY + depth - r, Math.PI / 2, Math.PI)
  } else pts.push({ x: width, y: boxY + depth }, { x: 0, y: boxY + depth })
  return pts
}

/**
 * A round hook as one swept tube, for a round-hole board: a shank
 * through the sheet, a gentle bend (HOOK_BEND on HOOK_RADIUS pegs) and
 * a straight lip of `rise` looking up behind the sheet. Standing (a
 * bin's hook): `cx` is the hook's centre across the board, `faceY` the
 * mounting face on the canvas, `c` the shank's centre height. Lying
 * flat (a hook that prints on its side): `faceX` is the mounting face
 * along canvas x (the hook's depth axis), `shankY` the shank's centre on
 * canvas y with up = canvas y decreasing, `zc` the tube's centre height
 * above the bed.
 */
export function roundHookParts(o: { d: number; gap: number; rise: number; embed: number; color: string; name: string } & ({ standing: true; cx: number; faceY: number; c: number } | { standing: false; faceX: number; shankY: number; zc: number })): PartRecipe[] {
  const { d, gap, rise, embed, color, name } = o
  const R = HOOK_RADIUS * d
  const r = d / 2
  const A = HOOK_BEND
  const sin = Math.sin(A)
  const cos = Math.cos(A)
  const points = o.standing
    ? (() => {
        const end = { x: o.cx, y: o.faceY - gap - R * sin, z: o.c + R - R * cos }
        return [
          { x: o.cx, y: o.faceY + embed, z: o.c },
          { x: o.cx, y: o.faceY - gap, z: o.c },
          ...arcPoints({ x: o.cx, y: o.faceY - gap, z: o.c + R }, R, { x: 0, y: 0, z: -1 }, { x: 0, y: -1, z: 0 }, 0, A, 8).slice(1),
          { x: end.x, y: end.y - rise * cos, z: end.z + rise * sin },
        ]
      })()
    : (() => {
        const end = { x: o.faceX + gap + R * sin, y: o.shankY - R + R * cos, z: o.zc }
        return [
          { x: o.faceX - embed, y: o.shankY, z: o.zc },
          { x: o.faceX + gap, y: o.shankY, z: o.zc },
          ...arcPoints({ x: o.faceX + gap, y: o.shankY - R, z: o.zc }, R, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 0, A, 8).slice(1),
          { x: end.x + rise * cos, y: end.y - rise * sin, z: end.z },
        ]
      })()
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
