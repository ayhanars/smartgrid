import './bubbles.css'
import { BubbleScene, type Bubble, type Skin } from './bubbles/bubbleScene'
import { Sounds, haptic } from './bubbles/sound'
import { hueAngle, oklchToHex } from './lib/color'
import type { NumericTheme } from './lib/types'
import { themes } from './themes'

const numericThemes = themes.filter((t): t is NumericTheme => t.mode !== 'categorical')
const sounds = new Sounds()
try {
  sounds.muted = localStorage.getItem('bubbles:muted') === '1'
} catch {
  /* storage unavailable */
}

const app = document.getElementById('app')!
const scene = document.createElement('div')
scene.className = 'scene'
app.append(scene)

// chrome
const mast = document.createElement('header')
mast.className = 'mast'
const eyebrow = document.createElement('div')
eyebrow.className = 'eyebrow'
const dot = document.createElement('i')
dot.className = 'dot'
const idx = document.createElement('span')
idx.className = 'idx'
const eyebrowText = document.createElement('span')
eyebrow.append(dot, idx, eyebrowText)
const headline = document.createElement('h1')
headline.className = 'headline'
const unit = document.createElement('p')
unit.className = 'unit'
mast.append(eyebrow, headline, unit)

const hint = document.createElement('p')
hint.className = 'hint'
hint.textContent = 'Pick a bubble up and let it go. Throw it. Tap twice to pop it.'
mast.append(hint)

const card = document.createElement('aside')
card.className = 'glass card'
card.hidden = true

const dock = document.createElement('nav')
dock.className = 'dock'
dock.setAttribute('aria-label', 'Themes and actions')
const flavours = document.createElement('div')
flavours.className = 'glass flavours'
const actions = document.createElement('div')
actions.className = 'actions'
dock.append(flavours, actions)

// safe areas for the glass box
const probe = document.createElement('div')
probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px);padding-top:env(safe-area-inset-top,0px)'
document.body.append(probe)
const safeBottom = parseFloat(getComputedStyle(probe).paddingBottom) || 0
const safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
probe.remove()

// the hash is "<theme>~<skin>"; the skin is also remembered per browser
const parseHash = () => {
  const [themeId, skinId] = location.hash.slice(1).split('~')
  return { themeId, skin: skinId === 'note' || skinId === 'glass' ? (skinId as Skin) : undefined }
}
let skin: Skin = parseHash().skin ?? 'glass'
if (!parseHash().skin) {
  try {
    const saved = localStorage.getItem('bubbles:skin')
    if (saved === 'note' || saved === 'glass') skin = saved
  } catch {
    /* storage unavailable: keep the default */
  }
}
scene.dataset.skin = skin
const initial = numericThemes.find((x) => x.id === parseHash().themeId) ?? numericThemes[0]
const buttons = new Map<string, HTMLButtonElement>()
numericThemes.forEach((t) => {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'flavour'
  b.id = `theme-${t.id}`
  b.style.setProperty('--c', oklchToHex(0.78, 0.16, hueAngle(t.hue)))
  const sw = document.createElement('i')
  sw.className = 'swatch'
  b.append(sw, document.createTextNode(shortTitle(t)))
  b.title = t.title
  b.addEventListener('click', () => show(t.id, true))
  flavours.append(b)
  buttons.set(t.id, b)
})

