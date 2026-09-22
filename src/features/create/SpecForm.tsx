import { useEffect, useState } from 'react'
import type { ProductSpec, SpecField, SpecValue } from '../../lib/products'
import { useDocumentStore } from '../../state/documentStore'

const UNIT_FACTORS = { mm: 1, cm: 10, in: 25.4 } as const

/** Where each setting belongs when the form is shown in sections, with
 * a plain-language line for the section. Unknown ids land in "More". */
const SECTIONS: { id: string; title: string; hint: string; fields: string[] }[] = [
  { id: 'size', title: 'Size', hint: 'Outer measurements of the finished piece.', fields: ['width', 'depth', 'height', 'length', 'reach', 'plate', 'count'] },
  { id: 'layout', title: 'Inside', hint: 'How the space is divided.', fields: ['columns', 'rows', 'layout', 'build', 'dividers', 'drain', 'edge', 'notches'] },
  { id: 'mount', title: 'Mounting', hint: 'How it hangs on the board.', fields: ['hooks', 'rows', 'board', 'holeKind', 'hole', 'slotHeight', 'pitchX', 'pitchY', 'stagger', 'sheet', 'pitch'] },
  { id: 'walls', title: 'Walls & look', hint: 'Thicknesses, corners and the pattern on the walls.', fields: ['wall', 'floor', 'corner', 'thickness', 'crossing', 'arm', 'tip', 'pattern', 'patternSize'] },
  { id: 'printing', title: 'Printing', hint: 'What happens when it is bigger than the bed.', fields: ['split', 'clips', 'outer', 'feet'] },
]

/** The fields of a product, two to a row. Values stay in mm in the spec;
 * the display follows the document's unit like the inspector does.
 * With `sections` the fields are grouped with a line explaining each
 * group, and every hint is shown under its field. */
export function SpecForm({ fields, spec, onChange, sliders = false, sections = false }: { fields: SpecField[]; spec: ProductSpec; onChange: (id: string, value: SpecValue) => void; sliders?: boolean; sections?: boolean }) {
  if (!sections) return <div className="spec-form">{fields.map((f) => renderField(f, spec, onChange, sliders, false))}</div>
  const placed = new Set<string>()
  const groups = SECTIONS.map((s) => {
    // A field that fits two sections (rows: layout or mounting) goes to
    // the first section that has any other field of the product.
    const own = fields.filter((f) => s.fields.includes(f.id) && !placed.has(f.id))
    const has = own.some((f) => !['rows'].includes(f.id)) || own.length === fields.length
    const take = has ? own : own.filter((f) => f.id !== 'rows')
    for (const f of take) placed.add(f.id)
    return { ...s, items: take }
  }).filter((s) => s.items.length > 0)
  const rest = fields.filter((f) => !placed.has(f.id))
  if (rest.length > 0) groups.push({ id: 'more', title: 'More', hint: '', fields: [], items: rest })
  return (
    <div className="spec-form spec-form--sections">
      {groups.map((g) => (
        <section key={g.id} className="spec-section">
          <header className="spec-section__head">
            <strong>{g.title}</strong>
            {g.hint && <span>{g.hint}</span>}
          </header>
          <div className="spec-form">{g.items.map((f) => renderField(f, spec, onChange, sliders, true))}</div>
        </section>
      ))}
    </div>
  )
}

function renderField(f: SpecField, spec: ProductSpec, onChange: (id: string, value: SpecValue) => void, sliders: boolean, showHints: boolean) {
  const hint = showHints && f.hint ? <small className="spec-form__hint">{f.hint}</small> : null
  if (f.kind === 'number') {
    const value = typeof spec[f.id] === 'number' ? (spec[f.id] as number) : f.min
    const field = <NumberField key={f.id} field={f} value={value} onChange={(v) => onChange(f.id, v)} />
    if (!sliders) return field
    return (
      <div key={f.id} className="spec-form__slider" title={showHints ? undefined : f.hint}>
        <input type="range" min={f.min} max={f.max} step={f.step ?? 0.1} value={value} aria-label={f.label} onChange={(e) => onChange(f.id, Number(e.target.value))} />
        {field}
        {hint}
      </div>
    )
  }
  if (f.kind === 'select')
    return (
      <label key={f.id} className="inspector-field spec-form__field spec-form__field--wide" title={showHints ? undefined : f.hint}>
        <span className="inspector-field__label">{f.label}</span>
        <span className="inspector-field__input-wrap">
          <select value={String(spec[f.id] ?? f.options[0]?.value)} onChange={(e) => onChange(f.id, e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
        {hint}
      </label>
    )
  return (
    <label key={f.id} className="inspector-check spec-form__field spec-form__field--wide" title={showHints ? undefined : f.hint}>
      <input type="checkbox" checked={spec[f.id] === true} onChange={(e) => onChange(f.id, e.target.checked)} />
      <span>
        {f.label}
        {hint}
      </span>
    </label>
  )
}

function NumberField({ field, value, onChange }: { field: Extract<SpecField, { kind: 'number' }>; value: number; onChange: (v: number) => void }) {
  const displayUnit = useDocumentStore((s) => s.displayUnit)
  const isLength = field.unit === 'mm'
  const factor = isLength ? UNIT_FACTORS[displayUnit] : 1
  const decimals = isLength && displayUnit !== 'mm' ? 2 : 1
  const shown = (v: number) => String(Math.round((v / factor) * 10 ** decimals) / 10 ** decimals)
  const [text, setText] = useState(shown(value))
  useEffect(() => {
    setText(shown(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, displayUnit])
  const commit = () => {
    const parsed = parseFloat(text)
    if (Number.isNaN(parsed)) setText(shown(value))
    else onChange(Math.min(field.max, Math.max(field.min, parsed * factor)))
  }
  return (
    <label className="inspector-field spec-form__field" title={field.hint}>
      <span className="inspector-field__label">{field.label}</span>
      <span className="inspector-field__input-wrap">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        {field.unit === 'mm' && <span className="inspector-field__suffix">{displayUnit}</span>}
      </span>
    </label>
  )
}
