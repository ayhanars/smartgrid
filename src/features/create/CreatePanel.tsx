import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Anchor, ClipboardPaste, Clock, Copy, Grid2x2, Link, Map as MapIcon, Package, PawPrint, Plus, Rows3, Search, X } from 'lucide-react'
import { PRODUCT_TEMPLATES, cleanSpec, productTemplate, searchTemplates, type ProductSpec, type ProductTemplate, type SpecValue } from '../../lib/products'
import { artboardSize, useDocumentStore } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { SpecForm } from './SpecForm'
import { ProductPreview } from './ProductPreview'
import { GeneratorArt } from './GeneratorArt'
import { describeSpec, listRecentProducts, rememberRecentProduct, type RecentProduct } from './recents'
import { buildPrompt, encodeSpecParam, parseRecipe } from '../../lib/products/recipe'
import './CreatePanel.css'

const ICONS: Record<string, typeof Package> = { 'skadis-container': Package, 'skadis-hook': Anchor, 'bror-bin': Package, 'bror-hook': Anchor, 'pegboard-bin': Package, 'pegboard-hook': Anchor, 'drawer-tray': Grid2x2, 'drawer-divider': Rows3, 'pet-stand': PawPrint, 'city-map': MapIcon }

/**
 * The product workshop: a sheet over the editor with the picker (search,
 * categories, recents, the products as cards) and, once one is picked,
 * the live simulator on the left and the settings on the right, grouped
 * and explained. "Add to plate" builds it as a group of ordinary shapes
 * on the active plate, which stays editable like any other shape and
 * keeps its recipe, so its specs can be changed later from the right
 * panel.
 */
