import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Globe, Link as LinkIcon, Lock, Pencil, Trash2, X } from 'lucide-react'
import { deleteCollection, getCollection, listCollectionItemIds, setInCollection, updateCollection, type Collection } from '../lib/supabase/collections'
import { listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { useAuthStore } from '../features/auth/useAuthStore'
import { useViewStore } from '../state/viewStore'
import { CommunityCard } from '../features/community/CommunityCard'
import { PageHeader } from './HomeLayout'
import '../features/community/community.css'
import './HomePage.css'
import './AccountPage.css'

/** `/collections/:id`: the models in one collection. The owner renames
 * it, makes it public (shareable by link) and removes models. */
export function CollectionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setNotice = useViewStore((s) => s.setNotice)
  const [collection, setCollection] = useState<Collection | null | undefined>(undefined)
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getCollection(id)
      .then(async (c) => {
        if (cancelled) return
        setCollection(c)
        if (!c) return
        setName(c.name)
        setDescription(c.description)
        const ids = await listCollectionItemIds(c.id)
        const list = await listCommunityItems({ ids })
        if (cancelled) return
        const order = new Map(ids.map((x, i) => [x, i]))
        setItems(list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCollection(null)
        setError(err instanceof Error ? err.message : 'Could not load this collection')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const isOwner = !!collection && user?.id === collection.ownerId

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    act(async () => {
      if (!collection) return
      setCollection(await updateCollection(collection.id, { name: name.trim() || collection.name, description }))
      setEditing(false)
    })
  const togglePublic = () =>
    act(async () => {
      if (!collection) return
      setCollection(await updateCollection(collection.id, { isPublic: !collection.isPublic }))
    })
  const removeItem = (itemId: string) =>
    act(async () => {
      if (!collection) return
      await setInCollection(collection.id, itemId, false)
      setItems((list) => (list ? list.filter((i) => i.id !== itemId) : list))
    })
  const remove = () =>
    act(async () => {
      if (!collection) return
      if (!window.confirm(`Delete the collection "${collection.name}"? The models stay in the community.`)) return
      await deleteCollection(collection.id)
      navigate('/collections')
    })
  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#/collections/${id}`
    void navigator.clipboard?.writeText(url).then(() => setNotice('Link copied.'))
  }

  if (collection === undefined) return <div className="community-empty">Loading…</div>
  if (collection === null) return <div className="community-empty">{error ?? 'This collection is private or was deleted.'}</div>

  return (
    <div>
      <button type="button" className="account__back" style={{ marginBottom: 12 }} onClick={() => navigate(isOwner ? '/collections' : '/community')}>
        <ArrowLeft size={15} />
        {isOwner ? 'Collections' : 'Community'}
      </button>
      {editing ? (
        <form
          className="community-item__edit"
          style={{ maxWidth: 520, marginBottom: 22 }}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label htmlFor="col-name">Name</label>
          <input id="col-name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
          <label htmlFor="col-desc">Description</label>
          <textarea id="col-desc" value={description} rows={2} maxLength={400} onChange={(e) => setDescription(e.target.value)} />
          <div className="community-item__owner-actions">
            <button type="button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <PageHeader title={collection.name} hint={collection.description || `${collection.count} model${collection.count === 1 ? '' : 's'} · by ${collection.owner.displayName}`}>
          {isOwner && (
            <>
              <button type="button" className="page__button" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil size={13} />
                Edit
              </button>
              <button type="button" className="page__button" disabled={busy} title={collection.isPublic ? 'Anyone with the link can see this collection' : 'Only you can see this collection'} onClick={() => void togglePublic()}>
                {collection.isPublic ? <Globe size={13} /> : <Lock size={13} />}
                {collection.isPublic ? 'Public' : 'Private'}
              </button>
              {collection.isPublic && (
                <button type="button" className="page__button" onClick={copyLink}>
                  <LinkIcon size={13} />
                  Copy link
                </button>
              )}
              <button type="button" className="page__button" disabled={busy} onClick={() => void remove()}>
                <Trash2 size={13} />
                Delete
              </button>
            </>
          )}
        </PageHeader>
      )}
      {error && <p className="account__error">{error}</p>}
      {items === null ? (
        <div className="community-empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="community-empty">Nothing saved here yet. Use the bookmark button on a community model.</div>
      ) : (
        <div className="home__grid">
          {items.map((item) => (
            <div key={item.id} className="collection-item">
              <CommunityCard item={item} onOpen={() => navigate(`/c/${item.id}`)} />
              {isOwner && (
                <button type="button" className="collection-item__remove" title="Remove from this collection" aria-label={`Remove ${item.title} from this collection`} disabled={busy} onClick={() => void removeItem(item.id)}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