const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
const dropBtn = iconButton('drop-again', 'Drop them again', icon('M12 4v13M6 11l6 6 6-6M5 21h14'))
dropBtn.addEventListener('click', () => {
  bubbles.drop()
  haptic(8)
  hint.classList.remove('is-hidden')
})
const tiltBtn = iconButton('tilt', 'Steer gravity by tilting the phone', icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2'))
tiltBtn.hidden = !('DeviceOrientationEvent' in window) || !matchMedia('(pointer: coarse)').matches
let tilt = false
tiltBtn.addEventListener('click', async () => {
  if (tilt) {
    bubbles.disableTilt()
    tilt = false
  } else {
    tilt = await bubbles.enableTilt()
    if (!tilt) tiltBtn.hidden = true
  }
  tiltBtn.setAttribute('aria-pressed', String(tilt))
})
// browsers allow audio only after a gesture: the first touch anywhere unlocks it
addEventListener('pointerdown', () => sounds.unlock(), { capture: true })
const soundBtn = iconButton('sound', 'Sound on or off', icon('M4 10v4h4l5 4V6l-5 4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11'))
const soundOff = icon('M4 10v4h4l5 4V6l-5 4H4zM16 9l5 6M21 9l-5 6')
const soundOn = soundBtn.innerHTML
const paintSound = () => {
  soundBtn.innerHTML = sounds.muted ? soundOff : soundOn
  soundBtn.setAttribute('aria-pressed', String(!sounds.muted))
}
paintSound()
soundBtn.addEventListener('click', () => {
  sounds.muted = !sounds.muted
  if (!sounds.muted) {
    sounds.unlock()
    sounds.grab()
  }
  try {
    localStorage.setItem('bubbles:muted', sounds.muted ? '1' : '0')
  } catch {
    /* ignore */
  }
  paintSound()
})
const skinBtn = iconButton('skin', 'Switch between glass and banknote', icon('M3 7h18v10H3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9v.01M18 15v.01'))
skinBtn.setAttribute('aria-pressed', String(skin === 'note'))
skinBtn.addEventListener('click', () => setSkin(skin === 'note' ? 'glass' : 'note'))
function setSkin(next: Skin) {
  skin = next
  scene.dataset.skin = skin
  bubbles.setSkin(skin)
  skinBtn.setAttribute('aria-pressed', String(skin === 'note'))
  try {
    localStorage.setItem('bubbles:skin', skin)
  } catch {
    /* ignore */
  }
  updateHash()
}
function updateHash() {
  const t = bubbles.getTheme()
  const h = `#${t.id}~${skin}`
  if (location.hash !== h) history.replaceState(null, '', h)
  mapLink.href = `index.html#${t.id}`
}
const mapLink = document.createElement('a')
mapLink.className = 'glass iconbtn map-link'
mapLink.title = 'Back to the world map'
mapLink.setAttribute('aria-label', 'Back to the world map')
mapLink.innerHTML = icon('M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18')
actions.append(skinBtn, soundBtn, dropBtn, tiltBtn, mapLink)

// the glass starts under the masthead, so the pile never climbs into the headline
scene.append(mast, dock)
headline.textContent = initial.title
const mastH = mast.offsetHeight
const dockH = dock.offsetHeight
const bubbles = new BubbleScene(scene, {
  theme: initial,
  skin,
  count: 18,
  inset: { top: safeTop + mastH + 24, bottom: safeBottom + dockH + 22, left: 0, right: 0 },
  fonts: {
    value: "'Unbounded', system-ui, sans-serif",
    name: "'Instrument Serif', Georgia, serif",
    noteValue: "'Libre Bodoni', 'Bodoni 72', Didot, Georgia, serif",
    micro: "'Archivo Narrow', 'Arial Narrow', system-ui, sans-serif",
  },
  onSelect: showCard,
  onLand: (b, speed) => {
    sounds.land(b.R, speed)
    if (speed > 3) haptic(6)
  },
  onGrab: () => {
    sounds.grab()
    haptic(4)
  },
  onPop: (b) => {
    sounds.pop(b.R)
    haptic([12, 40, 18])
  },
  onDrop: () => sounds.whoosh(),
})
const grain = document.createElement('div')
grain.className = 'grain'
const vignette = document.createElement('div')
vignette.className = 'vignette'
scene.append(vignette, grain, card)
scene.append(mast, dock) // back on top of the canvas and overlays

// fonts: the canvas draws every frame, so labels sharpen as soon as they land
document.fonts?.load("700 20px 'Unbounded'")
document.fonts?.load("italic 400 20px 'Instrument Serif'")
document.fonts?.load("700 20px 'Libre Bodoni'")
document.fonts?.load("600 10px 'Archivo Narrow'")
document.fonts?.ready.then(() => bubbles.setSkin(bubbles.getSkin())) // redraw the engraved plates with the real fonts


function iconButton(id: string, label: string, svg: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.id = id
  b.className = 'glass iconbtn'
  b.title = label
  b.setAttribute('aria-label', label)
  b.innerHTML = svg
  return b
}

function shortTitle(t: NumericTheme): string {
  if (t.label) return t.label
  const m = t.title.match(/ice cream|cheese|travel|coffee|chocolate|wine|beer|tea/i)
  return m ? m[0][0].toUpperCase() + m[0].slice(1).toLowerCase() : t.title
}

function show(id: string, push: boolean) {
  const t = numericThemes.find((x) => x.id === id)
  if (!t) return
  if (bubbles.getTheme() !== t) bubbles.setTheme(t)
  const i = numericThemes.indexOf(t)
  idx.textContent = String(i + 1).padStart(2, '0')
  eyebrowText.textContent = shortTitle(t)
  headline.textContent = t.title
  unit.replaceChildren()
  const b = document.createElement('b')
  b.textContent = 'Bigger bubble, bigger number.'
  unit.append(b, ` ${t.unit[0].toUpperCase()}${t.unit.slice(1)}.`)
  document.documentElement.style.setProperty('--accent', oklchToHex(0.8, 0.14, hueAngle(t.hue)))
  for (const [tid, btn] of buttons) btn.setAttribute('aria-pressed', String(tid === id))
  document.title = `${t.title} · World in Bubbles`
  hint.classList.remove('is-hidden')
  if (push) updateHash()
  else mapLink.href = `index.html#${id}`
}

function showCard(b: Bubble | null) {
  card.replaceChildren()
  card.hidden = !b
  if (!b) return
  hint.classList.add('is-hidden')
  const t = bubbles.getTheme()
  card.style.setProperty('--c', b.light)
  const rank = document.createElement('div')
  rank.className = 'rank'
  rank.textContent = `No. ${b.rank} · ${shortTitle(t)}`
  const name = document.createElement('h2')
  name.className = 'name'
  name.textContent = b.country.name
  const value = document.createElement('div')
  value.className = 'value'
  value.textContent = b.display
  const small = document.createElement('small')
  small.textContent = t.unit
  value.append(small)
  card.append(rank, name, value)
  if (b.rank > 1) {
    const share = document.createElement('div')
    share.className = 'share'
    const label = document.createElement('span')
    label.textContent = `${Math.round(b.share * 100)}% of the leader`
    const track = document.createElement('div')
    track.className = 'track'
    const fill = document.createElement('div')
    fill.className = 'fill'
    fill.style.width = `${Math.max(2, b.share * 100)}%`
    track.append(fill)
    share.append(label, track)
    card.append(share)
  }
  const note = t.notes?.[b.country.id]
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
  close.addEventListener('click', () => bubbles.select(null))
  card.append(close)
}

// a handle for tooling (offline sound renders, tests); not part of the page's UI
;(window as unknown as { __bubbles?: unknown }).__bubbles = { scene: bubbles, sounds }

show(initial.id, false)
addEventListener('hashchange', () => {
  const h = parseHash()
  show(h.themeId, false)
  if (h.skin && h.skin !== skin) setSkin(h.skin)
})
