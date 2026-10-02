/** ISO 3166-1 alpha-2 code, upper case ("FR", "US"). */
export type CountryCode = string

export type HueName =
  | 'blue' | 'teal' | 'green' | 'lime' | 'amber' | 'orange' | 'red' | 'magenta' | 'violet'

export interface FormatSpec {
  /** Decimal places (default: 1 for values under 100, else 0). */
  decimals?: number
  /** Text before the number ("$"). */
  prefix?: string
  /** Text after the number (" L"). The unit goes in `unit`, not here. */
  suffix?: string
  /** 1,234,567 -> 1.2M. Default true for values above 10,000. */
  compact?: boolean
  /** BCP 47 locale for Intl.NumberFormat (default: browser locale). */
  locale?: string
}

export interface ThemeSource {
  label: string
  url?: string
  /** A caveat shown under the source ("approximate figures, 2022"). */
  note?: string
}

/** A numeric theme paints every country by its value. */
export interface NumericTheme {
  id: string
  title: string
  subtitle?: string
  /** Unit written after values: "litres per person per year". */
  unit: string
  source?: ThemeSource
  /**
   * choropleth: every country with data is shaded by its value (sequential ramp).
   * ranked: the top N are shaded and numbered, everything else recedes.
   */
  mode?: 'choropleth' | 'ranked'
  /** Sequential hue: a name, or an OKLCH hue angle (0..360). */
  hue?: HueName | number
  /** Choropleth classes (default 5). */
  classes?: number
  /** Explicit class thresholds (ascending). Overrides `classes`/`scale`. */
  breaks?: number[]
  /** How classes are cut when `breaks` is not given (default "quantile"). */
  scale?: 'quantile' | 'linear'
  /** Ranked mode: how many to highlight (default 10). */
  top?: number
  /** Ranked list under the map: how many rows before "Show all" (default: `top`, or 10). */
  listRows?: number
  format?: FormatSpec
  /** Value per country, ISO alpha-2 keys. */
  data: Record<CountryCode, number>
  /** One extra line per country, shown in the tooltip. */
  notes?: Record<CountryCode, string>
}

/** A categorical theme paints countries by membership ("drives on the left"). */
export interface CategoricalTheme {
  id: string
  title: string
  subtitle?: string
  source?: ThemeSource
  mode: 'categorical'
  /** Category key -> legend label, in display order (max 6). */
  categories: Record<string, string>
  /** Category key per country. */
  data: Record<CountryCode, string>
  notes?: Record<CountryCode, string>
}

export type MapTheme = NumericTheme | CategoricalTheme

export interface Country {
  id: CountryCode
  name: string
  /** SVG path in the geo file's viewBox. */
  d: string
  /** Centroid [x, y]. */
  c: [number, number]
  /** Projected area, for micro-state markers. */
  a: number
}

export interface GeoData {
  width: number
  height: number
  projection: string
  countries: Country[]
}

export interface WorldMapOptions {
  theme: MapTheme
  /** Fires when a country is selected (tap/click) or deselected (null). */
  onSelect?: (country: Country | null) => void
  /** Hide the title block (when the host page writes its own). */
  hideHeader?: boolean
  /** Hide the ranked list / table under the map. */
  hideList?: boolean
  /** Country names in another language: code -> name. */
  names?: Record<CountryCode, string>
}
