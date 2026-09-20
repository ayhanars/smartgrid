import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Calendar, Heart, UserPlus, UserMinus, Users } from 'lucide-react'
import { isFollowing, loadProfile, setFollowing, type Profile } from '../lib/supabase/profiles'
import { listCommunityItems, type CommunityItem } from '../lib/supabase/community'
import { listPublicCollections, type Collection } from '../lib/supabase/collections'
import { useAuthStore } from '../features/auth/useAuthStore'
import { requireAccount } from '../features/auth/authGate'
import { Avatar, CommunityCard } from '../features/community/CommunityCard'
import { CollectionCard } from '../features/community/CollectionCard'
import '../features/community/community.css'
import './HomePage.css'
import './ProfilePage.css'

/** `/u/:id`: a person's public page: their approved models, public
 * collections, level and follow button. */
export function ProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const me = useAuthStore((s) => s.user)
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [items, setItems] = useState<CommunityItem[] | null>(null)
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [following, setFollowingState] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    loadProfile(id)
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setProfile(null))
    listCommunityItems({ ownerId: id })
      .then((l) => !cancelled && setItems(l.filter((i) => i.status === 'published' && i.approval === 'approved')))
      .catch(() => !cancelled && setItems([]))
    listPublicCollections('', 24, id)
      .then((l) => !cancelled && setCollections(l))
      .catch(() => !cancelled && setCollections([]))
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!id || !me) {
      setFollowingState(false)
      return
    }
    isFollowing(id)
      .then(setFollowingState)
      .catch(() => undefined)
  }, [id, me])

  const toggleFollow = async () => {
    if (!id || !profile || !requireAccount('social') || busy) return
    const next = !following
    setBusy(true)
    setFollowingState(next)
    setProfile({ ...profile, followers: profile.followers + (next ? 1 : -1) })
    try {
      await setFollowing(id, next)
    } catch (err) {
      console.warn('Follow failed', err)
      setFollowingState(!next)
      setProfile({ ...profile })
    } finally {
      setBusy(false)
    }
  }

  if (profile === undefined) return <div className="community-empty">Loading…</div>
  if (profile === null) return <div className="community-empty">This person does not exist.</div>
  const isMe = me?.id === profile.id
  const likes = (items ?? []).reduce((n, i) => n + i.likes, 0)

  return (
    <div>
      <div className="profile">
        <Avatar name={profile.displayName} url={profile.avatarUrl} large />
        <div className="profile__text">
          <h1>
            {profile.displayName} <span className="level-badge">L{profile.level}</span>
            {profile.role !== 'user' && <span className="profile__role">{profile.role}</span>}
          </h1>
          {profile.bio && <p className="profile__bio">{profile.bio}</p>}
          <div className="profile__stats">
            <span>
              <Users size={12} /> {profile.followers} follower{profile.followers === 1 ? '' : 's'} · {profile.following} following
            </span>
            <span>
              <Heart size={12} /> {likes} like{likes === 1 ? '' : 's'} on {items?.length ?? 0} model{(items?.length ?? 0) === 1 ? '' : 's'}
            </span>
            <span>
              <Calendar size={12} /> joined {new Date(profile.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        {isMe ? (
          <button type="button" className="page__button" onClick={() => navigate('/account')}>
            Edit profile
          </button>
        ) : (
          <button type="button" className={`page__button ${following ? '' : 'page__button--primary'}`} disabled={busy} onClick={() => void toggleFollow()}>
            {following ? <UserMinus size={14} /> : <UserPlus size={14} />}
            {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      <section className="page__section">
        <div className="page__section-header">
          <h2>Models</h2>
          <span className="home__hint">{items ? `${items.length} shared` : 'Loading…'}</span>
        </div>
        {items && items.length === 0 ? (
          <div className="community-empty">Nothing shared yet.</div>
        ) : (
          <div className="home__grid">
            {(items ?? []).map((item) => (
              <CommunityCard key={item.id} item={item} onOpen={() => navigate(`/c/${item.id}`)} />
            ))}
          </div>
        )}
      </section>

      {collections && collections.length > 0 && (
        <section className="page__section">
          <div className="page__section-header">
            <h2>Public collections</h2>
          </div>
          <div className="collection-grid">
            {collections.map((c) => (
              <CollectionCard key={c.id} collection={c} onOpen={() => navigate(`/collections/${c.id}`)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
