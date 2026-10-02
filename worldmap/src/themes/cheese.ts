import type { NumericTheme } from '../lib/types'

/**
 * Cheese production by country, thousand tonnes. FAOSTAT / Eurostat style
 * figures for 2022, rounded; approximate and for illustration until replaced
 * with the dataset you publish.
 */
export const cheese: NumericTheme = {
  id: 'cheese',
  title: 'The world’s top cheese producers',
  subtitle: 'Cheese produced per year, in thousand tonnes. The United States makes a quarter of the world’s cheese; Europe’s big five make another third.',
  unit: 'thousand tonnes per year',
  hue: 'amber',
  mode: 'ranked',
  top: 10,
  listRows: 10,
  format: { decimals: 0, compact: false },
  source: {
    label: 'FAOSTAT & Eurostat',
    url: 'https://www.fao.org/faostat/',
    note: 'rounded 2022 production, approximate',
  },
  data: {
    US: 6350, DE: 2334, FR: 1909, IT: 1359, NL: 974, PL: 926, RU: 1050, TR: 820,
    BR: 760, EG: 640, CA: 600, AR: 580, ES: 538, GB: 500, DK: 467, IR: 330,
    AU: 420, NZ: 380, BY: 410, MX: 480, IE: 290, AT: 230, CH: 210, GR: 220,
    BE: 120, SE: 130, FI: 90, NO: 100, CZ: 150, HU: 90, UA: 180, IL: 150,
    JP: 160, CN: 170, IN: 260, SA: 60, LT: 110, EE: 45, LV: 40, PT: 80,
    CL: 110, UY: 70, CO: 90, ZA: 120, KZ: 30, RO: 100, BG: 110, HR: 40,
    SK: 40, SI: 30, RS: 50, IS: 7,
  },
  notes: {
    US: 'Wisconsin and California together make about half of US cheese.',
    DE: 'Germany is also the EU’s largest cheese exporter by volume.',
    FR: 'Home to 46 cheeses with protected designation of origin (AOP).',
    IT: 'Grana Padano and Parmigiano Reggiano are the biggest PDO cheeses by volume.',
    NL: 'Gouda and Edam account for most Dutch output; two thirds is exported.',
    PL: 'Fastest-growing large producer in the EU over the last decade.',
    TR: 'Beyaz peynir, a brined white cheese, is the staple.',
    EG: 'Domiati, a soft brined cheese, makes up most Egyptian production.',
  },
}