export function CreatePanel() {
  const open = useViewStore((s) => s.createOpen)
  const setOpen = useViewStore((s) => s.setCreateOpen)
  const requested = useViewStore((s) => s.createTemplate)
  const setRequested = useViewStore((s) => s.setCreateTemplate)
  const requestedSpec = useViewStore((s) => s.createSpec)
  const setRequestedSpec = useViewStore((s) => s.setCreateSpec)
  const generateProduct = useDocumentStore((s) => s.generateProduct)
  const setNotice = useViewStore((s) => s.setNotice)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [spec, setSpec] = useState<ProductSpec>({})
  const [recents, setRecents] = useState<RecentProduct[]>(() => listRecentProducts())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const bed = useMemo(() => artboardSize({ bedPresetId, customBedWidth, customBedHeight }), [bedPresetId, customBedWidth, customBedHeight])
  const ctx = useMemo(() => ({ bed }), [bed])
  const sheetRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const picked = pickedId ? productTemplate(pickedId) : undefined
  const categories = useMemo(() => [...new Set(PRODUCT_TEMPLATES.map((t) => t.category))], [])
  const results = useMemo(() => searchTemplates(query, category ?? undefined), [query, category])

  useEffect(() => {
    if (!open || !requested) return
    const t = productTemplate(requested)
    setRequested(null)
    setRequestedSpec(null)
    if (t) {
      const first = { ...t.defaults, ...(requestedSpec ? cleanSpec(t, requestedSpec) : {}) }
      void (t.prepare?.(first) ?? Promise.resolve()).catch(() => undefined).then(() => {
        setPickedId(t.id)
        setSpec(first)
      })
    }
  }, [open, requested, requestedSpec, setRequested, setRequestedSpec])

  // A template that loads per spec (the map of a place) is prepared
  // again when the spec changes, a moment after the last keystroke;
  // the preview and status re-render once it is done.
  const [prepared, setPrepared] = useState(0)
  useEffect(() => {
    if (!picked?.prepare) return
    const t = picked
    const snapshot = cleanSpec(t, spec)
    const timer = window.setTimeout(() => {
      setPrepared((n) => n + 1)
      void t.prepare!(snapshot).catch(() => undefined).then(() => setPrepared((n) => n + 1))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [picked, spec])
  void prepared

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickedId) setPickedId(null)
        else setOpen(false)
      }
    }
    window.addEventListener('keydown', key)
    if (!pickedId) searchRef.current?.focus()
    return () => window.removeEventListener('keydown', key)
  }, [open, pickedId, setOpen])

  if (!open) return null

  const pick = (t: ProductTemplate, withSpec?: ProductSpec) => {
    // A template that needs something loaded first (a font) gets it
    // before its form opens, so the first build already has it.
    const first = { ...t.defaults, ...(withSpec ? cleanSpec(t, withSpec) : {}) }
    void (t.prepare?.(first) ?? Promise.resolve()).catch(() => undefined).then(() => {
      setPickedId(t.id)
      setSpec(first)
    })
  }
  const add = () => {
    if (!picked) return
    const clean = cleanSpec(picked, spec)
    const groupId = generateProduct(picked.id, clean)
    if (groupId) {
      rememberRecentProduct(picked.id, clean)
      setRecents(listRecentProducts())
      setNotice(`${picked.name} added to the plate. Select it to change its specs or open the Mockup kit in the right panel.`)
      setOpen(false)
      setPickedId(null)
    }
  }
  const cleanPicked = picked ? cleanSpec(picked, spec) : null
  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`${what} copied. Paste it into your image or chat tool; the recipe in it rebuilds the part here.`)
    } catch {
      setNotice(`Could not reach the clipboard; ${what.toLowerCase()} is in the browser console.`)
      console.log(text)
    }
  }
  const copyPrompt = () => picked && copyText(buildPrompt(picked, spec), 'Prompt')
  const copyLink = () => picked && copyText(`${window.location.origin}${window.location.pathname}#/new?create=${encodeURIComponent(picked.id)}&spec=${encodeSpecParam(cleanSpec(picked, spec))}`, 'Link')
  const openPasted = () => {
    const recipe = parseRecipe(pasteText)
    const t = recipe ? productTemplate(recipe.template) : undefined
    if (!recipe || !t) {
      setPasteError('No smartgrid recipe found in that text. It needs the JSON with "template" and "spec", or a smartgrid link.')
      return
    }
    setPasteOpen(false)
    setPasteText('')
    setPasteError(null)
    pick(t, recipe.spec)
  }

  return (
    <div
      className="create-panel"
      onPointerDown={(e) => {
        // The backdrop closes; anything inside the sheet does not.
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="create-sheet" ref={sheetRef} role="dialog" aria-label="Create a product">
        {picked && cleanPicked ? (
          <>
            <div className="create-panel__head">
              <button type="button" className="create-panel__icon-btn" aria-label="Back to products" onClick={() => setPickedId(null)}>
                <ArrowLeft size={16} />
              </button>
              <div className="create-panel__title">
                <strong>{picked.name}</strong>
                <span>{picked.tagline}</span>
              </div>
              <button type="button" className="create-panel__text-btn" title="Copy a description of this part with its recipe, for an image or chat tool. For a reference picture too, add it to the plate and open the Mockup kit in the right panel." onClick={copyPrompt}>
                <Copy size={14} /> Copy prompt
              </button>
              <button type="button" className="create-panel__text-btn" title="Copy a link that opens this part with these settings." onClick={copyLink}>
                <Link size={14} /> Copy link
              </button>
              <button type="button" className="create-panel__icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="create-sheet__split">
              <div className="create-sheet__preview">
                {picked.preview ? (
                  <ProductPreview preview={picked.preview(cleanPicked, ctx)} large />
                ) : (
                  <div className="create-sheet__art">
                    <GeneratorArt template={picked.id} />
                  </div>
                )}
                {picked.status?.(cleanPicked) && <p className="create-panel__status">{picked.status(cleanPicked)}</p>}
                {picked.notes && <p className="create-panel__notes">{picked.notes}</p>}
              </div>
              <div className="create-sheet__form">
                <div className="create-panel__body">
                  <SpecForm fields={picked.fields} spec={spec} sliders sections onChange={(id: string, value: SpecValue) => setSpec((s) => ({ ...s, [id]: value }))} />
                </div>
                <div className="create-panel__foot">
                  <button type="button" className="create-panel__primary" onClick={add}>
                    <Plus size={14} /> Add to plate
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="create-panel__head create-panel__head--picker">
              <label className="create-panel__search">
                <Search size={16} />
                <input ref={searchRef} type="search" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <button type="button" className={`create-panel__text-btn ${pasteOpen ? 'create-panel__text-btn--active' : ''}`} title="Open a part from a recipe or link you were given." onClick={() => setPasteOpen((v) => !v)}>
                <ClipboardPaste size={14} /> Paste recipe
              </button>
              <button type="button" className="create-panel__icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
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
            {pasteOpen && (
              <div className="create-panel__paste">
                <textarea
                  value={pasteText}
                  placeholder={'Paste a recipe here: the JSON with "template" and "spec" (from Copy prompt, or an AI tool\'s answer), or a smartgrid link.'}
                  onChange={(e) => {
                    setPasteText(e.target.value)
                    setPasteError(null)
                  }}
                />
                <div className="create-panel__paste-row">
                  {pasteError ? <span className="create-panel__paste-error">{pasteError}</span> : <span className="create-panel__paste-hint">Opens the product with those settings; nothing is added until you press Add to plate.</span>}
                  <button type="button" className="create-panel__primary create-panel__primary--small" disabled={!pasteText.trim()} onClick={openPasted}>
                    Open
                  </button>
                </div>
              </div>
            )}
            <div className="create-panel__list">
              {!query && category === null && recents.length > 0 && (
                <>
                  <div className="create-panel__section">
                    <Clock size={12} /> Recent
                  </div>
                  <div className="create-panel__cards create-panel__cards--recent">
                    {recents.map((r) => {
                      const t = productTemplate(r.template)
                      if (!t) return null
                      const Icon = ICONS[t.id] ?? Package
                      return (
                        <button key={r.template} type="button" className="create-panel__item create-panel__item--recent" onClick={() => pick(t, r.spec)}>
                          <span className="create-panel__item-icon">
                            <Icon size={18} />
                          </span>
                          <span className="create-panel__item-text">
                            <strong>{t.name}</strong>
                            <span>{describeSpec(r.spec) || t.tagline}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="create-panel__section">
                    <Package size={12} /> All products
                  </div>
                </>
              )}
              {results.length === 0 && <p className="create-panel__empty">Nothing matches "{query}".</p>}
              <div className="create-panel__cards">
                {results.map((t) => (
                  <button key={t.id} type="button" className="create-card" onClick={() => pick(t)}>
                    <span className="create-card__art">
                      <GeneratorArt template={t.id} />
                    </span>
                    <span className="create-panel__item-text">
                      <strong>{t.name}</strong>
                      <span>{t.tagline}</span>
                    </span>
                    <span className="create-panel__item-cat">{t.category}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
