import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Anchor, Package, Plus, Search, X } from 'lucide-react'
import { PRODUCT_TEMPLATES, cleanSpec, productTemplate, searchTemplates, type ProductSpec, type ProductTemplate, type SpecValue } from '../../lib/products'
import { useDocumentStore } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { SpecForm } from './SpecForm'
import './CreatePanel.css'

const ICONS: Record<string, typeof Package> = { 'skadis-container': Package, 'skadis-hook': Anchor }

/**
 * The product picker: search, a category row and the templates, then a
 * spec form for the one picked. "Add to plate" builds it as a group of
 * ordinary shapes on the active plate, which stays editable like any
 * other shape — and keeps its recipe, so its specs can be changed later
 * from the right panel.
 */
export function CreatePanel() {
  const open = useViewStore((s) => s.createOpen)
  const setOpen = useViewStore((s) => s.setCreateOpen)
  const generateProduct = useDocumentStore((s) => s.generateProduct)
  const setNotice = useViewStore((s) => s.setNotice)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [spec, setSpec] = useState<ProductSpec>({})
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const picked = pickedId ? productTemplate(pickedId) : undefined
  const categories = useMemo(() => [...new Set(PRODUCT_TEMPLATES.map((t) => t.category))], [])
  const results = useMemo(() => searchTemplates(query, category ?? undefined), [query, category])

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-create-launcher]')) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickedId) setPickedId(null)
        else setOpen(false)
      }
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    if (!pickedId) searchRef.current?.focus()
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open, pickedId, setOpen])

  if (!open) return null

  const pick = (t: ProductTemplate) => {
    setPickedId(t.id)
    setSpec({ ...t.defaults })
  }
  const add = () => {
    if (!picked) return
    const groupId = generateProduct(picked.id, cleanSpec(picked, spec))
    if (groupId) {
      setNotice(`${picked.name} added to the plate. Select it to change its specs in the right panel.`)
      setOpen(false)
      setPickedId(null)
    }
  }

  return (
    <div className="create-panel" ref={ref} role="dialog" aria-label="Create a product">
      {picked ? (
        <>
          <div className="create-panel__head">
            <button type="button" className="create-panel__icon-btn" aria-label="Back to products" onClick={() => setPickedId(null)}>
              <ArrowLeft size={16} />
            </button>
            <div className="create-panel__title">
              <strong>{picked.name}</strong>
              <span>{picked.tagline}</span>
            </div>
            <button type="button" className="create-panel__icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="create-panel__body">
            <SpecForm fields={picked.fields} spec={spec} onChange={(id: string, value: SpecValue) => setSpec((s) => ({ ...s, [id]: value }))} />
            {picked.notes && <p className="create-panel__notes">{picked.notes}</p>}
          </div>
          <div className="create-panel__foot">
            <button type="button" className="create-panel__primary" onClick={add}>
              <Plus size={14} /> Add to plate
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="create-panel__search">
            <Search size={16} />
            <input ref={searchRef} type="search" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="create-panel__chips" role="tablist">
            <button type="button" role="tab" aria-selected={category === null} className={`create-panel__chip ${category === null ? 'create-panel__chip--active' : ''}`} onClick={() => setCategory(null)}>
              All
            </button>
            {categories.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={category === c} className={`create-panel__chip ${category === c ? 'create-panel__chip--active' : ''}`} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="create-panel__list">
            {results.length === 0 && <p className="create-panel__empty">Nothing matches "{query}".</p>}
            {results.map((t) => {
              const Icon = ICONS[t.id] ?? Package
              return (
                <button key={t.id} type="button" className="create-panel__item" onClick={() => pick(t)}>
                  <span className="create-panel__item-icon">
                    <Icon size={18} />
                  </span>
                  <span className="create-panel__item-text">
                    <strong>{t.name}</strong>
                    <span>{t.tagline}</span>
                  </span>
                  <span className="create-panel__item-cat">{t.category}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
