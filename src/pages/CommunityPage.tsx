import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { isNetworkError } from '../lib/connectivity'
import { useAuthStore } from '../features/auth/useAuthStore'
import { PageHeader } from './HomeLayout'
import { CommunityCard } from '../features/community/CommunityCard'
import { CollectionCard } from '../features/community/CollectionCard'
import { listPublicCollections, type Collection } from '../lib/supabase/collections'
import '../features/community/community.css'
import './HomePage.css'

/** `/community`: every published model, searchable; "Mine" for the
 * signed-in author's own (including hidden ones). */
export function CommunityPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const query = params.get('q') ?? ''
  const mine = params.get('mine') === '1' && user !== null
  const sort = params.get('sort') === 'popular' ? 'popular' : 'newest'
  const view = params.get('view') === 'collections' ? 'collections' : 'models'
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(query)

  useEffect(() => setDraft(query), [query])

  useEffect(() => {
    if (!isSupabaseConfigured || view !== 'collections') return
    let cancelled = false
    setCollections(null)
    listPublicCollections(query)
      .then((list) => !cancelled && setCollections(list))
      .catch((err: unknown) => !cancelled && setError(isNetworkError(err) ? 'No connection.' : err instanceof Error ? err.message : 'Could not load collections'))
    return () => {
      cancelled = true
    }
  }, [query, view])

  useEffect(() => {
    if (!isSupabaseConfigured || view !== 'models') return
    let cancelled = false
    setItems(null)
    listCommunityItems({ query, ownerId: mine ? user?.id : undefined, sort })
      .then((list) => {
        if (!cancelled) {
          setItems(list)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(isNetworkError(err) ? 'No connection. The community needs a network.' : err instanceof Error ? err.message : 'Could not load the community')
      })
    return () => {
      cancelled = true
    }
  }, [query, mine, sort, view, user?.id])

  const setQuery = (q: string) => {
    const next = new URLSearchParams(params)
    if (q.trim()) next.set('q', q.trim())
    else next.delete('q')
    setParams(next, { replace: true })
  }
  const setView = (v: 'models' | 'collections') => {
    const next = new URLSearchParams(params)
    if (v === 'collections') next.set('view', 'collections')
    else next.delete('view')
    next.delete('mine')
    setParams(next, { replace: true })
  }
  const setSort = (v: 'newest' | 'popular') => {
    const next = new URLSearchParams(params)
    if (v === 'popular') next.set('sort', 'popular')
    else next.delete('sort')
    setParams(next, { replace: true })
  }
  const setMine = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('mine', '1')
    else next.delete('mine')
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader title="Community" hint={view === 'collections' ? 'Collections people made public: curated sets of community models.' : 'Models people shared. Open a copy and make it yours.'}>
        <div className="community-filter" role="group" aria-label="What to browse">
          <button type="button" aria-pressed={view === 'models'} onClick={() => setView('models')}>
            Models
          </button>
          <button type="button" aria-pressed={view === 'collections'} onClick={() => setView('collections')}>
            Collections
          </button>
        </div>
      </PageHeader>
      <section>
          <div className="community-toolbar">
            <form
              className="community-search"
              onSubmit={(e) => {
                e.preventDefault()
                setQuery(draft)
              }}
            >
              <Search size={14} />
              <input value={draft} placeholder={view === 'collections' ? 'Search collections' : 'Search titles, descriptions and tags'} aria-label="Search the community" onChange={(e) => setDraft(e.target.value)} onBlur={() => setQuery(draft)} />
            </form>
            {view === 'collections' ? null : (
            <div className="community-filter" role="group" aria-label="Sort">
              <button type="button" aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>
                Newest
              </button>
              <button type="button" aria-pressed={sort === 'popular'} onClick={() => setSort('popular')}>
                Popular
              </button>
            </div>
            )}
            {view === 'models' && user && (
              <div className="community-filter" role="group" aria-label="Filter">
                <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
                  Everyone
                </button>
                <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
                  Mine
                </button>
              </div>
            )}
          </div>
          {!isSupabaseConfigured ? (
            <div className="community-empty">This build has no Supabase project, so there is no community to browse.</div>
          ) : view === 'collections' ? (
            error ? (
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
            )
          ) : error ? (
            <div className="community-empty">{error}</div>
          ) : items === null ? (
            <div className="community-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="community-empty">{mine ? 'You have not published anything yet. Open a project and choose “Publish to community” from its menu.' : query ? `Nothing matches “${query}”.` : 'Nothing shared yet. Be the first: open a project and choose “Publish to community”.'}</div>
          ) : (
            <div className="home__grid">
              {items.map((item) => (
                <CommunityCard key={item.id} item={item} showStatus={mine} onOpen={() => navigate(`/c/${item.id}`)} />
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
