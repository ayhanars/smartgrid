// Regenerates src/lib/geo/countries.json from world-atlas (Natural Earth 1:110m) with an
// Equal Earth projection. Run: npm run geo. Antarctica is dropped; ids are ISO alpha-2.
import { readFileSync, writeFileSync } from 'node:fs'
import { feature } from 'topojson-client'
import { geoEqualEarth, geoPath } from 'd3-geo'
import countries from 'world-countries'

const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-110m.json', import.meta.url), 'utf8'))
const fc = feature(topo, topo.objects.countries)
const byNum = new Map(countries.map(c => [c.ccn3, c]))
const byName = new Map(countries.map(c => [c.name.common.toLowerCase(), c]))

const feats = fc.features.filter(f => f.id !== '010') // drop Antarctica
const W = 1000
const proj = geoEqualEarth().rotate([-10, 0]) // nudge so the Pacific split keeps Russia whole
proj.fitWidth(W, { type: 'FeatureCollection', features: feats })
const path = geoPath(proj).digits(1)
const [[x0, y0], [x1, y1]] = path.bounds({ type: 'FeatureCollection', features: feats })
const H = Math.ceil(y1 - y0)
const out = []
const missing = []
for (const f of feats) {
  let c = byNum.get(String(f.id).padStart(3, '0'))
  if (!c) c = byName.get((f.properties.name || '').toLowerCase())
  if (!c) { missing.push([f.id, f.properties.name]); continue }
  const d = path(f)
  if (!d) continue
  const [cx, cy] = path.centroid(f)
  out.push({ id: c.cca2, name: c.name.common, d, c: [+cx.toFixed(1), +(cy - y0).toFixed(1)], a: +path.area(f).toFixed(0) })
}
console.log('missing:', missing, 'count:', out.length, 'bounds', x0, y0, x1, y1)
// shift paths vertically so the viewBox starts at 0 (fitWidth already puts x at 0 and y at 0)
const data = { width: W, height: H, projection: 'equalEarth', countries: out.sort((a, b) => a.id.localeCompare(b.id)) }
const json = JSON.stringify(data)
writeFileSync(new URL('../src/lib/geo/countries.json', import.meta.url), json)
console.log('bytes', json.length, 'y0', y0)
