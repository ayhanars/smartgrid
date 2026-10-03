# World map infographics

One responsive world map, any dataset. Drop in a theme (a title, a unit, a hue and
a table of country codes to values) and the map paints itself, builds the legend,
the ranked list and the tooltips, and works from a phone to a wide screen.

Two themes ship as examples: **ice cream consumption per person** (a choropleth)
and **the world's top cheese producers** (a ranked top-10). Their figures are
approximate industry/FAO-style numbers for illustration; replace `data` before
publishing.

Two pages use the same themes:

- `index.html`: the world map (choropleth or ranked), legend, table, zoom.
- `bubbles.html`: **World in Bubbles**, a full-screen glass into which the
  countries of a theme drop as soft, iridescent bubbles sized by their value.
  Drag, throw, tap for details, double-tap to pop; "Drop again" lifts them back
  up; on a phone, tilt can steer gravity. Physics by Matter.js.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
npm run build:single       # dist/index.standalone.html, one self-contained file
npm run build:single:bubbles # dist/bubbles.standalone.html
```

The map page has no runtime dependencies: plain HTML, CSS and ES modules
(about 55 kB gzipped, geometry included). The bubbles page adds Matter.js (about
30 kB gzipped more) and loads two Google Fonts. Deploy `dist/` to any static host.
For a sub-path such as GitHub Pages set `VITE_BASE=/your-path/ npm run build`.

## Add an infographic

1. Create `src/themes/<name>.ts`:

```ts
import type { NumericTheme } from '../lib/types'

export const coffee: NumericTheme = {
  id: 'coffee',                       // used in the URL: /#coffee
  title: 'Who drinks the most coffee?',
  subtitle: 'Cups per person per day.',
  unit: 'kg per person per year',
  hue: 'amber',                       // blue | teal | green | lime | amber | orange | red | magenta | violet, or an OKLCH hue angle
  mode: 'choropleth',                 // or 'ranked'
  classes: 5,                         // choropleth bins (or give explicit `breaks: [2, 4, 6, 8]`)
  scale: 'quantile',                  // or 'linear'
  top: 10,                            // ranked mode: how many to number
  format: { decimals: 1 },            // prefix / suffix / compact / locale also available
  source: { label: 'ICO', url: 'https://…', note: '2023 crop year' },
  data: { FI: 12.0, NO: 9.9, IS: 9.0, DK: 8.7, NL: 8.4 /* ISO 3166-1 alpha-2 → value */ },
  notes: { FI: 'Two coffee breaks a day are written into many union contracts.' },
}
```

2. Register it in `src/themes/index.ts`. The theme switcher and the `#coffee`
   deep link pick it up.

Categorical themes (membership rather than a number, "drives on the left") use
`mode: 'categorical'` with `categories: { left: 'Drives on the left', right: 'Drives on the right' }`
and `data: { GB: 'left', FR: 'right' }`. Keep to three or four categories: beyond
that, colours stop being distinguishable on a map.

## Use the component in another page

```ts
import { WorldMap } from './src/lib'          // brings its CSS with it
const map = new WorldMap(document.querySelector('#map')!, { theme: coffee })
map.setTheme(cheese)   // repaint for the next infographic
map.select('FR')       // pin a country's tooltip
map.focus('NL')        // zoom in on one
map.resetZoom()
map.destroy()
```

Options: `hideHeader` (the page writes its own title), `hideList` (no table),
`names` (country names in another language), `onSelect(country | null)`.

## What the map does for you

- **Responsive.** SVG with a viewBox; it fills its container. Under 640 px the
  tooltip and zoom controls move under the map instead of covering it.
- **Touch.** Tap to pin a country, pinch to zoom once zoomed in (vertical page
  scroll keeps working at zoom 1), drag to pan, double-tap to zoom, buttons too.
  Rank badges and micro-state dots keep one on-screen size at any zoom.
- **Colour.** Sequential ramps are generated in OKLCH from the theme's hue, so
  steps are evenly spaced in perceived lightness. Dark mode gets its own ramp
  (low values recede toward the dark surface) rather than an inverted copy.
- **Light and dark.** Follows `prefers-color-scheme` and a host page's
  `data-theme="light|dark"` on `<html>`. Every colour is a CSS custom property
  on `.wm` (`--wm-fg`, `--wm-surface`, `--wm-land`, …) for rebranding.
- **Accessible.** Each country is focusable with an `aria-label` carrying its
  value and rank; the ranked list is a real table and shows every value without
  hovering; focus rings, reduced-motion and forced-colours are handled.
- **Micro states.** Countries too small to see (Singapore, Malta…) get a dot in
  their colour so they are never silently dropped.

## World in Bubbles

`src/bubbles/bubbleScene.ts` is a `BubbleScene(container, { theme, count?, inset?, fonts?, onSelect?, onLand? })`
class on a `<canvas>`. Rigid circles do the physics (Matter.js, with a generous
`slop` so bubbles overlap a little), and the rendering makes them soft: each rim
is flattened along the chord where it presses on a neighbour or the floor, gets a
mode-2 squash on impact and a stretch along its motion while dragged, and
breathes slightly at rest. The film is a radial gradient that gathers colour at
the rim, the rim is a slowly turning conic sweep of neighbouring hues
(iridescence), with a soft highlight, a crisp specular arc and a dim lower
reflection; a coloured caustic pools under each bubble near the floor and a
ripple rings where one lands. Bubble area follows value with a floor; the leader
is the brightest and the tail drifts around the theme hue. Double-tap pops a
bubble into droplets and it re-forms above the glass. `enableTilt()` requests
device orientation (iOS asks for permission) and steers gravity.

## Geometry

`src/lib/geo/countries.json` holds 174 countries as SVG paths (Natural Earth
1:110m via `world-atlas`, Equal Earth projection, Antarctica dropped, ids as ISO
alpha-2). Regenerate with `npm run geo` (edit `scripts/build-geo.mjs` to change
the projection, resolution or rotation).

## Layout

```
index.html            demo page shell
src/main.ts           demo page: theme switcher, deep links
src/styles.css        demo page styles (the component has its own)
src/lib/worldmap.ts   the WorldMap component
src/lib/worldmap.css  component styles and theme tokens
src/lib/color.ts      OKLCH ramps, categorical palette
src/lib/format.ts     number formatting, class breaks
src/lib/types.ts      theme schema
src/themes/*.ts       one file per infographic
bubbles.html, src/bubbles.ts, src/bubbles.css   the World in Bubbles page
src/bubbles/bubbleScene.ts  soft-bubble physics scene (Matter.js)
scripts/build-geo.mjs regenerates the geometry
scripts/inline.mjs    single-file build
```
