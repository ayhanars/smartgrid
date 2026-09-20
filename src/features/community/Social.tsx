import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bookmark, BookmarkCheck, Check, Heart, Plus, Trash2 } from 'lucide-react'
import { addComment, deleteComment, listComments, listMyLikes, searchProfiles, setLiked, type CommunityComment } from '../../lib/supabase/community'
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

/** Comments under a model: everyone reads, signed-in users write and
 * reply, @mention people (autocomplete), and the author / item owner /
 * staff delete. Replies nest one level under the comment they answer. */
export function CommentsSection({ itemId, ownerId, onCount }: { itemId: string; ownerId: string; onCount: (n: number) => void }) {
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const [comments, setComments] = useState<CommunityComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<CommunityComment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // People picked from the @ list: display name -> id, so the ids can be
  // sent along even after the text was edited.
  const mentioned = useRef(new Map<string, string>())
  const [suggest, setSuggest] = useState<{ query: string; start: number; people: { id: string; displayName: string; avatarUrl: string | null; level: number }[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    listComments(itemId)
      .then((list) => !cancelled && setComments(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load comments'))
    return () => {
      cancelled = true
    }
  }, [itemId])

  // "@na" before the caret opens the people list.
  const onDraftChange = (value: string, caret: number) => {
    setDraft(value)
    const before = value.slice(0, caret)
    const m = /(^|\s)@([^\s@]{1,30})$/.exec(before)
    if (!m) {
      setSuggest(null)
      return
    }
    const query = m[2]
    const start = caret - query.length - 1
    setSuggest((prev) => ({ query, start, people: prev?.query && query.startsWith(prev.query) ? prev.people.filter((p) => p.displayName.toLowerCase().includes(query.toLowerCase())) : [] }))
    searchProfiles(query)
      .then((people) => setSuggest((cur) => (cur && cur.query === query ? { ...cur, people } : cur)))
      .catch(() => undefined)
  }

  const pick = (person: { id: string; displayName: string }) => {
    if (!suggest) return
    const caret = textareaRef.current?.selectionStart ?? draft.length
    const next = `${draft.slice(0, suggest.start)}@${person.displayName} ${draft.slice(caret)}`
    mentioned.current.set(person.displayName, person.id)
    setDraft(next)
    setSuggest(null)
    window.setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      const pos = suggest.start + person.displayName.length + 2
      el.focus()
      el.setSelectionRange(pos, pos)
    }, 0)
  }

  const startReply = (c: CommunityComment) => {
    if (!requireAccount('social')) return
    setReplyTo(c)
    mentioned.current.set(c.author.displayName, c.authorId)
    setDraft((d) => (d.trim() ? d : `@${c.author.displayName} `))
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!requireAccount('social')) return
    const body = draft.trim()
    if (!body) return
    const mentions = [...mentioned.current.entries()].filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id)
    setBusy(true)
    setError(null)
    try {
      // Replies stay one level deep: answering a reply attaches to its parent.
      const parentId = replyTo ? (replyTo.parentId ?? replyTo.id) : null
      const c = await addComment(itemId, body, { parentId, mentions: [...new Set(mentions)] })
      setComments((list) => {
        const next = [...(list ?? []), c]
        onCount(next.length)
        return next
      })
      setDraft('')
      setReplyTo(null)
      mentioned.current.clear()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the comment')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (c: CommunityComment) => {
    if (!window.confirm(c.parentId ? 'Delete this reply?' : 'Delete this comment and its replies?')) return
    try {
      await deleteComment(c.id)
      setComments((list) => {
        const next = (list ?? []).filter((x) => x.id !== c.id && x.parentId !== c.id)
        onCount(next.length)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the comment')
    }
  }

  const canDelete = (c: CommunityComment) => !!user && (user.id === c.authorId || user.id === ownerId || isStaffRole(profile))
  const roots = (comments ?? []).filter((c) => !c.parentId)
  const repliesOf = (id: string) => (comments ?? []).filter((c) => c.parentId === id)

  const renderComment = (c: CommunityComment, isReply: boolean) => (
    <li key={c.id} className={`comment ${isReply ? 'comment--reply' : ''}`}>
      <Avatar name={c.author.displayName} url={c.author.avatarUrl} large={!isReply} />
      <div className="comment__body">
        <div className="comment__meta">
          <strong>{c.author.displayName}</strong>
          <span className="level-badge">L{c.author.level}</span>
          {c.authorId === ownerId && <span className="comment__author-tag">author</span>}
          <span>{relativeTime(c.createdAt)}</span>
          <button type="button" className="comment__reply" onClick={() => startReply(c)}>
            Reply
          </button>
          {canDelete(c) && (
            <button type="button" className="comment__delete" title="Delete" aria-label="Delete comment" onClick={() => void remove(c)}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <p>{renderBody(c.body)}</p>
        {!isReply && repliesOf(c.id).length > 0 && <ul className="comments__replies">{repliesOf(c.id).map((r) => renderComment(r, true))}</ul>}
      </div>
    </li>
  )

  return (
    <section className="comments">
      <h2>
        Comments <span>{comments?.length ?? ''}</span>
      </h2>
      <form className="comments__form" onSubmit={submit}>
        <div className="comments__composer">
          {replyTo && (
            <div className="comments__replying">
              Replying to <strong>{replyTo.author.displayName}</strong>
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => {
                  setReplyTo(null)
                }}
              >
                ×
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            rows={2}
            maxLength={2000}
            placeholder={user ? 'Ask a question or share how your print went… Type @ to mention someone.' : 'Sign in to comment'}
            aria-label="Your comment"
            onFocus={() => {
              if (!user) requireAccount('social')
            }}
            onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && suggest) {
                e.preventDefault()
                setSuggest(null)
              } else if (e.key === 'Enter' && suggest && suggest.people.length > 0) {
                e.preventDefault()
                pick(suggest.people[0])
              }
            }}
          />
          {suggest && suggest.people.length > 0 && (
            <div className="layer-context-menu comments__mentions" role="listbox">
              {suggest.people.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                  <Avatar name={p.displayName} url={p.avatarUrl} />
                  <span>{p.displayName}</span>
                  <span className="level-badge">L{p.level}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" className="page__button page__button--primary" disabled={busy || !draft.trim()}>
          {replyTo ? 'Reply' : 'Post'}
        </button>
      </form>
      {error && <p className="account__error">{error}</p>}
      {comments === null ? (
        <div className="community-empty">Loading…</div>
      ) : comments.length === 0 ? (
        <p className="comments__none">No comments yet. Be the first.</p>
      ) : (
        <ul className="comments__list">{roots.map((c) => renderComment(c, false))}</ul>
      )}
    </section>
  )
}

/** Highlights @mentions in a comment body. */
function renderBody(body: string) {
  // A mention is @ plus one or two words (display names are short).
  const parts = body.split(/(@[^\s@.,!?]+(?: [A-Z][^\s@.,!?]*)?)/g)
  return parts.map((part, i) => (part.startsWith('@') ? <span key={i} className="comment__mention">{part}</span> : <span key={i}>{part}</span>))
}
