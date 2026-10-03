/**
 * Engraved motifs for the bubble scene's backdrop: the subject of each theme,
 * drawn with lines and hatching the way a banknote vignette would be. Every
 * motif is drawn in a unit square centred on the origin; call `drawMotif` with
 * the size in pixels and it scales the line weight to stay crisp.
 */
export type Motif = 'icecream' | 'cheese' | 'travel'

type G = CanvasRenderingContext2D
type Draw = (g: G) => void

const TAU = Math.PI * 2

/** Parallel hatching inside the current path, angle in radians, gap in units. */
function hatch(g: G, path: Draw, angle: number, gap: number, alpha = 0.55, lightFrom = 0) {
  g.save()
  path(g)
  g.clip()
  g.rotate(angle)
  g.globalAlpha *= alpha
  g.beginPath()
  for (let d = -1 + lightFrom; d <= 1; d += gap) {
    g.moveTo(-1, d)
    g.lineTo(1, d)
  }
  g.stroke()
  g.restore()
}

function circle(x: number, y: number, r: number): Draw {
  return (g) => {
    g.beginPath()
    g.arc(x, y, r, 0, TAU)
  }
}

function poly(pts: [number, number][]): Draw {
  return (g) => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
  }
}

// ---------- ice cream ----------

const cone: Draw = (g) => {
  const coneShape = poly([[-0.2, 0.06], [0.2, 0.06], [0, 0.5]])
  coneShape(g)
  g.stroke()
  // waffle lattice
  hatch(g, coneShape, 0.6, 0.07, 0.7)
  hatch(g, coneShape, -0.6, 0.07, 0.7)
  // scoops: the lower one first, the top one in front
  const low = circle(-0.1, -0.03, 0.17)
  const top = circle(0.06, -0.22, 0.19)
  low(g)
  g.stroke()
  hatch(g, low, 0.8, 0.04, 0.5, 0.3)
  g.save()
  top(g)
  g.fillStyle = 'rgba(255,255,255,0)'
  g.restore()
  top(g)
  g.stroke()
  hatch(g, top, 0.8, 0.04, 0.5, 0.35)
  // a cherry with a stem
  circle(0.1, -0.43, 0.045)(g)
  g.stroke()
  g.beginPath()
  g.moveTo(0.11, -0.47)
  g.quadraticCurveTo(0.16, -0.55, 0.2, -0.52)
  g.stroke()
}

const popsicle: Draw = (g) => {
  const body: Draw = (gg) => {
    gg.beginPath()
    gg.moveTo(-0.17, 0.18)
    gg.lineTo(-0.17, -0.3)
    gg.arc(0, -0.3, 0.17, Math.PI, 0)
    gg.lineTo(0.17, 0.18)
    gg.closePath()
  }
  body(g)
  g.stroke()
  hatch(g, body, 0.75, 0.045, 0.55, 0.25)
  // a bite from the corner
  g.beginPath()
  g.arc(0.17, -0.32, 0.07, Math.PI * 0.6, Math.PI * 1.5)
  g.stroke()
  // stick
  g.beginPath()
  g.moveTo(-0.045, 0.18)
  g.lineTo(-0.045, 0.48)
  g.arc(0, 0.48, 0.045, Math.PI, 0, true)
  g.lineTo(0.045, 0.18)
  g.stroke()
  // drips
  g.beginPath()
  g.moveTo(-0.08, 0.18)
  g.quadraticCurveTo(-0.08, 0.28, -0.1, 0.3)
  g.moveTo(0.1, 0.18)
  g.quadraticCurveTo(0.1, 0.25, 0.12, 0.26)
  g.stroke()
}

