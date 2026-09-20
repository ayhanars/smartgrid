import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { popularTags } from '../../lib/supabase/community'
import '../layers/LayerContextMenu.css'
import './community.css'

const MAX_TAGS = 8

/** Chips plus a text box that suggests tags people already use, so
 * "organiser" and "organizer" do not become two tags. */
export function TagInput({ value, onChange, id }: { value: string[]; onChange: (tags: string[]) => void; id?: string }) {
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState<{ tag: string; uses: number }[]>([])
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = draft.trim().toLowerCase()
    let cancelled = false
    popularTags(q, 10)
      .then((list) => !cancelled && setSuggestions(list.filter((s) => !value.includes(s.tag))))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [draft, value])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/^#/, '').slice(0, 24)
    if (!tag || value.includes(tag) || value.length >= MAX_TAGS) return
    onChange([...value, tag])
    setDraft('')
  }
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  return (
    <div className="tag-input" ref={boxRef} onClick={() => inputRef.current?.focus()}>
      {value.map((t) => (
        <span key={t} className="tag-input__chip">
          {t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => remove(t)}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        placeholder={value.length === 0 ? 'Add tags: organizer, gridfinity, desk…' : value.length >= MAX_TAGS ? '' : 'Add another…'}
        disabled={value.length >= MAX_TAGS}
        aria-label="Tags"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab' && draft.trim() && suggestions.length > 0) {
            // Tab completes to the first tag already in use.
            e.preventDefault()
            add(suggestions[0].tag)
          } else if (e.key === 'Enter' || e.key === ',') {
            if (draft.trim()) {
              e.preventDefault()
              const exact = suggestions.find((s) => s.tag === draft.trim().toLowerCase())
              add(exact ? exact.tag : draft)
            }
          } else if (e.key === 'Backspace' && !draft && value.length) {
            remove(value[value.length - 1])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && suggestions.length > 0 && value.length < MAX_TAGS && (
        <div className="layer-context-menu tag-input__menu" role="listbox">
          <div className="tag-input__hint">{draft.trim() ? 'Matching tags in use · Tab completes the first' : 'Tags people use'}</div>
          {suggestions.map((s) => (
            <button key={s.tag} type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.tag)}>
              <span>{s.tag}</span>
              <span className="tag-input__uses">{s.uses}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
