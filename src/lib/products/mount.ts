import type { Point2 } from '../../types/document'
import type { PartRecipe, ProductBuild } from './types'

/** A tab-through-a-slot mount, in mm: the tab goes through the slot and
 * a lip drops behind the sheet. Shared by every pegboard / rail family. */
export interface MountDims {
  /** Vertical thickness of the tab (and of the part behind the sheet). */
  tabThickness: number
  /** Thickness of the lip behind the sheet, front to back. */
  lipThickness: number
  /** Room for the sheet between the part's face and the lip. */
  gap: number
  /** How far the lip drops behind the sheet. */
  lipDrop: number
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
 * tip. `width` is the extrusion (along the sheet).
 */
export function jHook(o: { mount: MountDims; reach: number; width: number; arm: number; tip: number; plateH: number; color: string }): ProductBuild {
  const { reach, width, arm, tip, plateH, color } = o
  const { tabThickness: t, lipThickness: lt, gap, lipDrop } = o.mount
  const plateT = 4
  const top = plateH + t
  const back = gap + lt
  // (b, h): b backward from the sheet face (negative = in front), h up.
  const profile: { b: number; h: number }[] = [
    { b: 0, h: top },
    { b: back, h: top },
    { b: back, h: top - t - lipDrop },
    { b: gap, h: top - t - lipDrop + lt },
    { b: gap, h: top - t },
    { b: 0, h: top - t },
    { b: 0, h: 0 },
    { b: -(plateT + reach), h: 0 },
    { b: -(plateT + reach), h: arm + tip },
    { b: -(plateT + reach) + Math.min(arm, reach), h: arm + tip },
    { b: -(plateT + reach) + Math.min(arm, reach), h: arm },
    { b: -plateT, h: arm },
    { b: -plateT, h: top },
  ]
  // Lying flat on the canvas: x is the depth axis (front to the left),
  // y is height (top of the hook toward the top of the canvas).
  const offset = plateT + reach
  const points: Point2[] = profile.map((p) => ({ x: p.b + offset, y: top - p.h }))
  const part: PartRecipe = { name: 'Hook', color, outline: { kind: 'path', points }, depth: width }
  return { width: offset + back, height: top, parts: [part] }
}