const sundae: Draw = (g) => {
  // glass bowl, stem and foot
  const bowl: Draw = (gg) => {
    gg.beginPath()
    gg.moveTo(-0.3, -0.08)
    gg.quadraticCurveTo(-0.28, 0.2, 0, 0.22)
    gg.quadraticCurveTo(0.28, 0.2, 0.3, -0.08)
    gg.closePath()
  }
  bowl(g)
  g.stroke()
  hatch(g, bowl, 1.2, 0.05, 0.4, 0.4)
  g.beginPath()
  g.moveTo(-0.03, 0.22)
  g.lineTo(-0.03, 0.38)
  g.moveTo(0.03, 0.22)
  g.lineTo(0.03, 0.38)
  g.stroke()
  g.beginPath()
  g.ellipse(0, 0.42, 0.16, 0.045, 0, 0, TAU)
  g.stroke()
  // whipped cream: three arcs stacked
  for (const [x, y, r] of [[-0.14, -0.12, 0.12], [0.14, -0.12, 0.12], [0, -0.26, 0.13]]) {
    g.beginPath()
    g.arc(x, y, r, Math.PI, 0)
    g.stroke()
  }
  circle(0, -0.44, 0.04)(g)
  g.stroke()
  // a wafer
  g.beginPath()
  g.moveTo(0.1, -0.2)
  g.lineTo(0.3, -0.48)
  g.lineTo(0.36, -0.42)
  g.lineTo(0.18, -0.18)
  g.stroke()
}

// ---------- cheese ----------

const wedge: Draw = (g) => {
  const front = poly([[-0.42, 0.08], [0.42, -0.22], [0.42, 0.1], [-0.42, 0.4]])
  const top = poly([[-0.42, 0.08], [0.42, -0.22], [0.08, -0.42]])
  top(g)
  g.stroke()
  front(g)
  g.stroke()
  hatch(g, front, 0.35, 0.04, 0.5, 0.45)
  // rind along the bottom edge
  g.beginPath()
  g.moveTo(-0.42, 0.34)
  g.lineTo(0.42, 0.04)
  g.stroke()
  // holes
  for (const [x, y, r] of [[-0.18, 0.2, 0.06], [0.1, 0.06, 0.045], [0.26, -0.04, 0.03], [-0.05, -0.2, 0.035]]) {
    circle(x, y, r)(g)
    g.stroke()
    hatch(g, circle(x, y, r), 0.8, 0.02, 0.6, 0.6)
  }
}

const wheel: Draw = (g) => {
  const top: Draw = (gg) => {
    gg.beginPath()
    gg.ellipse(0, -0.12, 0.42, 0.17, 0, 0, TAU)
  }
  top(g)
  g.stroke()
  // the side wall
  g.beginPath()
  g.moveTo(-0.42, -0.12)
  g.lineTo(-0.42, 0.14)
  g.ellipse(0, 0.14, 0.42, 0.17, 0, Math.PI, 0, true)
  g.lineTo(0.42, -0.12)
  g.stroke()
  const side = poly([[-0.42, -0.12], [-0.42, 0.14], [0, 0.31], [0.42, 0.14], [0.42, -0.12], [0, 0.05]])
  hatch(g, side, 0.1, 0.035, 0.45)
  // a wedge cut out at the front
  g.beginPath()
  g.moveTo(0, -0.12)
  g.lineTo(0.2, 0.03)
  g.moveTo(0, -0.12)
  g.lineTo(0.38, -0.05)
  g.moveTo(0, -0.12)
  g.lineTo(0, 0.14)
  g.stroke()
  // rind rings on top
  g.beginPath()
  g.ellipse(0, -0.12, 0.3, 0.12, 0, 0, TAU)
  g.stroke()
}

