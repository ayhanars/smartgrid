export interface BedPreset {
  id: string
  label: string
  width: number
  height: number
}

export const bedPresets: BedPreset[] = [
  { id: 'a1', label: 'Bambu Lab A1', width: 256, height: 256 },
  { id: 'a1-mini', label: 'Bambu Lab A1 Mini', width: 180, height: 180 },
  { id: 'p1p', label: 'Bambu Lab P1P', width: 256, height: 256 },
  { id: 'p1s', label: 'Bambu Lab P1S', width: 256, height: 256 },
  { id: 'x1', label: 'Bambu Lab X1', width: 256, height: 256 },
  { id: 'x1c', label: 'Bambu Lab X1 Carbon', width: 256, height: 256 },
  { id: 'x1e', label: 'Bambu Lab X1E', width: 256, height: 256 },
  { id: 'x2d', label: 'Bambu Lab X2D', width: 256, height: 256 },
  { id: 'h2d', label: 'Bambu Lab H2D', width: 350, height: 320 },
  { id: 'h2s', label: 'Bambu Lab H2S', width: 350, height: 320 },
]

export const DEFAULT_BED_ID = 'a1'
export const CUSTOM_BED_ID = 'custom'

export function getBedPreset(id: string): BedPreset | null {
  return bedPresets.find((p) => p.id === id) ?? null
}
