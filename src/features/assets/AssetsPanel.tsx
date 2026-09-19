import { useMemo, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useDocumentStore, artboardSize } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { ASSET_CATEGORIES, ASSET_LIBRARY } from '../../lib/assets/library'
import type { AssetDefinition } from '../../lib/assets/types'
import { captureAsset, loadUserAssets, saveUserAssets } from '../../lib/assets/userAssets'
import { AssetThumbnail } from './AssetThumbnail'
import { ASSET_MIME } from './assetDrag'
import './AssetsPanel.css'

const round = (v: number) => Math.round(v * 10) / 10

/**
 * Ready-made objects to drop into a project, Figma-style: the built-in
 * library plus the user's own assets saved from a selection. Click a card
 * to place it in the middle of the plate, or drag it onto the canvas.
 */
export function AssetsPanel() {
  const addAsset = useDocumentStore((s) => s.addAsset)
  const selection = useDocumentStore((s) => s.selection)
  const bedPresetId = useDocumentStore((s) => s.bedPresetId)
  const customBedWidth = useDocumentStore((s) => s.customBedWidth)
  const customBedHeight = useDocumentStore((s) => s.customBedHeight)
  const setNotice = useViewStore((s) => s.setNotice)
  const [query, setQuery] = useState('')
  const [userAssets, setUserAssets] = useState<AssetDefinition[]>(() => loadUserAssets())
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')

  const place = (asset: AssetDefinition) => {
    const plate = artboardSize({ bedPresetId, customBedWidth, customBedHeight })
    const ids = addAsset(asset, { x: round(plate.width / 2 - asset.width / 2), y: round(plate.height / 2 - asset.height / 2) })
    if (ids.length) setNotice(`Added ${asset.name} to the middle of the plate.`)
  }

  const saveSelection = () => {
    const { layers, order, selection: sel } = useDocumentStore.getState()
    const asset = captureAsset(draftName, layers, order, sel)
    if (!asset) return
    const next = [asset, ...userAssets]
    setUserAssets(next)
    saveUserAssets(next)
    setSaving(false)
    setDraftName('')
    setNotice(`Saved "${asset.name}" to My assets. It is kept in this browser.`)
  }

  const removeUserAsset = (id: string) => {
    const next = userAssets.filter((a) => a.id !== id)
    setUserAssets(next)
    saveUserAssets(next)
  }

  const q = query.trim().toLowerCase()
  const matches = (a: AssetDefinition) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
  const sections = useMemo(() => {
    const out: { title: string; assets: AssetDefinition[]; mine?: boolean }[] = []
    const mine = userAssets.filter(matches)
    if (mine.length) out.push({ title: 'My assets', assets: mine, mine: true })
    for (const category of ASSET_CATEGORIES) {
      const assets = ASSET_LIBRARY.filter((a) => a.category === category && matches(a))
      if (assets.length) out.push({ title: category, assets })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAssets, q])

  return (
    <div className="assets-panel">
      <div className="assets-panel__header">
        <span className="assets-panel__title">Assets</span>
        {selection.length > 0 && !saving && (
          <button
            type="button"
            className="assets-panel__save"
            onClick={() => {
              const { layers } = useDocumentStore.getState()
              setDraftName(selection.length === 1 ? (layers[selection[0]]?.name ?? 'My asset') : 'My asset')
              setSaving(true)
            }}
          >
            <Plus size={13} /> Save selection
          </button>
        )}
      </div>
      {saving && (
        <form
          className="assets-panel__save-form"
          onSubmit={(e) => {
            e.preventDefault()
            saveSelection()
          }}
        >
          <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Asset name" aria-label="Asset name" />
          <button type="submit" className="assets-panel__save-confirm">
            Save
          </button>
          <button type="button" className="assets-panel__save-cancel" onClick={() => setSaving(false)}>
            Cancel
          </button>
        </form>
      )}
      <label className="assets-panel__search">
        <Search size={13} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets" aria-label="Search assets" />
      </label>

      <div className="assets-panel__scroll">
        {sections.length === 0 && <p className="assets-panel__empty">Nothing matches "{query}".</p>}
        {sections.map((section) => (
          <section key={section.title} className="assets-section">
            <h3 className="assets-section__title">
              {section.title}
              <span className="assets-section__count">{section.assets.length}</span>
            </h3>
            <div className="assets-grid">
              {section.assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="asset-card"
                  title={`${asset.description}\nClick to add, or drag onto the canvas.`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(ASSET_MIME, JSON.stringify(asset))
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => place(asset)}
                >
                  <AssetThumbnail asset={asset} />
                  <span className="asset-card__name">{asset.name}</span>
                  <span className="asset-card__size">
                    {round(asset.width)} × {round(asset.height)} mm
                  </span>
                  {section.mine && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="asset-card__delete"
                      aria-label={`Delete ${asset.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeUserAsset(asset.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                          removeUserAsset(asset.id)
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
        <p className="assets-panel__hint">Every asset is made of ordinary shapes: after placing one, edit any part like you drew it. Select shapes and press "Save selection" to keep your own.</p>
      </div>
    </div>
  )
}
