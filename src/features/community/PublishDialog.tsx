import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Globe, Trash2, X } from 'lucide-react'
import { serializeDocument, useDocumentStore } from '../../state/documentStore'
import { useViewStore } from '../../state/viewStore'
import { saveLocalProject } from '../../lib/persistence/localProjects'
import { captureThumbnail, loadLocalThumbnail, loadProjectSource, saveLocalThumbnail } from '../../lib/persistence/thumbnails'
import { TagInput } from './TagInput'
import {
  CATEGORIES,
  deleteCommunityItem,
  findMyCommunityItemForProject,
  getCommunityItem,
  publishCommunityItem,
  updateCommunityItem,
  type CommunityItem,
} from '../../lib/supabase/community'
import { friendlyAuthError } from '../auth/authErrors'
import { isStaffRole, useAuthStore } from '../auth/useAuthStore'
import '../auth/AuthDialog.css'
import './community.css'

interface PublishDialogProps {
  projectId: string
  onClose: () => void
}

/**
 * "Publish to community" from the editor. Publishing stores a copy of the
 * project; opening it again for an already-published project edits the
 * listing and can push the current model over the shared copy.
 */
export function PublishDialog({ projectId, onClose }: PublishDialogProps) {
  const navigate = useNavigate()
  const projectName = useDocumentStore((s) => s.projectName)
  const setNotice = useViewStore((s) => s.setNotice)
  const [existing, setExisting] = useState<CommunityItem | null | undefined>(undefined)
  const [title, setTitle] = useState(projectName)
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [category, setCategory] = useState('other')
  const [replaceModel, setReplaceModel] = useState(true)
  const [status, setStatus] = useState<'published' | 'hidden'>('published')
  const [changes, setChanges] = useState('')
  const [asVersion, setAsVersion] = useState(true)
  const [source, setSource] = useState<CommunityItem | null>(null)
  const staff = isStaffRole(useAuthStore((s) => s.profile))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    findMyCommunityItemForProject(projectId)
      .then((item) => {
        if (cancelled) return
        setExisting(item)
        if (item) {
          setTitle(item.title)
          setDescription(item.description)
          setNotes(item.notes)
          setTags(item.tags)
          setCategory(item.category)
          setStatus(item.status === 'hidden' ? 'hidden' : 'published')
          setChanges(item.changes)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setExisting(null)
        setError(friendlyAuthError(err))
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Copied from a community model: offer to publish as a version of it.
  useEffect(() => {
    const sourceId = loadProjectSource(projectId)
    if (!sourceId) return
    let cancelled = false
    getCommunityItem(sourceId)
      .then((it) => !cancelled && setSource(it))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  /** The document as it is right now, saved, with a fresh picture. */
  const currentModel = async () => {
    const snapshot = serializeDocument(useDocumentStore.getState())
    saveLocalProject(projectId, snapshot)
    const fresh = await captureThumbnail()
    if (fresh && fresh !== 'busy') saveLocalThumbnail(projectId, fresh)
    return { snapshot, thumbnail: fresh && fresh !== 'busy' ? fresh : loadLocalThumbnail(projectId) }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const draft = { title: title.trim() || projectName, description: description.trim(), notes: notes.trim(), tags, category }
    setBusy(true)
    setError(null)
    try {
      if (existing) {
        const model = replaceModel ? await currentModel() : null
        await updateCommunityItem(existing.id, { ...draft, status, changes: changes.trim(), ...(model ? { snapshot: model.snapshot, thumbnail: model.thumbnail } : {}) })
        setNotice(replaceModel && !staff ? 'Community copy updated. A moderator will review the new model before it shows again.' : replaceModel ? 'Community copy updated with the current model.' : 'Community listing updated.', { label: 'View in community', to: `/c/${existing.id}` })
      } else {
        const model = await currentModel()
        const version = source && asVersion ? { parentId: source.id, changes: changes.trim() } : undefined
        const item = await publishCommunityItem(projectId, model.snapshot, model.thumbnail, draft, version)
        setNotice(staff ? `Published "${item.title}" to the community.` : `"${item.title}" was sent for review. You will get a notification once a moderator approves it.`, { label: 'View in community', to: `/c/${item.id}` })
      }
      onClose()
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    if (!window.confirm(`Remove "${existing.title}" from the community? People who already opened a copy keep theirs.`)) return
    setBusy(true)
    try {
      await deleteCommunityItem(existing.id)
      setNotice('Removed from the community.')
      onClose()
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <div className="auth-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="auth-dialog publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title" onSubmit={submit}>
        <button type="button" className="auth-dialog__close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
        <h2 id="publish-title">
          <Globe size={16} />
          {existing ? 'Community listing' : 'Publish to community'}
        </h2>
        <p className="auth-dialog__lead">
          {existing === undefined
            ? 'Checking…'
            : existing
              ? `Published ${new Date(existing.createdAt).toLocaleDateString()} · ${existing.downloads} ${existing.downloads === 1 ? 'copy opened' : 'copies opened'}${existing.approval === 'pending' ? ' · waiting for review' : existing.approval === 'rejected' ? ' · not approved' : ''}`
              : staff
                ? 'Shares a copy of this project with everyone. You can update it, add notes, hide it or remove it later.'
                : 'Shares a copy of this project. A moderator reviews new models before they appear to everyone; you can update, hide or remove it later.'}
        </p>
        {existing?.approval === 'rejected' && existing.reviewNote && <p className="auth-dialog__error">Moderator note: {existing.reviewNote}</p>}

        <div className="auth-dialog__form">
          <label htmlFor="publish-name">Title</label>
          <input id="publish-name" value={title} maxLength={80} required onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor="publish-desc">Short description</label>
          <input id="publish-desc" value={description} maxLength={200} placeholder="What is it, what does it fit?" onChange={(e) => setDescription(e.target.value)} />
          <label htmlFor="publish-notes">Notes for people who print it</label>
          <textarea id="publish-notes" value={notes} maxLength={2000} rows={4} placeholder="Filament, orientation, tolerances, what to tweak…" onChange={(e) => setNotes(e.target.value)} />
          <label htmlFor="publish-category">Category</label>
          <select id="publish-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <label htmlFor="publish-tags">Tags</label>
          <TagInput id="publish-tags" value={tags} onChange={setTags} />

          {!existing && source && (
            <div className="publish-dialog__options">
              <label className="publish-dialog__check">
                <input type="checkbox" checked={asVersion} onChange={(e) => setAsVersion(e.target.checked)} />
                Publish as a version of “{source.title}” by {source.author.displayName}
              </label>
              {asVersion && (
                <>
                  <label htmlFor="publish-changes" className="publish-dialog__sublabel">
                    What changed?
                  </label>
                  <textarea id="publish-changes" value={changes} rows={2} maxLength={600} placeholder="e.g. taller walls, 3 mm holes, gridfinity base" onChange={(e) => setChanges(e.target.value)} />
                </>
              )}
            </div>
          )}
          {existing?.parentId && (
            <>
              <label htmlFor="publish-changes">What changed in this version?</label>
              <textarea id="publish-changes" value={changes} rows={2} maxLength={600} onChange={(e) => setChanges(e.target.value)} />
            </>
          )}

          {existing && (
            <div className="publish-dialog__options">
              <label className="publish-dialog__check">
                <input type="checkbox" checked={replaceModel} onChange={(e) => setReplaceModel(e.target.checked)} />
                Replace the shared model with the project as it is now
              </label>
              <label className="publish-dialog__check">
                <input type="checkbox" checked={status === 'published'} onChange={(e) => setStatus(e.target.checked ? 'published' : 'hidden')} />
                Visible in the community {status === 'hidden' && <span className="publish-dialog__muted">(hidden: only you can see it)</span>}
              </label>
            </div>
          )}

          <div className="publish-dialog__actions">
            {existing && (
              <>
                <button type="button" className="publish-dialog__link" onClick={() => navigate(`/c/${existing.id}`)}>
                  <ExternalLink size={13} />
                  View
                </button>
                <button type="button" className="publish-dialog__link publish-dialog__link--danger" disabled={busy} onClick={() => void remove()}>
                  <Trash2 size={13} />
                  Remove
                </button>
              </>
            )}
            <button type="submit" className="auth-dialog__submit publish-dialog__submit" disabled={busy || existing === undefined || !title.trim()}>
              {busy ? 'Working…' : existing ? 'Save changes' : 'Publish'}
            </button>
          </div>
        </div>
        {error && <p className="auth-dialog__error" role="alert">{error}</p>}
      </form>
    </div>
  )
}
