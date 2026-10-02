import './styles.css'
import { WorldMap } from './lib'
import { themeById, themes } from './themes'

const app = document.getElementById('app')!

const page = document.createElement('main')
page.className = 'page'

const topbar = document.createElement('header')
topbar.className = 'topbar'
const brand = document.createElement('div')
brand.className = 'brand'
const name = document.createElement('span')
name.className = 'brand-name'
name.textContent = 'World map infographics'
const tag = document.createElement('span')
tag.className = 'brand-tag'
tag.textContent = 'One map, any dataset. Tap a country, pinch or use the buttons to zoom.'
brand.append(name, tag)

const switcher = document.createElement('nav')
switcher.className = 'themes'
switcher.setAttribute('aria-label', 'Infographic theme')
const jellyLink = document.createElement('a')
jellyLink.className = 'theme-btn theme-link'
jellyLink.href = 'jelly.html'
jellyLink.textContent = 'Jelly view'
topbar.append(brand, switcher)

const card = document.createElement('section')
card.className = 'card'

const howto = document.createElement('p')
howto.className = 'howto'
howto.append('Add a theme: drop a file in ')
const code = document.createElement('code')
code.textContent = 'src/themes/'
howto.append(code, ' with a title, unit, hue and a table of ISO country codes to values. The map does the rest.')

page.append(topbar, card, howto)
app.append(page)

const initial = themeById(location.hash.slice(1)) ?? themes[0]
const map = new WorldMap(card, { theme: initial })

const buttons = new Map<string, HTMLButtonElement>()
for (const t of themes) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'theme-btn'
  b.textContent = t.title
  b.id = `theme-${t.id}`
  b.addEventListener('click', () => show(t.id, true))
  switcher.append(b)
  buttons.set(t.id, b)
}
switcher.append(jellyLink)

function show(id: string, push: boolean) {
  const t = themeById(id)
  if (!t) return
  map.setTheme(t)
  for (const [tid, b] of buttons) b.setAttribute('aria-pressed', String(tid === id))
  document.title = `${t.title} · World Map Infographics`
  if (push && location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`)
  jellyLink.href = `jelly.html#${id}`
}
show(initial.id, false)
addEventListener('hashchange', () => show(location.hash.slice(1), false))
