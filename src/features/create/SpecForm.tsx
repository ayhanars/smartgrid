import { useEffect, useState } from 'react'
import type { ProductSpec, SpecField, SpecValue } from '../../lib/products'
import { useDocumentStore } from '../../state/documentStore'

const UNIT_FACTORS = { mm: 1, cm: 10, in: 25.4 } as const

/** The fields of a product, two to a row. Values stay in mm in the spec;
 * the display follows the document's unit like the inspector does. */
export function SpecForm({ fields, spec, onChange }: { fields: SpecField[]; spec: ProductSpec; onChange: (id: string, value: SpecValue) => void }) {
  return (
    <div className="spec-form">
      {fields.map((f) => {
        if (f.kind === 'number') return <NumberField key={f.id} field={f} value={typeof spec[f.id] === 'number' ? (spec[f.id] as number) : f.min} onChange={(v) => onChange(f.id, v)} />
        if (f.kind === 'select')
          return (
            <label key={f.id} className="inspector-field spec-form__field" title={f.hint}>
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
            </label>
          )
        return (
          <label key={f.id} className="inspector-check spec-form__field spec-form__field--wide" title={f.hint}>
            <input type="checkbox" checked={spec[f.id] === true} onChange={(e) => onChange(f.id, e.target.checked)} />
            {f.label}
          </label>
        )
      })}
    </div>
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
