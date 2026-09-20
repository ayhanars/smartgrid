import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Bookmark, Globe } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { listMyCollections, type Collection } from '../lib/supabase/collections'
import { useAuthStore } from '../features/auth/useAuthStore'
import { useProjects } from '../features/projects/useProjects'
import { ProjectBanners, ProjectGrid } from '../features/projects/ProjectCards'
import { CommunityCard } from '../features/community/CommunityCard'
import { CollectionCard } from '../features/community/CollectionCard'
import { PageHeader } from './HomeLayout'
import '../features/community/community.css'
import './HomePage.css'

const RECENT_PROJECTS = 8
const RECENT_COMMUNITY = 8
const RECENT_COLLECTIONS = 4

/** `/`: the newest of everything: your projects, what the community
 * shared, your collections. */
export function RecentsPage() {
  const navigate = useNavigate()
  const projects = useProjects()
  const user = useAuthStore((s) => s.user)
  const [community, setCommunity] = useState<CommunityItem[] | null>(null)
  const [collections, setCollections] = useState<Collection[] | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured || !projects.online) return
    let cancelled = false
    listCommunityItems({ limit: RECENT_COMMUNITY })
      .then((list) => !cancelled && setCommunity(list))
      .catch(() => !cancelled && setCommunity([]))
    return () => {
      cancelled = true
    }
  }, [projects.online])

  useEffect(() => {
    if (!isSupabaseConfigured || !user || !projects.online) {
      setCollections(null)
      return
    }
    let cancelled = false
    listMyCollections()
      .then((list) => !cancelled && setCollections(list))
      .catch(() => !cancelled && setCollections([]))
    return () => {
      cancelled = true
    }
  }, [user, projects.online])

  return (
    <div>
      <PageHeader title="Recents" hint="Pick up where you left off." />
      <ProjectBanners projects={projects} />

      <section className="page__section">
        <div className="page__section-header">
          <h2>Projects</h2>
          <span className="home__hint">{projects.entries.length === 0 ? 'Nothing yet' : `${projects.entries.length} project${projects.entries.length === 1 ? '' : 's'}`}</span>
          {projects.entries.length > RECENT_PROJECTS && (
            <button type="button" className="home__see-all" onClick={() => navigate('/projects')}>
              All projects
              <ArrowRight size={13} />
            </button>
          )}
        </div>
        <ProjectGrid projects={projects} limit={RECENT_PROJECTS} />
      </section>

      {isSupabaseConfigured && user && collections && collections.length > 0 && (
        <section className="page__section">
          <div className="page__section-header">
            <h2>Collections</h2>
            <span className="home__hint">Models you saved for later.</span>
            <button type="button" className="home__see-all" onClick={() => navigate('/collections')}>
              All collections
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="home__grid">
            {collections.slice(0, RECENT_COLLECTIONS).map((c) => (
              <CollectionCard key={c.id} collection={c} onOpen={() => navigate(`/collections/${c.id}`)} />
            ))}
          </div>
        </section>
      )}

      {isSupabaseConfigured && (
        <section className="page__section">
          <div className="page__section-header">
            <h2>New in the community</h2>
            <span className="home__hint">Models people shared. Open a copy and make it yours.</span>
            <button type="button" className="home__see-all" onClick={() => navigate('/community')}>
              Browse all
              <ArrowRight size={13} />
            </button>
          </div>
          {!projects.online ? (
            <div className="community-empty">The community needs a connection.</div>
          ) : community === null ? (
            <div className="community-empty">Loading…</div>
          ) : community.length === 0 ? (
            <div className="home__cloud">
              <Globe size={22} />
              <div>
                <strong>Nothing shared yet</strong>
                <p>Open a project and press “Publish to community” to share a copy with everyone.</p>
              </div>
            </div>
          ) : (
            <div className="home__grid">
              {community.map((item) => (
                <CommunityCard key={item.id} item={item} onOpen={() => navigate(`/c/${item.id}`)} />
              ))}
            </div>
          )}
        </section>
      )}

      {isSupabaseConfigured && user && collections && collections.length === 0 && (
        <section className="page__section">
          <div className="home__cloud">
            <Bookmark size={22} />
            <div>
              <strong>No collections yet</strong>
              <p>Save community models into collections such as “IKEA organizers” or “desk gadgets” with the bookmark button on a model.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
