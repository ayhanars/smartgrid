import { useMemo, useState } from 'react'
import { Cloud, CloudOff, LayoutGrid, List, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useDocumentStore, artboardSize } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { ASSET_CATEGORIES, ASSET_LIBRARY } from '../../lib/assets/library'
import type { AssetDefinition } from '../../lib/assets/types'
import { captureAsset } from '../../lib/assets/userAssets'
import { useUserAssets } from '../../state/userAssetsStore'
import { isGuest, requireAccount } from '../auth/authGate'
import { AssetThumbnail } from './AssetThumbnail'
import { AssetPreview3D } from './AssetPreview3D'
import { ASSET_MIME } from './assetDrag'
import './AssetsPanel.css'

const round = (v: number) => Math.round(v * 10) / 10

const VIEW_KEY = 'smartgrid:assets:view'
const readView = (): string | null => {
  try {
    return localStorage.getItem(VIEW_KEY)
  } catch {
    return null
  }
}

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
  const userAssets = useUserAssets((s) => s.assets)
  const assetStatus = useUserAssets((s) => s.status)
  const addUserAsset = useUserAssets((s) => s.add)
  const removeUserAsset = useUserAssets((s) => s.remove)
  const renameUserAsset = useUserAssets((s) => s.rename)
  const [view, setView] = useState<'grid' | 'list'>(() => (readView() === 'list' ? 'list' : 'grid'))
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const changeView = (v: 'grid' | 'list') => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* preference just won't stick */
    }
  }
  const startRename = (asset: AssetDefinition) => {
    setRenamingId(asset.id)
    setRenameDraft(asset.name)
  }
  const commitRename = () => {
    if (renamingId) renameUserAsset(renamingId, renameDraft)
    setRenamingId(null)
  }
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
    addUserAsset(asset)
    setSaving(false)
    setDraftName('')
    setNotice(isGuest() ? `Saved "${asset.name}" to My assets. It is kept in this browser only until you sign in.` : `Saved "${asset.name}" to My assets. It is available in all your projects.`)
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
        <span className="assets-panel__view" role="group" aria-label="View">
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} title="Grid" onClick={() => changeView('grid')}>
            <LayoutGrid size={13} />
          </button>
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} title="List" onClick={() => changeView('list')}>
            <List size={13} />
          </button>
        </span>
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
              {section.mine && isGuest() && (
                <button type="button" className="assets-section__sync assets-section__sync--off" title="Kept in this browser only. Sign in to use them in every project and on every device." onClick={() => requireAccount('assets')}>
                  <CloudOff size={11} />
                  this browser only
                </button>
              )}
              {section.mine && !isGuest() && assetStatus !== 'off' && (
                <span className={`assets-section__sync ${assetStatus === 'synced' ? '' : 'assets-section__sync--off'}`} title={assetStatus === 'synced' ? 'Synced to your account' : assetStatus === 'syncing' ? 'Syncing…' : 'Not synced yet: the cloud could not be reached. Your assets are safe in this browser.'}>
                  {assetStatus === 'synced' ? <Cloud size={11} /> : <CloudOff size={11} />}
                  {assetStatus === 'synced' ? 'synced' : assetStatus === 'syncing' ? 'syncing…' : 'not synced'}
                </span>
              )}
            </h3>
            <div className={`assets-grid ${view === 'list' ? 'assets-grid--list' : ''}`}>
              {section.assets.map((asset) => (
                <div
                  key={asset.id}
                  role="button"
                  tabIndex={0}
                  className={`asset-card ${view === 'list' ? 'asset-card--row' : ''}`}
                  title={`${asset.description}\nClick to add, or drag onto the canvas.`}
                  draggable={renamingId !== asset.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(ASSET_MIME, JSON.stringify(asset))
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => renamingId !== asset.id && place(asset)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setHoverId(asset.id)}
                  onPointerLeave={() => setHoverId((h) => (h === asset.id ? null : h))}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                      e.preventDefault()
                      place(asset)
                    }
                  }}
                >
                  <span className="asset-card__preview">
                    <AssetThumbnail asset={asset} />
                    {hoverId === asset.id && (
                      <span className="asset-card__preview-3d" aria-hidden>
                        <AssetPreview3D asset={asset} />
                      </span>
                    )}
                  </span>
                  <span className="asset-card__text">
                    {renamingId === asset.id ? (
                      <input
                        className="asset-card__rename"
                        value={renameDraft}
                        autoFocus
                        aria-label="Asset name"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          else if (e.key === 'Escape') setRenamingId(null)
                          e.stopPropagation()
                        }}
                      />
                    ) : (
                      <span className="asset-card__name">{asset.name}</span>
                    )}
                    <span className="asset-card__size">
                      {round(asset.width)} × {round(asset.height)} mm
                    </span>
                  </span>
                  {section.mine && (
                    <span className="asset-card__actions">
                      <span
                        role="button"
                        tabIndex={0}
                        className="asset-card__action"
                        aria-label={`Rename ${asset.name}`}
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation()
                          startRename(asset)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                            startRename(asset)
                          }
                        }}
                      >
                        <Pencil size={12} />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="asset-card__action asset-card__action--danger"
                        aria-label={`Delete ${asset.name}`}
                        title="Delete"
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
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="assets-panel__hint">Every asset is made of ordinary shapes: after placing one, edit any part like you drew it. Select shapes and press "Save selection", or right-click a layer or group and choose "Save as asset", to keep your own.</p>
      </div>
    </div>
  )
}
