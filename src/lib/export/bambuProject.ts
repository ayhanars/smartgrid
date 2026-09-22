import type { PrintSettings, SeamPlacement } from '../../types/document'

/**
 * What makes Bambu Studio open a 3MF as one of its own projects — plates,
 * print settings and filaments included — instead of "geometry only":
 * the generator tag it looks for, and a project config naming its
 * presets. (A file without them is treated as third-party and every
 * object lands on the current plate.)
 */
export const BAMBU_GENERATOR = 'BambuStudio-01.10.02.76'
export const BAMBU_VERSION = '01.10.02.76'

interface BambuPrinter {
  model: string
  preset: string
  /** Suffix of the print / filament preset names for this printer family. */
  family: string
}

const PRINTERS: Record<string, BambuPrinter> = {
  a1: { model: 'Bambu Lab A1', preset: 'Bambu Lab A1 0.4 nozzle', family: '@BBL A1' },
  'a1-mini': { model: 'Bambu Lab A1 mini', preset: 'Bambu Lab A1 mini 0.4 nozzle', family: '@BBL A1M' },
  p1p: { model: 'Bambu Lab P1P', preset: 'Bambu Lab P1P 0.4 nozzle', family: '@BBL P1P' },
  p1s: { model: 'Bambu Lab P1S', preset: 'Bambu Lab P1S 0.4 nozzle', family: '@BBL P1P' },
  x1: { model: 'Bambu Lab X1', preset: 'Bambu Lab X1 0.4 nozzle', family: '@BBL X1C' },
  x1c: { model: 'Bambu Lab X1 Carbon', preset: 'Bambu Lab X1 Carbon 0.4 nozzle', family: '@BBL X1C' },
  x1e: { model: 'Bambu Lab X1E', preset: 'Bambu Lab X1E 0.4 nozzle', family: '@BBL X1C' },
  x2d: { model: 'Bambu Lab X2D', preset: 'Bambu Lab X2D 0.4 nozzle', family: '@BBL X2D' },
  h2d: { model: 'Bambu Lab H2D', preset: 'Bambu Lab H2D 0.4 nozzle', family: '@BBL H2D' },
  h2s: { model: 'Bambu Lab H2S', preset: 'Bambu Lab H2S 0.4 nozzle', family: '@BBL H2S' },
}

const QUALITY: Record<string, string> = {
  '0.08': '0.08mm High Quality',
  '0.12': '0.12mm Fine',
  '0.16': '0.16mm Optimal',
  '0.20': '0.20mm Standard',
  '0.24': '0.24mm Draft',
  '0.28': '0.28mm Extra Draft',
}

const INFILL: Record<string, string> = {
  grid: 'grid',
  gyroid: 'gyroid',
  honeycomb: 'honeycomb',
  lines: 'line',
  triangles: 'triangles',
  cubic: 'cubic',
}

export const isBambuPrinter = (bedPresetId: string) => bedPresetId in PRINTERS

/** The Metadata/project_settings.config contents for this printer, print
 * settings and filament colours (one filament per colour). */
const SEAM_POSITION: Record<SeamPlacement, string> = { random: 'random', corner: 'aligned', back: 'back' }

export function bambuProjectConfig(bedPresetId: string, settings: Partial<PrintSettings>, colors: string[]): Record<string, unknown> {
  const printer = PRINTERS[bedPresetId] ?? PRINTERS.a1
  const layer = settings.layerHeight ?? 0.2
  const quality = QUALITY[layer.toFixed(2)] ?? '0.20mm Standard'
  const filaments = colors.length > 0 ? colors : ['#4D8DFF']
  // Bambu Studio builds a project's presets from its own defaults plus
  // this file, unless the file says which keys differ from the named
  // system presets: then everything else (speeds, filament density…)
  // comes from those presets. Without it a plain box shows 0 g of
  // filament and a nine-hour estimate.
  const printKeys = ['layer_height', 'initial_layer_print_height', 'wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'sparse_infill_density', 'sparse_infill_pattern', 'seam_position', 'seam_slope_type', 'seam_slope_conditional']
  return {
    version: BAMBU_VERSION,
    from: 'project',
    printer_model: printer.model,
    printer_variant: '0.4',
    printer_settings_id: printer.preset,
    nozzle_diameter: ['0.4'],
    print_settings_id: `${quality} ${printer.family}`,
    filament_settings_id: filaments.map(() => `Bambu PLA Basic ${printer.family}`),
    filament_colour: filaments,
    filament_type: filaments.map(() => 'PLA'),
    layer_height: String(layer),
    initial_layer_print_height: String(layer),
    wall_loops: String(settings.wallLoops ?? 2),
    top_shell_layers: String(settings.topLayers ?? 5),
    bottom_shell_layers: String(settings.bottomLayers ?? 3),
    sparse_infill_density: `${settings.infillDensity ?? 15}%`,
    sparse_infill_pattern: INFILL[settings.infillPattern ?? 'grid'] ?? 'grid',
    // Seams: in the back corner unless the project says otherwise. With
    // `corner`, every body paints its back corner as a seam enforcer and
    // the aligned seam sits in that sharp corner on every layer. No
    // scarf joint: a scarf ramps the seam over ~10 mm, and on a corner
    // that ramp wraps onto the neighbouring face, which is exactly the
    // dashed line it was meant to hide.
    seam_position: SEAM_POSITION[settings.seam ?? 'corner'],
    seam_slope_type: 'none',
    seam_slope_conditional: '1',
    different_settings_to_system: [printKeys.join(';'), ...filaments.map(() => 'filament_colour'), ''],
  }
}
