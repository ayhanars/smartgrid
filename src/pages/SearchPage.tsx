import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { listCommunityItems, searchProfiles, type CommunityItem } from '../lib/supabase/community'
import { listPublicCollections, type Collection } from '../lib/supabase/collections'
import { useProjects } from '../features/projects/useProjects'
import { ProjectGrid } from '../features/projects/ProjectCards'
import { CommunityCard, Avatar } from '../features/community/CommunityCard'
import { CollectionCard } from '../features/community/CollectionCard'
import { PageHeader } from './HomeLayout'
import '../features/community/community.css'
import './HomePage.css'

type Person = { id: string; displayName: string; avatarUrl: string | null; level: number }

/** `/search?q=`: your projects, community models, public collections and
 * people, all matched against one query. */
export function SearchPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [draft, setDraft] = useState(query)
  const projects = useProjects()
  const [models, setModels] = useState<CommunityItem[] | null>(null)
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [people, setPeople] = useState<Person[] | null>(null)

  useEffect(() => setDraft(query), [query])
  useEffect(() => {
    if (!isSupabaseConfigured || !query.trim()) {
      setModels([])
      setCollections([])
      setPeople([])
      return
    }
    let cancelled = false
    setModels(null)
    setCollections(null)
    setPeople(null)
    listCommunityItems({ query, limit: 24 })
      .then((l) => !cancelled && setModels(l))
      .catch(() => !cancelled && setModels([]))
    listPublicCollections(query, 12)
      .then((l) => !cancelled && setCollections(l))
      .catch(() => !cancelled && setCollections([]))
    searchProfiles(query)
      .then((l) => !cancelled && setPeople(l))
      .catch(() => !cancelled && setPeople([]))
    return () => {
      cancelled = true
    }
  }, [query])

  const q = query.trim().toLowerCase()
  const matchingProjects = { ...projects, entries: q ? projects.entries.filter((e) => e.name.toLowerCase().includes(q)) : [] }
  const nothing = q && matchingProjects.entries.length === 0 && models?.length === 0 && collections?.length === 0 && people?.length === 0

  return (
    <div>
      <PageHeader title="Search" hint="Your projects, community models, collections and people." />
      <form
        className="community-search"
        style={{ maxWidth: 560, marginBottom: 24 }}
        onSubmit={(e) => {
          e.preventDefault()
          const next = new URLSearchParams(params)
          if (draft.trim()) next.set('q', draft.trim())
          else next.delete('q')
          setParams(next, { replace: true })
        }}
      >
        <Search size={15} />
        <input value={draft} autoFocus placeholder="Search everything" aria-label="Search" onChange={(e) => setDraft(e.target.value)} />
      </form>
      {!q ? (
        <div className="community-empty">Type something to search.</div>
      ) : nothing ? (
        <div className="community-empty">Nothing matches “{query}”.</div>
      ) : (
        <>
          {matchingProjects.entries.length > 0 && (
            <section className="page__section">
              <div className="page__section-header">
                <h2>Your projects</h2>
                <span className="home__hint">{matchingProjects.entries.length} match{matchingProjects.entries.length === 1 ? '' : 'es'}</span>
              </div>
              <ProjectGrid projects={matchingProjects} showNew={false} />
            </section>
          )}
          {people && people.length > 0 && (
            <section className="page__section">
              <div className="page__section-header">
                <h2>People</h2>
              </div>
              <div className="people-list">
                {people.map((p) => (
                  <button key={p.id} type="button" className="people-list__item" onClick={() => navigate(`/u/${p.id}`)}>
                    <Avatar name={p.displayName} url={p.avatarUrl} large />
                    <span>{p.displayName}</span>
                    <span className="level-badge">L{p.level}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {(models === null || models.length > 0) && (
            <section className="page__section">
              <div className="page__section-header">
                <h2>Community models</h2>
                {models && <span className="home__hint">{models.length} match{models.length === 1 ? '' : 'es'}</span>}
              </div>
              {models === null ? (
                <div className="community-empty">Searching…</div>
              ) : (
                <div className="home__grid">
                  {models.map((item) => (
                    <CommunityCard key={item.id} item={item} onOpen={() => navigate(`/c/${item.id}`)} />
                  ))}
                </div>
              )}
            </section>
          )}
          {collections && collections.length > 0 && (
            <section className="page__section">
              <div className="page__section-header">
                <h2>Collections</h2>
              </div>
              <div className="collection-grid">
                {collections.map((c) => (
                  <CollectionCard key={c.id} collection={c} onOpen={() => navigate(`/collections/${c.id}`)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
