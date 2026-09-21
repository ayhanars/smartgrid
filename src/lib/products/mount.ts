import type { Point2 } from '../../types/document'
import type { PartRecipe, ProductBuild } from './types'

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
}

/**
 * Side profile of a mounting tab, as (h, b): h up from the tab's own
 * bottom, b backward from the mounting face (negative = into the part).
 * The lip's underside and the tab's underside are 45° so the part
 * prints standing up with no support.
 */
export function mountProfile(m: MountDims, embed: number): { points: { h: number; b: number }[]; height: number } {
  const { tabThickness: t, lipThickness: lt, gap, lipDrop } = m
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

/** Side profile → canvas path standing up (rotation y 90°): canvas x
 * becomes height, canvas y stays depth; the extrusion becomes the width,
 * centred on the profile's x centre. */
export function standingPath(points: { h: number; b: number }[], centerX: number, height: number, faceY: number): Point2[] {
  return points.map((p) => ({ x: centerX - height / 2 + p.h, y: faceY - p.b }))
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
  // (b, h): b backward from the sheet face (negative = in front), h up;
  // lying flat on the canvas x is the depth axis (front to the left) and
  // y is height (top of the hook toward the top of the canvas).
  const toCanvas = (p: { b: number; h: number }): Point2 => ({ x: p.b + offset, y: top - p.h })
  const tab: { b: number; h: number }[] = [
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
    return { width: offset + back, height: top, parts: [{ name: 'Hook', color, outline: { kind: 'path', points: body.map(toCanvas) }, depth: width }] }
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
    { name: 'Tab', color, outline: { kind: 'path', points: tabPiece.map(toCanvas) }, depth: peg, z: (width - peg) / 2 },
  ]
  return { width: offset + back, height: top, parts, fuse: true }
}
