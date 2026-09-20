import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { CATEGORIES, listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { isNetworkError } from '../lib/connectivity'
import { useAuthStore } from '../features/auth/useAuthStore'
import { PageHeader } from './HomeLayout'
import { CommunityCard } from '../features/community/CommunityCard'
import '../features/community/community.css'
import './HomePage.css'

/** `/community`: every published model, searchable; "Mine" for the
 * signed-in author's own (including hidden ones). */
export function CommunityModelsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const query = params.get('q') ?? ''
  const mine = params.get('mine') === '1' && user !== null
  const sort = params.get('sort') === 'popular' ? 'popular' : 'newest'
  const category = params.get('category') ?? ''
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(query)

  useEffect(() => setDraft(query), [query])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    setItems(null)
    listCommunityItems({ query, ownerId: mine ? user?.id : undefined, sort, category: category || undefined })
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
  }, [query, mine, sort, category, user?.id])

  const setQuery = (q: string) => {
    const next = new URLSearchParams(params)
    if (q.trim()) next.set('q', q.trim())
    else next.delete('q')
    setParams(next, { replace: true })
  }
  const setCategory = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('category', v)
    else next.delete('category')
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
      <PageHeader title="Community models" hint="Everything people shared. Open a copy and make it yours.">
        <button type="button" className="page__button" onClick={() => navigate('/community')}>
          Overview
        </button>
        <button type="button" className="page__button" onClick={() => navigate('/community/collections')}>
          Collections
        </button>
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
              <input value={draft} placeholder="Search titles, descriptions and tags" aria-label="Search models" onChange={(e) => setDraft(e.target.value)} onBlur={() => setQuery(draft)} />
            </form>
            <div className="community-filter" role="group" aria-label="Sort">
              <button type="button" aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>
                Newest
              </button>
              <button type="button" aria-pressed={sort === 'popular'} onClick={() => setSort('popular')}>
                Popular
              </button>
            </div>
            {user && (
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
          <div className="category-row" role="group" aria-label="Category">
            <button type="button" className="category-badge" aria-pressed={!category} onClick={() => setCategory('')}>
              All
            </button>
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className="category-badge" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          {!isSupabaseConfigured ? (
            <div className="community-empty">This build has no Supabase project, so there is no community to browse.</div>
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
