import { useEffect, useState } from 'react'
import { RefreshCcw } from 'lucide-react'
import { cleanSpec, productTemplate, type ProductSpec, type SpecValue } from '../../lib/products'
import { useDocumentStore } from '../../state/documentStore'
import { SpecForm } from './SpecForm'

/**
 * Shown above the tabs when the selection is (part of) a product the
 * Create panel generated: the product's specs, and Update to rebuild
 * it in place from them. The parts below stay ordinary shapes.
 */
export function ProductSection({ selection }: { selection: string[] }) {
  const layers = useDocumentStore((s) => s.layers)
  const groups = useDocumentStore((s) => s.groups)
  const regenerateProduct = useDocumentStore((s) => s.regenerateProduct)
  const setSelection = useDocumentStore((s) => s.setSelection)
  const order = useDocumentStore((s) => s.order)

  const groupIds = new Set(selection.map((id) => layers[id]?.groupId).filter((g): g is string => !!g))
  const groupId = groupIds.size === 1 ? [...groupIds][0] : null
  const group = groupId ? groups[groupId] : undefined
  const recipe = group?.recipe
  const template = recipe ? productTemplate(recipe.template) : undefined

  const [spec, setSpec] = useState<ProductSpec>({})
  useEffect(() => {
    setSpec(recipe ? { ...recipe.spec } : {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, recipe])

  if (!group || !recipe || !template || !groupId) return null

  const dirty = Object.keys(spec).some((k) => spec[k] !== recipe.spec[k])
  const update = () => {
    const newId = regenerateProduct(groupId, cleanSpec(template, spec))
    if (newId) {
      const s = useDocumentStore.getState()
      setSelection(s.order.filter((id) => s.layers[id]?.groupId === newId))
    }
  }
  const partCount = order.filter((id) => layers[id]?.groupId === groupId && !layers[id]?.shellOf).length

  return (
    <div className="inspector-section inspector-product">
      <div className="inspector-section__header">
        <span>{template.name}</span>
        <span className="inspector-section__hint">{partCount} part{partCount === 1 ? '' : 's'}</span>
      </div>
      <SpecForm fields={template.fields} spec={spec} onChange={(id: string, value: SpecValue) => setSpec((prev) => ({ ...prev, [id]: value }))} />
      <button type="button" className={`inspector-product__update ${dirty ? 'inspector-product__update--dirty' : ''}`} disabled={!dirty} onClick={update}>
        <RefreshCcw size={13} /> Update product
      </button>
      <p className="inspector-note">Rebuilds every part from these specs; changes made to the parts by hand are replaced. The parts themselves stay editable in the tabs below.</p>
    </div>
  )
}
