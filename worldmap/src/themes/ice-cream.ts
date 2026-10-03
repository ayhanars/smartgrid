import type { NumericTheme } from '../lib/types'

/**
 * Ice cream consumption per person. Figures are the commonly cited industry
 * estimates (Euromonitor / national dairy boards, ~2022) and are approximate:
 * replace `data` with your own dataset for publication.
 */
export const iceCream: NumericTheme = {
  id: 'ice-cream',
  title: 'Who eats the most ice cream?',
  label: 'Ice cream',
  subtitle: 'Yearly ice cream consumption per person. New Zealand and the United States lead by a wide margin; most of Asia and Africa eats under a litre.',
  unit: 'litres per person per year',
  hue: 'blue',
  mode: 'choropleth',
  classes: 5,
  scale: 'quantile',
  top: 10,
  format: { decimals: 1 },
  decor: { pattern: 'waves', motif: 'icecream' },
  source: {
    label: 'Industry estimates (Euromonitor, national dairy associations)',
    note: 'approximate figures, c. 2022',
  },
  data: {
    NZ: 28.4, US: 20.8, AU: 18.0, FI: 14.2, SE: 12.0, CA: 10.6, NO: 9.8, DK: 9.6,
    IE: 9.0, IT: 8.2, CL: 7.6, UK: 7.0, GB: 7.0, DE: 7.9, BE: 7.4, FR: 6.1, AR: 6.8,
    NL: 6.0, CH: 5.9, AT: 5.5, ES: 5.2, PT: 4.6, PL: 4.4, CZ: 4.3, EE: 6.8, LT: 5.7,
    LV: 5.0, GR: 4.1, HU: 4.0, RU: 4.5, UA: 3.2, TR: 2.8, IL: 5.6, JP: 4.1, KR: 3.3,
    CN: 2.3, BR: 3.5, MX: 2.1, CO: 2.0, PE: 1.6, ZA: 1.9, SA: 2.4, AE: 3.1, EG: 0.9,
    MA: 0.7, NG: 0.3, KE: 0.4, IN: 0.4, ID: 0.3, PH: 0.9, VN: 0.6, TH: 1.3, MY: 1.4,
    PK: 0.3, BD: 0.2, IR: 1.2, KZ: 2.2, UY: 5.8, RO: 2.6, BG: 2.9, HR: 3.4, SK: 3.8,
    SI: 4.2, RS: 2.4, IS: 8.6,
  },
  notes: {
    NZ: 'Hokey pokey (vanilla with honeycomb toffee) is the national flavour.',
    US: 'July is National Ice Cream Month; vanilla is still the best seller.',
    FI: 'The Nordic countries eat most of their ice cream in winter at home.',
    IT: 'Gelato has less air and fat than ice cream, so it is denser per scoop.',
    IN: 'Kulfi, the traditional frozen dessert, is not counted as ice cream here.',
  },
}
