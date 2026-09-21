import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Globe } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { useConnectivity } from '../lib/connectivity'
import { listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { listPublicCollections, type Collection } from '../lib/supabase/collections'
import { CommunityCard } from '../features/community/CommunityCard'
import { CollectionCard } from '../features/community/CollectionCard'
import { GeneratorsSection } from '../features/create/GeneratorCards'
import { PageHeader } from './HomeLayout'
import '../features/community/community.css'
import './HomePage.css'

const MODELS = 12
const COLLECTIONS = 6

/** `/community`: the newest models and public collections side by side;
 * each section opens its own full page. */
export function CommunityPage() {
  const navigate = useNavigate()
  const online = useConnectivity((s) => s.online)
  const [models, setModels] = useState<CommunityItem[] | null>(null)
  const [popular, setPopular] = useState<CommunityItem[] | null>(null)
  const [collections, setCollections] = useState<Collection[] | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured || !online) return
    let cancelled = false
    listCommunityItems({ limit: MODELS })
      .then((l) => !cancelled && setModels(l))
      .catch(() => !cancelled && setModels([]))
    listCommunityItems({ limit: 6, sort: 'popular' })
      .then((l) => !cancelled && setPopular(l))
      .catch(() => !cancelled && setPopular([]))
    listPublicCollections('', COLLECTIONS)
      .then((l) => !cancelled && setCollections(l))
      .catch(() => !cancelled && setCollections([]))
    return () => {
      cancelled = true
    }
  }, [online])

  if (!isSupabaseConfigured) return <div className="community-empty">This build has no Supabase project, so there is no community to browse.</div>
  if (!online) return <div className="community-empty">The community needs a connection.</div>

  return (
    <div>
      <PageHeader title="Community" hint="Models and collections people shared. Open a copy and make it yours." />

      <div id="generators">
        <GeneratorsSection />
      </div>

      <section className="page__section">
        <div className="page__section-header">
          <h2>New models</h2>
          <span className="home__hint">Latest approved models.</span>
          <button type="button" className="home__see-all" onClick={() => navigate('/community/models')}>
            All models
            <ArrowRight size={13} />
          </button>
        </div>
        {models === null ? (
          <div className="community-empty">Loading…</div>
        ) : models.length === 0 ? (
          <div className="home__cloud">
            <Globe size={22} />
            <div>
              <strong>Nothing shared yet</strong>
              <p>Open a project and press “Publish to community” to share a copy with everyone.</p>
            </div>
          </div>
        ) : (
          <div className="home__grid">
            {models.map((item) => (
              <CommunityCard key={item.id} item={item} onOpen={() => navigate(`/c/${item.id}`)} />
            ))}
          </div>
        )}
      </section>

      {popular && popular.length > 1 && (
        <section className="page__section">
          <div className="page__section-header">
            <h2>Popular</h2>
            <span className="home__hint">Most liked and copied.</span>
            <button type="button" className="home__see-all" onClick={() => navigate('/community/models?sort=popular')}>
              See more
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="home__grid">
            {popular.map((item) => (
              <CommunityCard key={item.id} item={item} onOpen={() => navigate(`/c/${item.id}`)} />
            ))}
          </div>
        </section>
      )}

      <section className="page__section">
        <div className="page__section-header">
          <h2>Collections</h2>
          <span className="home__hint">Curated sets people made public.</span>
          <button type="button" className="home__see-all" onClick={() => navigate('/community/collections')}>
            All collections
            <ArrowRight size={13} />
          </button>
        </div>
        {collections === null ? (
          <div className="community-empty">Loading…</div>
        ) : collections.length === 0 ? (
          <div className="community-empty">No public collections yet. Save models into a collection and make it public from its page.</div>
        ) : (
          <div className="collection-grid">
            {collections.map((c) => (
              <CollectionCard key={c.id} collection={c} onOpen={() => navigate(`/collections/${c.id}`)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
