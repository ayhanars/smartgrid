import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bookmark, Plus } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { createCollection, listMyCollections, type Collection } from '../lib/supabase/collections'
import { useAuthStore } from '../features/auth/useAuthStore'
import { CollectionCard } from '../features/community/CollectionCard'
import { PageHeader } from './HomeLayout'
import '../features/community/community.css'
import './HomePage.css'

/** `/collections`: the signed-in user's collections. */
export function CollectionsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured || (!loading && !user)) navigate('/', { replace: true })
  }, [loading, user, navigate])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    listMyCollections()
      .then((list) => !cancelled && setCollections(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load collections'))
    return () => {
      cancelled = true
    }
  }, [user])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const c = await createCollection(name)
      setCollections((list) => [c, ...(list ?? [])])
      setCreating(false)
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the collection')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Collections" hint="Community models you saved, grouped the way you like.">
        <button type="button" className="page__button page__button--primary" onClick={() => setCreating(true)}>
          <Plus size={14} />
          New collection
        </button>
      </PageHeader>
      {creating && (
        <form className="community-toolbar" onSubmit={create}>
          <label className="community-search">
            <Bookmark size={14} />
            <input value={name} autoFocus maxLength={80} placeholder="Collection name, e.g. IKEA organizers" aria-label="Collection name" onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="page__button page__button--primary" disabled={busy || !name.trim()}>
            Create
          </button>
          <button type="button" className="page__button" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}
      {error && <p className="account__error">{error}</p>}
      {collections === null ? (
        <div className="community-empty">Loading…</div>
      ) : collections.length === 0 ? (
        <div className="home__cloud">
          <Bookmark size={22} />
          <div>
            <strong>No collections yet</strong>
            <p>Use the bookmark button on any community model to save it into a collection, or create one here first.</p>
          </div>
        </div>
      ) : (
        <div className="collection-grid">
          {collections.map((c) => (
            <CollectionCard key={c.id} collection={c} onOpen={() => navigate(`/collections/${c.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}
