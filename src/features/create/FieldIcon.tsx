/**
 * A small glyph beside each product setting showing what it changes: the
 * piece in outline, the measured or affected part in the accent colour.
 * Settings without a glyph render nothing.
 */
const W = 30
const H = 24

function Box({ children }: { children?: React.ReactNode }) {
  return (
    <svg className="field-icon" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {children}
    </svg>
  )
}

/** Oblique box: front face + top + right side, in outline. */
const front = 'M4 8 H20 V22 H4 Z'
const top = 'M4 8 L9 3 H25 L20 8'
const side = 'M20 8 L25 3 V17 L20 22'
const Body = ({ hide }: { hide?: 'top' }) => (
  <g className="field-icon__line">
    <path d={front} />
    {hide !== 'top' && <path d={top} />}
    <path d={side} />
  </g>
)
const Arrow = ({ d }: { d: string }) => <path className="field-icon__mark" d={d} markerStart="url(#fi-a)" markerEnd="url(#fi-a)" />

/** Top view: outline of the footprint. */
const Plan = () => <rect className="field-icon__line" x="4" y="4" width="22" height="16" rx="1.5" />
/** Back view: the back wall as a plain rectangle. */
const Back = () => <rect className="field-icon__line" x="5" y="3" width="20" height="18" />

const GLYPHS: Record<string, () => React.ReactNode> = {
  width: () => (
    <>
      <Body />
      <Arrow d="M4 25 H20" />
    </>
  ),
  depth: () => (
    <>
      <Body />
      <Arrow d="M22 23 L28 17" />
    </>
  ),
  height: () => (
    <>
      <Body />
      <Arrow d="M1 8 V22" />
    </>
  ),
  front: () => (
    <>
      <g className="field-icon__line">
        <path d="M4 14 H20 V22 H4 Z" />
        <path d="M20 14 L25 3 V17 L20 22" />
        <path d="M4 14 L9 3 H25" />
      </g>
      <Arrow d="M1 14 V22" />
    </>
  ),
  wall: () => (
    <>
      <Plan />
      <rect className="field-icon__fill" x="4" y="4" width="22" height="16" rx="1.5" />
      <rect className="field-icon__cut" x="8" y="8" width="14" height="8" />
    </>
  ),
  floor: () => (
    <>
      <g className="field-icon__line">
        <path d="M4 3 V21 H26 V3" />
      </g>
      <rect className="field-icon__fill" x="4" y="16" width="22" height="5" />
    </>
  ),
  corner: () => (
    <>
      <Plan />
      <path className="field-icon__mark" d="M4 10 V8 A4 4 0 0 1 8 4 H10" />
    </>
  ),
  hooks: () => (
    <>
      <Back />
      <circle className="field-icon__fill" cx="10" cy="8" r="2.2" />
      <circle className="field-icon__fill" cx="20" cy="8" r="2.2" />
    </>
  ),
  rows: () => (
    <>
      <Back />
      <circle className="field-icon__line" cx="10" cy="7" r="2" />
      <circle className="field-icon__line" cx="20" cy="7" r="2" />
      <circle className="field-icon__fill" cx="10" cy="16" r="2.2" />
      <circle className="field-icon__fill" cx="20" cy="16" r="2.2" />
    </>
  ),
  dividers: () => (
    <>
      <Plan />
      <path className="field-icon__mark" d="M11 4 V20 M19 4 V20" />
    </>
  ),
  columns: () => (
    <>
      <Plan />
      <path className="field-icon__mark" d="M11 4 V20 M19 4 V20" />
    </>
  ),
  drain: () => (
    <>
      <Plan />
      <circle className="field-icon__fill" cx="15" cy="12" r="3" />
    </>
  ),
  hole: () => (
    <>
      <circle className="field-icon__line" cx="15" cy="12" r="8" />
      <Arrow d="M7 12 H23" />
    </>
  ),
  pitch: () => (
    <>
      <circle className="field-icon__line" cx="8" cy="12" r="4" />
      <circle className="field-icon__line" cx="22" cy="12" r="4" />
      <Arrow d="M8 21 H22" />
    </>
  ),
  pitchX: () => (
    <>
      <circle className="field-icon__line" cx="8" cy="12" r="4" />
      <circle className="field-icon__line" cx="22" cy="12" r="4" />
      <Arrow d="M8 21 H22" />
    </>
  ),
  pitchY: () => (
    <>
      <circle className="field-icon__line" cx="15" cy="6" r="3.5" />
      <circle className="field-icon__line" cx="15" cy="18" r="3.5" />
      <Arrow d="M24 6 V18" />
    </>
  ),
  sheet: () => (
    <>
      <rect className="field-icon__fill" x="13" y="3" width="4" height="18" />
      <Arrow d="M8 12 H22" />
    </>
  ),
  slotHeight: () => (
    <>
      <rect className="field-icon__line" x="11" y="3" width="8" height="18" rx="4" />
      <Arrow d="M24 3 V21" />
    </>
  ),
  reach: () => (
    <>
      <path className="field-icon__line" d="M4 3 V21 H26 V15 H8 V3 Z" />
      <Arrow d="M8 24 H26" />
    </>
  ),
  arm: () => (
    <>
      <path className="field-icon__line" d="M4 3 V21 H26 V15 H8 V3 Z" />
      <Arrow d="M28 15 V21" />
    </>
  ),
  tip: () => (
    <>
      <path className="field-icon__line" d="M4 3 V21 H26 V9 H22 V15 H8 V3 Z" />
      <Arrow d="M28 9 V21" />
    </>
  ),
  plate: () => (
    <>
      <path className="field-icon__line" d="M4 3 V21 H26 V15 H8 V3 Z" />
      <Arrow d="M1 3 V21" />
    </>
  ),
  length: () => (
    <>
      <rect className="field-icon__line" x="3" y="9" width="24" height="6" />
      <Arrow d="M3 20 H27" />
    </>
  ),
  thickness: () => (
    <>
      <rect className="field-icon__fill" x="3" y="10" width="24" height="4" />
      <Arrow d="M29 10 V14" />
    </>
  ),
  count: () => (
    <>
      <rect className="field-icon__line" x="3" y="5" width="6" height="14" />
      <rect className="field-icon__line" x="12" y="5" width="6" height="14" />
      <rect className="field-icon__fill" x="21" y="5" width="6" height="14" />
    </>
  ),
  split: () => (
    <>
      <Plan />
      <path className="field-icon__mark" d="M15 2 V22" strokeDasharray="2 2" />
    </>
  ),
  pattern: () => (
    <>
      <Back />
      <path className="field-icon__mark" d="M8 7 l4 4 l4 -4 l4 4 M8 13 l4 4 l4 -4 l4 4" />
    </>
  ),
  patternSize: () => (
    <>
      <Back />
      <path className="field-icon__line" d="M8 7 l4 4 l4 -4 l4 4" />
      <Arrow d="M8 17 H16" />
    </>
  ),
}

const ALIASES: Record<string, string> = { bowl: 'hole', bowlDepth: 'height', band: 'floor', name: 'pattern' }

export function FieldIcon({ id }: { id: string }) {
  const glyph = GLYPHS[ALIASES[id] ?? id]
  if (!glyph) return null
  return (
    <Box>
      <defs>
        <marker id="fi-a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 L6 3 L0 6 Z" className="field-icon__head" />
        </marker>
      </defs>
      {glyph()}
    </Box>
  )
}
