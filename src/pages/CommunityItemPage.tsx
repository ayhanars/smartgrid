import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Box, Calendar, Copy, Download, Eye, EyeOff, Layers, MessageCircle, Pencil, Star, Trash2 } from 'lucide-react'
import {
  deleteCommunityItem,
  getCommunityItem,
  moderateCommunityItem,
  parseTags,
  recordCommunityDownload,
  updateCommunityItem,
  type CommunityItemFull,
} from '../lib/supabase/community'
import { createLocalProject } from '../lib/persistence/localProjects'
import { saveLocalThumbnail } from '../lib/persistence/thumbnails'
import { isNetworkError } from '../lib/connectivity'
import { isStaffRole, useAuthStore } from '../features/auth/useAuthStore'
import { CollectionPicker, CommentsSection, LikeButton } from '../features/community/Social'
import { Avatar } from '../features/community/CommunityCard'
import { ProjectPreview3D } from './ProjectPreview3D'
import '../features/community/community.css'
import './HomePage.css'
import './AccountPage.css'

/** `/c/:id`: one shared model. Anyone can open a copy; the author edits
 * the listing, hides or removes it; staff moderate. */
export function CommunityItemPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const [item, setItem] = useState<CommunityItemFull | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getCommunityItem(id)
      .then((it) => !cancelled && setItem(it))
      .catch((err: unknown) => {
        if (!cancelled) {
          setItem(null)
          setError(isNetworkError(err) ? 'No connection.' : err instanceof Error ? err.message : 'Could not load this model')
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const isOwner = item !== null && item !== undefined && user?.id === item.ownerId
  const staff = isStaffRole(profile)

  const openCopy = () => {
    if (!item) return
    const meta = createLocalProject({ ...item.data, name: item.title })
    if (item.thumbnail) saveLocalThumbnail(meta.id, item.thumbnail)
    void recordCommunityDownload(item.id)
    navigate(`/p/${meta.id}`)
  }

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
  const setStatus = (status: 'published' | 'hidden') =>
    act(async () => {
      if (!item) return
      const next = await updateCommunityItem(item.id, { status })
      setItem({ ...item, ...next })
    })
  const remove = () =>
    act(async () => {
      if (!item) return
      if (!window.confirm(`Remove "${item.title}" from the community? People who already opened a copy keep theirs.`)) return
      await deleteCommunityItem(item.id)
      navigate('/community')
    })
  const moderate = (patch: { status?: 'published' | 'hidden' | 'removed'; featured?: boolean }) =>
    act(async () => {
      if (!item) return
      const next = await moderateCommunityItem(item.id, patch)
      setItem({ ...item, ...next })
    })

  return (
    <div>
      <button type="button" className="account__back" style={{ marginBottom: 12 }} onClick={() => navigate('/community')}>
        <ArrowLeft size={15} />
        Community
      </button>
      <div>
        {item === undefined ? (
          <div className="community-empty">Loading…</div>
        ) : item === null ? (
          <div className="community-empty">{error ?? 'This model is not available (it may have been removed).'}</div>
        ) : (
          <div className="community-item">
            <div className="community-item__hero">
              {live ? (
                <div>
                  <ProjectPreview3D snapshot={item.data} />
                </div>
              ) : item.thumbnail ? (
                <img src={item.thumbnail} alt="" />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>
                  <Box size={40} />
                </div>
              )}
              <button type="button" className="community-item__hero-toggle" onClick={() => setLive((v) => !v)}>
                {live ? 'Show picture' : 'Spin in 3D'}
              </button>
            </div>

            <div className="community-item__side">
              <h1>{item.title}</h1>
              <div className="community-item__author">
                <Avatar name={item.author.displayName} url={item.author.avatarUrl} large />
                <span>{item.author.displayName}</span>
                {item.featured && (
                  <span title="Featured by the moderators" style={{ color: 'var(--warning)', display: 'inline-flex' }}>
                    <Star size={14} />
                  </span>
                )}
              </div>
              <div className="community-item__stats">
                <span>
                  <Download size={12} />
                  {item.downloads} {item.downloads === 1 ? 'copy opened' : 'copies opened'}
                </span>
                <span>
                  <MessageCircle size={12} />
                  {item.comments} comment{item.comments === 1 ? '' : 's'}
                </span>
                <span>
                  <Layers size={12} />
                  {item.shapeCount} shape{item.shapeCount === 1 ? '' : 's'}
                </span>
                <span>
                  <Calendar size={12} />
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
                {item.status !== 'published' && <span style={{ color: 'var(--warning)' }}>{item.status}</span>}
              </div>
              {item.tags.length > 0 && (
                <div className="community-item__tags">
                  {item.tags.map((t) => (
                    <button key={t} type="button" onClick={() => navigate(`/community?q=${encodeURIComponent(t)}`)}>
                      #{t}
                    </button>
                  ))}
                </div>
              )}
              {item.description && <p className="community-item__desc">{item.description}</p>}

              <button type="button" className="community-item__open" onClick={openCopy}>
                <Copy size={15} />
                Open a copy in the editor
              </button>
              <div className="social-row">
                <LikeButton itemId={item.id} count={item.likes} onCount={(likes) => setItem({ ...item, likes })} />
                <CollectionPicker itemId={item.id} />
              </div>
              <p className="community-item__hint">The copy is yours: it lands in your projects and edits never touch the shared model.</p>

              {item.notes && (
                <div className="community-item__notes">
                  <h2>Notes from {isOwner ? 'you' : item.author.displayName}</h2>
                  <p>{item.notes}</p>
                </div>
              )}

              {isOwner && (
                <div className="community-item__owner">
                  <h2>Your listing</h2>
                  {editing ? (
                    <EditForm
                      item={item}
                      busy={busy}
                      onCancel={() => setEditing(false)}
                      onSave={(patch) =>
                        act(async () => {
                          const next = await updateCommunityItem(item.id, patch)
                          setItem({ ...item, ...next })
                          setEditing(false)
                        })
                      }
                    />
                  ) : (
                    <div className="community-item__owner-actions">
                      <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                        <Pencil size={13} />
                        Edit texts
                      </button>
                      {item.status === 'published' ? (
                        <button type="button" disabled={busy} onClick={() => void setStatus('hidden')}>
                          <EyeOff size={13} />
                          Hide
                        </button>
                      ) : (
                        item.status === 'hidden' && (
                          <button type="button" disabled={busy} onClick={() => void setStatus('published')}>
                            <Eye size={13} />
                            Publish again
                          </button>
                        )
                      )}
                      <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </div>
                  )}
                  <p className="community-item__hint">To replace the shared model with a newer version, open the source project and choose “Community listing” from its menu.</p>
                </div>
              )}

              {staff && !isOwner && (
                <div className="community-item__owner">
                  <h2>Moderation</h2>
                  <div className="community-item__owner-actions">
                    <button type="button" disabled={busy} onClick={() => void moderate({ featured: !item.featured })}>
                      <Star size={13} />
                      {item.featured ? 'Unfeature' : 'Feature'}
                    </button>
                    {item.status === 'published' ? (
                      <button type="button" disabled={busy} onClick={() => void moderate({ status: 'hidden' })}>
                        <EyeOff size={13} />
                        Hide
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => void moderate({ status: 'published' })}>
                        <Eye size={13} />
                        Publish
                      </button>
                    )}
                    {item.status !== 'removed' && (
                      <button type="button" className="danger" disabled={busy} onClick={() => void moderate({ status: 'removed' })}>
                        <Trash2 size={13} />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
              {error && <p className="account__error" role="alert">{error}</p>}
            </div>
            <CommentsSection itemId={item.id} ownerId={item.ownerId} onCount={(comments) => setItem((it) => (it ? { ...it, comments } : it))} />
          </div>
        )}
      </div>
    </div>
  )
}

function EditForm({ item, busy, onCancel, onSave }: { item: CommunityItemFull; busy: boolean; onCancel: () => void; onSave: (patch: { title: string; description: string; notes: string; tags: string[] }) => void }) {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description)
  const [notes, setNotes] = useState(item.notes)
  const [tags, setTags] = useState(item.tags.join(', '))
  return (
    <form
      className="community-item__edit"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ title: title.trim() || item.title, description: description.trim(), notes: notes.trim(), tags: parseTags(tags) })
      }}
    >
      <label htmlFor="ci-title">Title</label>
      <input id="ci-title" value={title} maxLength={80} required onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="ci-desc">Short description</label>
      <input id="ci-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
      <label htmlFor="ci-notes">Notes</label>
      <textarea id="ci-notes" value={notes} rows={4} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      <label htmlFor="ci-tags">Tags</label>
      <input id="ci-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      <div className="community-item__owner-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          Save
        </button>
      </div>
    </form>
  )
}
