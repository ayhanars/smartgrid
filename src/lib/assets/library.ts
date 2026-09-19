import type { AssetDefinition, AssetPart } from './types'

const BLUE = '#4d8dff'
const MINT = '#3ecf8e'
const SAND = '#e5b567'
const CORAL = '#ff7a59'
const SLATE = '#8e9bb3'

const solid = (part: Omit<AssetPart, 'isHole'>): AssetPart => part
const cutter = (part: Omit<AssetPart, 'isHole' | 'color'>): AssetPart => ({ ...part, isHole: true })

/** Round through-hole cutter centered at (cx, cy) with some overshoot. */
const throughHole = (cx: number, cy: number, diameter: number, depth: number, name = 'Hole'): AssetPart =>
  cutter({ kind: 'hole', name, x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter, depth: depth + 2, z: -1 })

/**
 * The built-in asset library: ready-made objects people print all the
 * time, each assembled from ordinary shapes with the tool's own features
 * (hollowing, holes, textures, bevels) so every part stays editable after
 * it lands on the canvas.
 */
export const ASSET_LIBRARY: AssetDefinition[] = [
  // ---- Containers ----
  {
    id: 'basket',
    name: 'Basket',
    category: 'Containers',
    description: 'Hollow box with a grid of holes through the walls.',
    width: 90,
    height: 60,
    builtin: true,
    parts: [
      solid({
        kind: 'rect',
        name: 'Basket',
        x: 0,
        y: 0,
        width: 90,
        height: 60,
        depth: 45,
        cornerRadius: 8,
        color: BLUE,
        hollow: { wall: 1.6, floor: 1.2, openFrom: 'top' },
        perforation: { shape: 'round', pattern: 'staggered', size: 3.2, spacing: 5.5, target: 'walls', depth: null, wallFrom: 4, wallTo: 41 },
      }),
    ],
  },
  {
    id: 'pen-cup',
    name: 'Pen cup',
    category: 'Containers',
    description: 'Fluted cylinder with a rounded foot, 2 mm walls.',
    width: 75,
    height: 75,
    builtin: true,
    parts: [
      solid({
        kind: 'circle',
        name: 'Pen cup',
        x: 0,
        y: 0,
        width: 75,
        height: 75,
        depth: 95,
        bevelBottom: 3,
        color: MINT,
        hollow: { wall: 2, floor: 2, openFrom: 'top' },
        texture: { pattern: 'flutes', target: 'walls', size: 6, depth: 0.6, wallFrom: 6, wallTo: 90 },
      }),
    ],
  },
  {
    id: 'tray',
    name: 'Tray',
    category: 'Containers',
    description: 'Shallow rounded tray for keys, coins, screws.',
    width: 120,
    height: 80,
    builtin: true,
    parts: [
      solid({ kind: 'rect', name: 'Tray', x: 0, y: 0, width: 120, height: 80, depth: 16, cornerRadius: 12, bevelBottom: 2, color: SAND, hollow: { wall: 2, floor: 1.6, openFrom: 'top' } }),
    ],
  },
  {
    id: 'planter',
    name: 'Planter',
    category: 'Containers',
    description: 'Hexagonal pot with drainage holes in the floor.',
    width: 90,
    height: 90,
    builtin: true,
    parts: [
      solid({ kind: 'polygon', name: 'Planter', x: 0, y: 0, width: 90, height: 90, depth: 80, polygonSides: 6, bevelBottom: 4, color: MINT, hollow: { wall: 2.4, floor: 2.4, openFrom: 'top' } }),
      throughHole(45, 45, 6, 3, 'Drain'),
      throughHole(30, 45, 6, 3, 'Drain'),
      throughHole(60, 45, 6, 3, 'Drain'),
      throughHole(45, 30, 6, 3, 'Drain'),
      throughHole(45, 60, 6, 3, 'Drain'),
    ],
  },
  {
    id: 'soap-dish',
    name: 'Soap dish',
    category: 'Containers',
    description: 'Low dish with slots in the floor so water drains.',
    width: 105,
    height: 75,
    builtin: true,
    parts: [
      solid({ kind: 'rect', name: 'Soap dish', x: 0, y: 0, width: 105, height: 75, depth: 14, cornerRadius: 14, color: BLUE, hollow: { wall: 2, floor: 2, openFrom: 'top' } }),
      ...[20, 32, 44, 56, 68, 80].map((x) => cutter({ kind: 'rect', name: 'Slot', x: x - 2.5, y: 20, width: 5, height: 35, depth: 4, z: -1, cornerRadius: 2.5 })),
    ],
  },
  {
    id: 'organizer',
    name: 'Drawer organizer',
    category: 'Containers',
    description: 'Four bins side by side, each 1.6 mm walls.',
    width: 120,
    height: 120,
    builtin: true,
    parts: [
      ...[0, 60].flatMap((x) =>
        [0, 60].map((y) => solid({ kind: 'rect', name: 'Bin', x, y, width: 60, height: 60, depth: 35, cornerRadius: 5, color: SLATE, hollow: { wall: 1.6, floor: 1.2, openFrom: 'top' } })),
      ),
    ],
  },
  // ---- Tags & plates ----
  {
    id: 'keychain',
    name: 'Keychain tag',
    category: 'Tags & plates',
    description: 'Rounded tag with a ring hole. Add text or a logo on top.',
    width: 55,
    height: 25,
    builtin: true,
    parts: [solid({ kind: 'rect', name: 'Tag', x: 0, y: 0, width: 55, height: 25, depth: 3, cornerRadius: 8, bevelTop: 0.8, color: CORAL }), throughHole(8, 12.5, 5, 3, 'Ring hole')],
  },
  {
    id: 'coaster',
    name: 'Coaster',
    category: 'Tags & plates',
    description: 'Round coaster with a honeycomb top.',
    width: 95,
    height: 95,
    builtin: true,
    parts: [solid({ kind: 'circle', name: 'Coaster', x: 0, y: 0, width: 95, height: 95, depth: 5, bevelTop: 1.5, color: SAND, texture: { pattern: 'honeycomb', target: 'top', size: 8, depth: 0.8, topInset: 6 } })],
  },
  {
    id: 'name-plate',
    name: 'Name plate',
    category: 'Tags & plates',
    description: 'Bevelled plate for a desk name or a door sign.',
    width: 130,
    height: 40,
    builtin: true,
    parts: [solid({ kind: 'rect', name: 'Plate', x: 0, y: 0, width: 130, height: 40, depth: 4, cornerRadius: 4, bevelTop: 1.2, color: SLATE })],
  },
  {
    id: 'hex-tile',
    name: 'Hex tile',
    category: 'Tags & plates',
    description: 'Wall tile with a diamond-textured face; tile a whole wall.',
    width: 60,
    height: 60,
    builtin: true,
    parts: [solid({ kind: 'polygon', name: 'Tile', x: 0, y: 0, width: 60, height: 60, depth: 6, polygonSides: 6, bevelTop: 1, color: BLUE, texture: { pattern: 'diamonds', target: 'top', size: 5, depth: 0.6, topInset: 4 } })],
  },
  // ---- Hardware ----
  {
    id: 'calibration-cube',
    name: 'Calibration cube',
    category: 'Hardware',
    description: 'The classic 20 mm test cube.',
    width: 20,
    height: 20,
    builtin: true,
    parts: [solid({ kind: 'rect', name: 'Cube', x: 0, y: 0, width: 20, height: 20, depth: 20, color: CORAL })],
  },
  {
    id: 'washer',
    name: 'Washer',
    category: 'Hardware',
    description: 'M8 washer: 20 mm across, 8.5 mm bore, 2 mm thick.',
    width: 20,
    height: 20,
    builtin: true,
    parts: [solid({ kind: 'circle', name: 'Washer', x: 0, y: 0, width: 20, height: 20, depth: 2, color: SLATE }), throughHole(10, 10, 8.5, 2, 'Bore')],
  },
  {
    id: 'hex-nut',
    name: 'Hex nut',
    category: 'Hardware',
    description: 'M8-sized nut blank, 13 mm across flats.',
    width: 15,
    height: 15,
    builtin: true,
    parts: [solid({ kind: 'polygon', name: 'Nut', x: 0, y: 0, width: 15, height: 15, depth: 6.5, polygonSides: 6, bevelTop: 0.8, bevelBottom: 0.8, color: SLATE }), throughHole(7.5, 7.5, 8, 6.5, 'Thread')],
  },
  {
    id: 'knob',
    name: 'Knob',
    category: 'Hardware',
    description: 'Grippy fluted knob with a rounded top.',
    width: 32,
    height: 32,
    builtin: true,
    parts: [
      solid({ kind: 'circle', name: 'Knob', x: 0, y: 0, width: 32, height: 32, depth: 16, bevelTop: 4, color: BLUE, texture: { pattern: 'flutes', target: 'walls', size: 3, depth: 0.5, wallFrom: 1, wallTo: 11 } }),
      cutter({ kind: 'hole', name: 'Shaft', x: 12.5, y: 12.5, width: 7, height: 7, depth: 9, z: -1 }),
    ],
  },
  {
    id: 'standoff',
    name: 'Standoff',
    category: 'Hardware',
    description: 'M3 spacer: 8 mm round, 10 mm tall, 3.2 mm bore.',
    width: 8,
    height: 8,
    builtin: true,
    parts: [solid({ kind: 'circle', name: 'Standoff', x: 0, y: 0, width: 8, height: 8, depth: 10, color: SLATE }), throughHole(4, 4, 3.2, 10, 'Bore')],
  },
  {
    id: 'magnet-pocket',
    name: 'Magnet pocket',
    category: 'Hardware',
    description: 'Cutter for a 6 × 2 mm disc magnet. Drop it onto any shape.',
    width: 6.4,
    height: 6.4,
    builtin: true,
    parts: [cutter({ kind: 'hole', name: 'Magnet 6×2', x: 0, y: 0, width: 6.4, height: 6.4, depth: 2.2, z: 0 })],
  },
  {
    id: 'countersink',
    name: 'Countersunk screw hole',
    category: 'Hardware',
    description: 'Cutter for an M4 screw with a countersunk head.',
    width: 8,
    height: 8,
    builtin: true,
    parts: [cutter({ kind: 'hole', name: 'M4 countersunk', x: 1.75, y: 1.75, width: 4.5, height: 4.5, depth: 30, z: -1, bevelTop: 2.2 })],
  },
  // ---- Decorative ----
  {
    id: 'star-ornament',
    name: 'Star ornament',
    category: 'Decorative',
    description: 'Five-point star with a hanging hole.',
    width: 60,
    height: 60,
    builtin: true,
    parts: [solid({ kind: 'star', name: 'Star', x: 0, y: 0, width: 60, height: 60, depth: 3, starPoints: 5, starInnerRatio: 0.45, bevelTop: 0.8, color: SAND }), throughHole(30, 8, 3.5, 3, 'Hang hole')],
  },
  {
    id: 'badge',
    name: 'Badge',
    category: 'Decorative',
    description: 'Round badge with a raised rim, ready for a logo.',
    width: 45,
    height: 45,
    builtin: true,
    parts: [
      solid({ kind: 'circle', name: 'Badge', x: 0, y: 0, width: 45, height: 45, depth: 3, bevelTop: 1, color: CORAL }),
      solid({ kind: 'circle', name: 'Rim', x: 2, y: 2, width: 41, height: 41, depth: 1.2, z: 3, color: CORAL, hollow: { wall: 2, floor: 0, openFrom: 'top' } }),
    ],
  },
  {
    id: 'leather-plate',
    name: 'Leather plate',
    category: 'Decorative',
    description: 'Rounded plaque with a pebbled leather face.',
    width: 80,
    height: 50,
    builtin: true,
    parts: [solid({ kind: 'rect', name: 'Plaque', x: 0, y: 0, width: 80, height: 50, depth: 5, cornerRadius: 10, bevelTop: 1.5, color: SAND, texture: { pattern: 'pebble', target: 'top', size: 4, depth: 0.5, topInset: 4 } })],
  },
]

export const ASSET_CATEGORIES = ['Containers', 'Tags & plates', 'Hardware', 'Decorative']