const grapes: Draw = (g) => {
  const rows: [number, number][][] = [
    [[-0.2, -0.1], [-0.07, -0.12], [0.07, -0.12], [0.2, -0.1]],
    [[-0.14, 0.02], [0, 0], [0.14, 0.02]],
    [[-0.07, 0.14], [0.07, 0.14]],
    [[0, 0.27]],
  ]
  for (const row of rows) {
    for (const [x, y] of row) {
      circle(x, y, 0.075)(g)
      g.stroke()
      hatch(g, circle(x, y, 0.075), 0.8, 0.025, 0.5, 0.5)
    }
  }
  g.beginPath()
  g.moveTo(0, -0.18)
  g.quadraticCurveTo(0.02, -0.34, 0.08, -0.42)
  g.stroke()
  // leaf
  g.beginPath()
  g.moveTo(0.02, -0.3)
  g.quadraticCurveTo(-0.2, -0.42, -0.28, -0.26)
  g.quadraticCurveTo(-0.12, -0.2, 0.02, -0.3)
  g.stroke()
  g.beginPath()
  g.moveTo(0.02, -0.3)
  g.lineTo(-0.2, -0.3)
  g.stroke()
}

// ---------- travel ----------

const plane: Draw = (g) => {
  g.save()
  g.rotate(-0.5)
  const fuselage: Draw = (gg) => {
    gg.beginPath()
    gg.moveTo(0.48, 0)
    gg.quadraticCurveTo(0.3, -0.07, -0.3, -0.045)
    gg.lineTo(-0.47, -0.02)
    gg.lineTo(-0.47, 0.02)
    gg.lineTo(-0.3, 0.045)
    gg.quadraticCurveTo(0.3, 0.07, 0.48, 0)
    gg.closePath()
  }
  const wing = (sgn: number) => poly([[0.08, 0.04 * sgn], [-0.16, 0.48 * sgn], [-0.3, 0.48 * sgn], [-0.1, 0.04 * sgn]])
  const fin = (sgn: number) => poly([[-0.33, 0.03 * sgn], [-0.45, 0.2 * sgn], [-0.5, 0.2 * sgn], [-0.42, 0.03 * sgn]])
  for (const sgn of [1, -1]) {
    wing(sgn)(g)
    g.stroke()
    hatch(g, wing(sgn), 1.2, 0.035, 0.45, sgn > 0 ? 0.3 : 0.9)
    fin(sgn)(g)
    g.stroke()
  }
  fuselage(g)
  g.stroke()
  hatch(g, fuselage, 0, 0.025, 0.4, 0.98)
  // windows
  g.beginPath()
  for (let x = -0.2; x < 0.3; x += 0.06) g.rect(x, -0.012, 0.025, 0.024)
  g.stroke()
  // tail fin seen from above
  g.beginPath()
  g.moveTo(-0.3, 0)
  g.lineTo(-0.47, 0)
  g.stroke()
  g.restore()
}

const suitcase: Draw = (g) => {
  const body: Draw = (gg) => {
    gg.beginPath()
    gg.roundRect(-0.36, -0.22, 0.72, 0.6, 0.07)
  }
  body(g)
  g.stroke()
  hatch(g, body, 0.3, 0.04, 0.35, 0.55)
  // handle and straps
  g.beginPath()
  g.moveTo(-0.12, -0.22)
  g.lineTo(-0.12, -0.34)
  g.arc(0, -0.34, 0.12, Math.PI, 0)
  g.lineTo(0.12, -0.22)
  g.stroke()
  g.beginPath()
  g.moveTo(-0.2, -0.22)
  g.lineTo(-0.2, 0.38)
  g.moveTo(0.2, -0.22)
  g.lineTo(0.2, 0.38)
  g.stroke()
  // clasps
  g.beginPath()
  g.rect(-0.24, 0.0, 0.08, 0.06)
  g.rect(0.16, 0.0, 0.08, 0.06)
  g.stroke()
  // stickers
  circle(0.02, 0.14, 0.07)(g)
  g.stroke()
  g.save()
  g.translate(-0.02, -0.06)
  g.rotate(-0.4)
  g.beginPath()
  g.rect(-0.07, -0.045, 0.14, 0.09)
  g.stroke()
  g.restore()
}

