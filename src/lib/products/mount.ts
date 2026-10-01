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
 * The mounts of a round-hole board, copied 1:1 off a printed BROR bin
 * (the reference STL). Two kinds, one hole pitch apart:
 * - the hook, a round rod 1.2 mm thinner than the hole: straight through
 *   the sheet (`gap` behind the face), then a bend of `HOOK_BEND` upward
 *   on a `HOOK_RADIUS` centreline radius, `HOOK_TIP` of straight rod and
 *   a domed end (a sphere of the rod's radius);
 * - the stud below it, a round rod 0.5 mm thinner than the hole, straight
 *   with the same domed end, which sits in its hole and stops the bin
 *   tilting or swinging.
 */
export const HOOK_BEND = (50 * Math.PI) / 180
export const HOOK_RADIUS = 4
export const HOOK_TIP = 2.9
export const HOOK_PLAY = 1.2
export const STUD_PLAY = 0.5
/** The hook's straight run behind the face, past the sheet. */
export const HOOK_CLEAR = 1.64
/** The stud's straight run behind the face, past the sheet, before the dome. */
export const STUD_CLEAR = 2.75

/** How far the hook reaches behind the face past its straight run (the
 * dome included), and how high its tip rises above the shank's centre. */
export function hookReach(d: number): { back: number; up: number } {
  const r = d / 2
  return { back: HOOK_RADIUS * Math.sin(HOOK_BEND) + HOOK_TIP * Math.cos(HOOK_BEND) + r, up: HOOK_RADIUS * (1 - Math.cos(HOOK_BEND)) + HOOK_TIP * Math.sin(HOOK_BEND) + r }
}

/** A sphere: a disc as long as it is wide with both edges filleted to
 * its radius. */
function sphere(name: string, color: string, c: { x: number; y: number; z: number }, d: number): PartRecipe {
  const r = d / 2
  return { name, color, outline: { kind: 'circle', x: c.x - r, y: c.y - r, width: d, height: d }, depth: d, bevel: r, z: c.z - r }
}

type Standing = { standing: true; cx: number; faceY: number; c: number }
type Lying = { standing: false; faceX: number; shankY: number; zc: number }

/** The hook as a swept tube plus its domed end. Standing: on a bin's
 * back face at `faceY` (the bin toward larger y), centred `c` above the
 * bed. Lying flat (a hook's plate): the face at `faceX` with the board
 * toward larger x, the shank at canvas `shankY` (up is smaller y),
 * centred `zc` above the bed. */
export function brorHookParts(o: { d: number; gap: number; embed: number; color: string; name: string } & (Standing | Lying)): PartRecipe[] {
  const { d, gap, embed, color, name } = o
  const steps = 6
  // (b, h): b behind the face, h above the shank's centre.
  const line: { b: number; h: number }[] = [{ b: -embed, h: 0 }, { b: gap, h: 0 }]
  for (let i = 1; i <= steps; i++) {
    const t = (HOOK_BEND * i) / steps
    line.push({ b: gap + HOOK_RADIUS * Math.sin(t), h: HOOK_RADIUS * (1 - Math.cos(t)) })
  }
  const last = line[line.length - 1]
  const end = { b: last.b + HOOK_TIP * Math.cos(HOOK_BEND), h: last.h + HOOK_TIP * Math.sin(HOOK_BEND) }
  line.push(end)
  const to = o.standing ? (p: { b: number; h: number }) => ({ x: o.cx, y: o.faceY - p.b, z: o.c + p.h }) : (p: { b: number; h: number }) => ({ x: o.faceX + p.b, y: o.shankY - p.h, z: o.zc })
  return [
    { name, color, outline: { kind: 'tube', radius: d / 2, points: line.map(to) }, depth: d },
    sphere(`${name} tip`, color, to(end), d),
  ]
}

/** The straight stud with its domed end, `straight` behind the face. */
export function brorStudParts(o: { d: number; straight: number; embed: number; color: string; name: string } & (Standing | Lying)): PartRecipe[] {
  const { d, straight, embed, color, name } = o
  const to = o.standing ? (b: number) => ({ x: o.cx, y: o.faceY - b, z: o.c }) : (b: number) => ({ x: o.faceX + b, y: o.shankY, z: o.zc })
  return [
    { name, color, outline: { kind: 'tube', radius: d / 2, points: [to(-embed), to(straight)] }, depth: d },
    sphere(`${name} tip`, color, to(straight), d),
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
