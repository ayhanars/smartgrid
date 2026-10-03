import type { NumericTheme } from '../lib/types'

/**
 * International tourist arrivals, millions per year. UN Tourism (UNWTO) style
 * figures for 2023, rounded and approximate; replace with the dataset you
 * publish.
 */
export const travel: NumericTheme = {
  id: 'travel',
  title: 'Where does the world travel?',
  label: 'Travel',
  subtitle: 'International tourist arrivals per year, in millions. France is the first country to pass a hundred million visitors.',
  unit: 'million visitors per year',
  hue: 'teal',
  mode: 'ranked',
  top: 10,
  listRows: 10,
  format: { decimals: 1, compact: false },
  decor: { pattern: 'rays', motif: 'travel' },
  source: {
    label: 'UN Tourism barometer',
    url: 'https://www.unwto.org/tourism-data/',
    note: 'rounded 2023 arrivals, approximate',
  },
  data: {
    FR: 100, ES: 85.2, US: 66.5, IT: 57.2, TR: 55.2, MX: 42.2, GB: 37.2, DE: 34.8,
    GR: 32.7, AT: 30.9, CN: 35.0, TH: 28.2, SA: 27.4, PT: 26.5, JP: 25.1, AE: 24.0,
    HR: 20.6, NL: 20.3, MY: 20.1, PL: 19.0, CA: 18.3, EG: 14.9, MA: 14.5, VN: 12.6,
    HU: 12.5, CH: 11.8, ID: 11.7, KR: 11.0, DK: 10.0, TN: 9.4, IN: 9.2, KZ: 9.0,
    ZA: 8.5, BE: 8.1, RU: 8.1, DO: 8.1, CZ: 7.5, AR: 7.4, AU: 7.1, SE: 7.0,
    IE: 6.5, BR: 5.9, NO: 5.5, CO: 4.3, CL: 3.8, NZ: 3.0, PE: 2.5,
  },
  notes: {
    FR: 'Paris alone takes about a third of the country’s visitors.',
    ES: 'The Balearic and Canary islands receive a third of all arrivals.',
    US: 'New York, Miami and Los Angeles are the first stops for most.',
    IT: 'Venice charges day visitors an entry fee on its busiest days.',
    TR: 'Antalya alone welcomes more than fifteen million a year.',
    MX: 'Cancún’s airport handles more international passengers than Mexico City’s.',
    JP: 'Arrivals doubled in two years as the yen weakened.',
    GR: 'Visitors outnumber residents three to one in a year.',
  },
}