const compass: Draw = (g) => {
  circle(0, 0, 0.44)(g)
  g.stroke()
  circle(0, 0, 0.36)(g)
  g.stroke()
  // tick ring
  g.beginPath()
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU
    const r0 = i % 4 === 0 ? 0.36 : 0.4
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
    g.lineTo(Math.cos(a) * 0.44, Math.sin(a) * 0.44)
  }
  g.stroke()
  // star: four long arms, four short, alternate halves hatched
  const arm = (a: number, len: number): Draw => poly([[0, 0], [Math.cos(a - 0.12) * len * 0.3, Math.sin(a - 0.12) * len * 0.3], [Math.cos(a) * len, Math.sin(a) * len], [Math.cos(a + 0.12) * len * 0.3, Math.sin(a + 0.12) * len * 0.3]])
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2
    const len = i % 2 ? 0.2 : 0.33
    arm(a, len)(g)
    g.stroke()
    const half = poly([[0, 0], [Math.cos(a) * len, Math.sin(a) * len], [Math.cos(a + 0.12) * len * 0.3, Math.sin(a + 0.12) * len * 0.3]])
    hatch(g, half, a + 0.4, 0.02, 0.7)
  }
  circle(0, 0, 0.03)(g)
  g.stroke()
  // N
  g.beginPath()
  g.moveTo(-0.025, -0.39)
  g.lineTo(-0.025, -0.45)
  g.lineTo(0.025, -0.39)
  g.lineTo(0.025, -0.45)
  g.stroke()
}

const stamp: Draw = (g) => {
  g.save()
  g.rotate(-0.25)
  // perforated outer ring
  g.setLineDash([0.035, 0.025])
  circle(0, 0, 0.44)(g)
  g.stroke()
  g.setLineDash([])
  circle(0, 0, 0.4)(g)
  g.stroke()
  circle(0, 0, 0.26)(g)
  g.stroke()
  // a tiny plane in the middle, pointing up-right
  g.beginPath()
  g.moveTo(-0.1, 0.08)
  g.lineTo(0.12, -0.1)
  g.moveTo(0.12, -0.1)
  g.lineTo(0.02, -0.12)
  g.moveTo(0.12, -0.1)
  g.lineTo(0.1, 0)
  g.moveTo(-0.02, 0.02)
  g.lineTo(-0.12, -0.04)
  g.moveTo(0.01, -0.02)
  g.lineTo(0.0, -0.12)
  g.stroke()
  // date line and "VISITED" as blocks around the ring
  g.beginPath()
  g.moveTo(-0.2, 0.16)
  g.lineTo(0.2, 0.16)
  g.stroke()
  g.beginPath()
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * 1.15 + (i / 13) * Math.PI * 0.7
    const w = 0.012
    g.moveTo(Math.cos(a - w) * 0.3, Math.sin(a - w) * 0.3)
    g.lineTo(Math.cos(a - w) * 0.36, Math.sin(a - w) * 0.36)
    g.lineTo(Math.cos(a + w) * 0.36, Math.sin(a + w) * 0.36)
    g.lineTo(Math.cos(a + w) * 0.3, Math.sin(a + w) * 0.3)
  }
  g.stroke()
  g.restore()
}

const MOTIFS: Record<Motif, Draw[]> = {
  icecream: [cone, popsicle, sundae],
  cheese: [wedge, wheel, grapes],
  travel: [plane, suitcase, compass, stamp],
}

export function motifCount(m: Motif): number {
  return MOTIFS[m].length
}

/** Draw variant `index` of a motif centred at (x, y), `size` px across, turned by `angle`. */
export function drawMotif(g: G, m: Motif, index: number, x: number, y: number, size: number, angle = 0): void {
  const fns = MOTIFS[m]
  const fn = fns[((index % fns.length) + fns.length) % fns.length]
  g.save()
  g.translate(x, y)
  g.rotate(angle)
  g.scale(size, size)
  g.lineWidth = 0.75 / size
  g.lineJoin = 'round'
  g.lineCap = 'round'
  fn(g)
  g.restore()
}
