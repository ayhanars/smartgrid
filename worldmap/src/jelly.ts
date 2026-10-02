import './jelly.css'
import { JellyScene, type Jelly } from './jelly/jellyScene'
import type { NumericTheme } from './lib/types'
import { themes } from './themes'

const numericThemes = themes.filter((t): t is NumericTheme => t.mode !== 'categorical')

const app = document.getElementById('app')!
const scene = document.createElement('div')
scene.className = 'scene'
app.append(scene)

const title = document.createElement('div')
title.className = 'chip title'
const h1 = document.createElement('h1')
const sub = document.createElement('p')
title.append(h1, sub)

const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Bigger jelly, bigger number. Drag one, throw it, tap it.'
title.append(hint)

// room for the chrome: the glass panel starts under the title and ends above the bar
const probe = document.createElement('div')
probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px);padding-top:env(safe-area-inset-top,0px)'
document.body.append(probe)
const safeBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0
const safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
probe.remove()

const card = document.createElement('div')
card.className = 'chip card'
card.hidden = true

const bar = document.createElement('nav')
bar.className = 'chip bar'
bar.setAttribute('aria-label', 'Theme and actions')

const initial = numericThemes.find((x) => x.id === location.hash.slice(1)) ?? numericThemes[0]
const jelly = new JellyScene(scene, { theme: initial, onSelect: showCard, inset: { top: safeTop + 8, bottom: safeBottom + 78, left: 8, right: 8 } })
scene.append(title, card, bar)
const placeCard = () => card.style.setProperty('--title-h', `${title.offsetHeight}px`)
placeCard()
addEventListener('resize', placeCard)

const buttons = new Map<string, HTMLButtonElement>()
for (const t of numericThemes) {
  const b = document.createElement('button')
  b.type = 'button'
  b.id = `theme-${t.id}`
  b.textContent = shortTitle(t)
  b.title = t.title
  b.addEventListener('click', () => show(t.id, true))
  bar.append(b)
  buttons.set(t.id, b)
}
const sep = document.createElement('i')
sep.className = 'sep'
const mapLink = document.createElement('a')
mapLink.className = 'map-link'
mapLink.textContent = 'Map'
mapLink.title = 'Back to the world map'
const drop = document.createElement('button')
drop.type = 'button'
drop.id = 'drop-again'
drop.className = 'drop'
drop.textContent = 'Drop again'
drop.addEventListener('click', () => jelly.drop())
bar.append(sep, drop, mapLink)

function shortTitle(t: NumericTheme): string {
  // "The world's top cheese producers" -> "Cheese"; "Who eats the most ice cream?" -> "Ice cream"
  const m = t.title.match(/ice cream|cheese|coffee|chocolate|wine|beer|tea/i)
  return m ? m[0][0].toUpperCase() + m[0].slice(1).toLowerCase() : t.title
}

function show(id: string, push: boolean) {
  const t = numericThemes.find((x) => x.id === id)
  if (!t) return
  if (jelly.getTheme() !== t) jelly.setTheme(t)
  h1.textContent = t.title
  sub.textContent = t.unit[0].toUpperCase() + t.unit.slice(1) + ' · top ' + Math.min(t.top ?? 12, Object.keys(t.data).length)
  for (const [tid, b] of buttons) b.setAttribute('aria-pressed', String(tid === id))
  document.title = `${t.title} · Jelly Countries`
  mapLink.href = `index.html#${id}`
  hint.hidden = false
  placeCard()
  if (push && location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`)
}

function showCard(j: Jelly | null) {
  card.replaceChildren()
  card.hidden = !j
  if (!j) return
  hint.hidden = true
  const t = jelly.getTheme()
  const head = document.createElement('div')
  head.className = 'head'
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = j.country.name
  const rank = document.createElement('span')
  rank.className = 'rank'
  rank.textContent = `#${j.rank}`
  head.append(name, rank)
  const value = document.createElement('div')
  value.className = 'value'
  const sw = document.createElement('i')
  sw.className = 'swatch'
  sw.style.background = j.color
  const b = document.createElement('b')
  b.textContent = j.display
  const unit = document.createElement('span')
  unit.textContent = t.unit
  value.append(sw, b, unit)
  card.append(head, value)
  const note = t.notes?.[j.country.id]
  if (note) {
    const p = document.createElement('p')
    p.className = 'note'
    p.textContent = note
    card.append(p)
  }
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.textContent = '×'
  close.setAttribute('aria-label', 'Close')
  close.addEventListener('click', () => jelly.select(null))
  card.append(close)
}

show(initial.id, false)
addEventListener('hashchange', () => show(location.hash.slice(1), false))
