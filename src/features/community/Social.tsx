import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bookmark, BookmarkCheck, Check, Heart, Plus, Trash2 } from 'lucide-react'
import { addComment, deleteComment, listComments, listMyLikes, setLiked, type CommunityComment } from '../../lib/supabase/community'
import { collectionsContaining, createCollection, listMyCollections, setInCollection, type Collection } from '../../lib/supabase/collections'
import { isStaffRole, useAuthStore } from '../auth/useAuthStore'
import { requireAccount } from '../auth/authGate'
import { relativeTime } from '../projects/ProjectCards'
import { Avatar } from './CommunityCard'
import '../layers/LayerContextMenu.css'
import './community.css'

/** Heart with the count; toggles for signed-in users. */
export function LikeButton({ itemId, count, onCount }: { itemId: string; count: number; onCount: (n: number) => void }) {
  const user = useAuthStore((s) => s.user)
  const [liked, setLikedState] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) {
      setLikedState(false)
      return
    }
    let cancelled = false
    listMyLikes([itemId])
      .then((set) => !cancelled && setLikedState(set.has(itemId)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [user, itemId])

  const toggle = async () => {
    if (!requireAccount('social') || busy) return
    const next = !liked
    setBusy(true)
    setLikedState(next)
    onCount(count + (next ? 1 : -1))
    try {
      await setLiked(itemId, next)
    } catch (err) {
      console.warn('Like failed', err)
      setLikedState(!next)
      onCount(count)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={`social-btn ${liked ? 'social-btn--liked' : ''}`} aria-pressed={liked} title={liked ? 'Unlike' : 'Like'} onClick={() => void toggle()}>
      <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
      {count}
    </button>
  )
}

/** Bookmark: a popover listing the user's collections with checkmarks,
 * plus a one-line "new collection" form. */
export function CollectionPicker({ itemId }: { itemId: string }) {
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [inside, setInside] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) {
      setInside(new Set())
      return
    }
    let cancelled = false
    collectionsContaining(itemId)
      .then((set) => !cancelled && setInside(set))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [user, itemId])

  useEffect(() => {
    if (!open) return
    listMyCollections()
      .then(setCollections)
      .catch(() => setCollections([]))
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const toggle = async (c: Collection) => {
    const next = !inside.has(c.id)
    setInside((set) => {
      const s = new Set(set)
      if (next) s.add(c.id)
      else s.delete(c.id)
      return s
    })
    try {
      await setInCollection(c.id, itemId, next)
    } catch (err) {
      console.warn('Collection update failed', err)
      setInside((set) => {
        const s = new Set(set)
        if (next) s.delete(c.id)
        else s.add(c.id)
        return s
      })
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const c = await createCollection(name)
      await setInCollection(c.id, itemId, true)
      setCollections((list) => [c, ...(list ?? [])])
      setInside((set) => new Set([...set, c.id]))
      setCreating(false)
      setName('')
    } catch (err) {
      console.warn('Could not create the collection', err)
    } finally {
      setBusy(false)
    }
  }

  const saved = inside.size > 0
  return (
    <div className="social-picker" ref={ref}>
      <button
        type="button"
        className={`social-btn ${saved ? 'social-btn--saved' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Save to a collection"
        onClick={() => {
          if (requireAccount('collections')) setOpen((o) => !o)
        }}
      >
        {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        {saved ? 'Saved' : 'Save'}
      </button>
      {open && (
        <div className="layer-context-menu social-picker__menu" role="menu">
          <div className="social-picker__title">Save to…</div>
          {collections === null ? (
            <div className="social-picker__empty">Loading…</div>
          ) : (
            collections.map((c) => (
              <button key={c.id} type="button" role="menuitemcheckbox" aria-checked={inside.has(c.id)} onClick={() => void toggle(c)}>
                <span className={`social-picker__check ${inside.has(c.id) ? 'social-picker__check--on' : ''}`}>{inside.has(c.id) && <Check size={11} />}</span>
                <span className="social-picker__name">{c.name}</span>
                <span className="social-picker__count">{c.count}</span>
              </button>
            ))
          )}
          {collections !== null && collections.length === 0 && !creating && <div className="social-picker__empty">No collections yet.</div>}
          <div className="layer-context-menu__divider" />
          {creating ? (
            <form className="social-picker__new" onSubmit={create}>
              <input value={name} autoFocus maxLength={80} placeholder="New collection name" aria-label="New collection name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(false)} />
              <button type="submit" disabled={busy || !name.trim()}>
                Add
              </button>
            </form>
          ) : (
            <button type="button" role="menuitem" onClick={() => setCreating(true)}>
              <Plus size={13} />
              New collection…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Comments under a model: everyone reads, signed-in users write, the
 * author / item owner / staff delete. */
export function CommentsSection({ itemId, ownerId, onCount }: { itemId: string; ownerId: string; onCount: (n: number) => void }) {
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const [comments, setComments] = useState<CommunityComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listComments(itemId)
      .then((list) => !cancelled && setComments(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load comments'))
    return () => {
      cancelled = true
    }
  }, [itemId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!requireAccount('social')) return
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const c = await addComment(itemId, body)
      setComments((list) => {
        const next = [...(list ?? []), c]
        onCount(next.length)
        return next
      })
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the comment')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (c: CommunityComment) => {
    if (!window.confirm('Delete this comment?')) return
    try {
      await deleteComment(c.id)
      setComments((list) => {
        const next = (list ?? []).filter((x) => x.id !== c.id)
        onCount(next.length)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the comment')
    }
  }

  const canDelete = (c: CommunityComment) => !!user && (user.id === c.authorId || user.id === ownerId || isStaffRole(profile))

  return (
    <section className="comments">
      <h2>
        Comments <span>{comments?.length ?? ''}</span>
      </h2>
      <form className="comments__form" onSubmit={submit}>
        <textarea
          value={draft}
          rows={2}
          maxLength={2000}
          placeholder={user ? 'Ask a question or share how your print went…' : 'Sign in to comment'}
          aria-label="Your comment"
          onFocus={() => {
            if (!user) requireAccount('social')
          }}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="page__button page__button--primary" disabled={busy || !draft.trim()}>
          Post
        </button>
      </form>
      {error && <p className="account__error">{error}</p>}
      {comments === null ? (
        <div className="community-empty">Loading…</div>
      ) : comments.length === 0 ? (
        <p className="comments__none">No comments yet. Be the first.</p>
      ) : (
        <ul className="comments__list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <Avatar name={c.author.displayName} url={c.author.avatarUrl} large />
              <div className="comment__body">
                <div className="comment__meta">
                  <strong>{c.author.displayName}</strong>
                  {c.authorId === ownerId && <span className="comment__author-tag">author</span>}
                  <span>{relativeTime(c.createdAt)}</span>
                  {canDelete(c) && (
                    <button type="button" className="comment__delete" title="Delete" aria-label="Delete comment" onClick={() => void remove(c)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <p>{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
