import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { isNetworkError } from '../lib/connectivity'
import { listPublicCollections, type Collection } from '../lib/supabase/collections'
import { CollectionCard } from '../features/community/CollectionCard'
import { PageHeader } from './HomeLayout'
import '../features/community/community.css'
import './HomePage.css'

/** `/community/collections`: every public, approved collection. */
export function CommunityCollectionsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [draft, setDraft] = useState(query)
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setDraft(query), [query])
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    setCollections(null)
    listPublicCollections(query)
      .then((list) => !cancelled && setCollections(list))
      .catch((err: unknown) => !cancelled && setError(isNetworkError(err) ? 'No connection.' : err instanceof Error ? err.message : 'Could not load collections'))
    return () => {
      cancelled = true
    }
  }, [query])

  const setQuery = (q: string) => {
    const next = new URLSearchParams(params)
    if (q.trim()) next.set('q', q.trim())
    else next.delete('q')
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader title="Community collections" hint="Curated sets of community models people made public.">
        <button type="button" className="page__button" onClick={() => navigate('/community')}>
          Overview
        </button>
        <button type="button" className="page__button" onClick={() => navigate('/community/models')}>
          Models
        </button>
      </PageHeader>
      <div className="community-toolbar">
        <form
          className="community-search"
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(draft)
          }}
        >
          <Search size={14} />
          <input value={draft} placeholder="Search collections" aria-label="Search collections" onChange={(e) => setDraft(e.target.value)} onBlur={() => setQuery(draft)} />
        </form>
      </div>
      {error ? (
        <div className="community-empty">{error}</div>
      ) : collections === null ? (
        <div className="community-empty">Loading…</div>
      ) : collections.length === 0 ? (
        <div className="community-empty">{query ? `No public collection matches “${query}”.` : 'No public collections yet. Make one of yours public from its page once it is approved.'}</div>
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
