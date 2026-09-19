import type { DocumentState } from '../../state/documentStore'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { contourBounds } from '../../lib/geometry/primitives'

const MAX_SHAPES = 60

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10)

/** A compact, plain-text description of the open document for the
 * assistant's system prompt: bed, print settings, and one line per shape. */
export function describeDocument(state: DocumentState): string {
  const bed = getBedPreset(state.bedPresetId)
  const bedW = bed?.width ?? state.customBedWidth
  const bedH = bed?.height ?? state.customBedHeight
  const p = state.printSettings
  const lines: string[] = [
    `Project: ${state.projectName}`,
    `Units shown to user: ${state.displayUnit} (values below are mm)`,
    `Print bed: ${bed?.label ?? 'custom'} ${bedW}×${bedH} mm`,
    `Print settings: layer ${p.layerHeight} mm, ${p.wallLoops} walls, ${p.topLayers} top / ${p.bottomLayers} bottom layers, ${p.infillDensity}% ${p.infillPattern} infill`,
    `Shapes (${state.order.length}):`,
  ]
  const ids = state.order.slice(0, MAX_SHAPES)
  for (const id of ids) {
    const layer = state.layers[id]
    if (!layer) continue
    const pts = layer.regions.flatMap((r) => [...r.outer.points, ...r.holes.flatMap((c) => c.points)])
    const b = contourBounds(pts)
    const holes = layer.regions.reduce((n, r) => n + r.holes.length, 0)
    const flags = [
      layer.isHole ? 'cutter/hole' : null,
      !layer.visible ? 'hidden' : null,
      layer.locked ? 'locked' : null,
      holes ? `${holes} inner hole${holes === 1 ? '' : 's'}` : null,
      layer.bevelTop ? `top bevel ${fmt(layer.bevelTop)}` : null,
      layer.bevelBottom ? `bottom bevel ${fmt(layer.bevelBottom)}` : null,
      layer.cornerRadius ? `corner radius ${fmt(layer.cornerRadius)}` : null,
      layer.texture ? `texture ${layer.texture.pattern}` : null,
      layer.perforation ? 'perforated' : null,
    ].filter(Boolean)
    lines.push(
      `- "${layer.name}" (${layer.kind}) ${fmt(b.width)}×${fmt(b.height)} mm, height ${fmt(layer.extrusionDepth)} mm, at x ${fmt(layer.transform.x)} y ${fmt(layer.transform.y)} z ${fmt(layer.transform.z)}${flags.length ? ` — ${flags.join(', ')}` : ''}`,
    )
  }
  if (state.order.length > MAX_SHAPES) lines.push(`… and ${state.order.length - MAX_SHAPES} more`)
  if (state.selection.length) {
    const names = state.selection.map((id) => state.layers[id]?.name).filter(Boolean)
    lines.push(`Selected: ${names.join(', ')}`)
  }
  return lines.join('\n')
}
