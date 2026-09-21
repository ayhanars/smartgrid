import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../app/AppShell'
import { serializeDocument, useDocumentStore } from '../state/documentStore'
import { useViewStore } from '../state/viewStore'
import { listLocalProjects, saveLocalProject, type DocumentSnapshot } from '../lib/persistence/localProjects'
import { isCloudSyncable, loadProjectAnywhere } from '../lib/persistence/cloudSync'
import { saveCloudProject } from '../lib/supabase/projects'
import { useAuthStore } from '../features/auth/useAuthStore'
import { isNetworkError, useConnectivity } from '../lib/connectivity'
import { captureThumbnail, loadLocalThumbnail, saveLocalThumbnail } from '../lib/persistence/thumbnails'

const AUTOSAVE_DELAY_MS = 400
/** Cloud writes are slower and metered, so they trail the local autosave. */
const CLOUD_SAVE_DELAY_MS = 2500
/** The 3D thumbnail is re-rendered a moment after editing stops. */
const THUMBNAIL_DELAY_MS = 1500

/** Opens one project into the editor and autosaves every document change
 * back to the browser's storage — and, when signed in, to the cloud. */
export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const authLoading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const createParam = params.get('create')

  // A generator card: straight into the Create panel on that product.
  useEffect(() => {
    if (!createParam || loadedId !== id) return
    useViewStore.getState().setCreateTemplate(createParam)
    useViewStore.getState().setCreateOpen(true)
    setParams({}, { replace: true })
  }, [createParam, loadedId, id, setParams])

  // Load: the browser's copy, or the cloud copy once we know who is signed in.
  useEffect(() => {
    if (!id || authLoading) return
    let cancelled = false
    loadProjectAnywhere(id)
      .catch(() => null)
      .then((snapshot) => {
        if (cancelled) return
        if (!snapshot) {
          navigate('/', { replace: true })
          return
        }
        useDocumentStore.getState().loadDocument(id, snapshot)
        useViewStore.getState().setSaveStatus('saved')
        setLoadedId(id)
      })
    return () => {
      cancelled = true
    }
  }, [id, authLoading, navigate])

  // Autosave, local and cloud.
  useEffect(() => {
    if (!id || loadedId !== id) return
    const cloud = user !== null && isCloudSyncable(id)
    const view = useViewStore.getState()
    view.setCloudStatus(cloud ? 'synced' : 'off')

    let timer: number | undefined
    let cloudTimer: number | undefined
    let thumbTimer: number | undefined
    let pending: DocumentSnapshot | null = null
    let cloudPending: DocumentSnapshot | null = null
    /** Thumbnail not yet pushed to the cloud (null = nothing new). */
    let thumbPending: string | null = null
    let last = serializeDocument(useDocumentStore.getState())
    const changed = (a: DocumentSnapshot, b: DocumentSnapshot) => (Object.keys(a) as (keyof DocumentSnapshot)[]).some((k) => a[k] !== b[k])
    const stillExists = () => listLocalProjects().some((p) => p.id === id)

    const flush = () => {
      if (!pending) return
      const snapshot = pending
      pending = null
      // A project deleted from the top-bar menu must not be resurrected by
      // the autosave that fires as the editor unmounts.
      if (!stillExists()) return
      saveLocalProject(id, snapshot)
      useViewStore.getState().setSaveStatus('saved')
    }
    // A fresh picture from the 3D view, kept locally and queued for the
    // next cloud save. No-op while the 3D pane is closed; while its hole
    // cuts are still computing, tries again shortly.
    let thumbRetries = 0
    let capturing = false
    const refreshThumbnail = () => {
      if (!stillExists() || capturing) return
      capturing = true
      void captureThumbnail().then((dataUrl) => {
        capturing = false
        if (dataUrl === 'busy') {
          if (thumbRetries++ < 40) {
            window.clearTimeout(thumbTimer)
            thumbTimer = window.setTimeout(() => {
              thumbTimer = undefined
              refreshThumbnail()
            }, 750)
          }
          return
        }
        thumbRetries = 0
        if (!dataUrl || !stillExists()) return
        saveLocalThumbnail(id, dataUrl)
        thumbPending = dataUrl
        // Signed in and idle: push the picture without waiting for an edit.
        if (cloud && !cloudPending) {
          cloudPending = last
          flushCloud()
        }
      })
    }
    const flushCloud = () => {
      if (!cloudPending || !stillExists()) return
      const snapshot = cloudPending
      cloudPending = null
      if (!useConnectivity.getState().online) {
        // Keep the snapshot: it goes up as soon as the network is back.
        cloudPending = snapshot
        useViewStore.getState().setCloudStatus('offline')
        return
      }
      useViewStore.getState().setCloudStatus('syncing')
      const thumbnail = thumbPending ?? undefined
      thumbPending = null
      saveCloudProject(id, snapshot, thumbnail)
        .then(() => useViewStore.getState().setCloudStatus('synced'))
        .catch((err) => {
          console.warn('Cloud save failed', err)
          // Nothing newer arrived meanwhile: retry this one later.
          if (!cloudPending) cloudPending = snapshot
          if (thumbnail && !thumbPending) thumbPending = thumbnail
          useViewStore.getState().setCloudStatus(isNetworkError(err) ? 'offline' : 'error')
        })
    }
    // Back online: push whatever the last failed / deferred save held.
    const unsubscribeNet = cloud
      ? useConnectivity.subscribe((s, prev) => {
          if (s.online && !prev.online && cloudPending) flushCloud()
        })
      : () => {}

    const unsubscribe = useDocumentStore.subscribe((state) => {
      const next = serializeDocument(state)
      if (!changed(next, last)) return
      last = next
      pending = next
      useViewStore.getState().setSaveStatus('saving')
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, AUTOSAVE_DELAY_MS)
      window.clearTimeout(thumbTimer)
      thumbTimer = window.setTimeout(() => {
        thumbTimer = undefined
        refreshThumbnail()
      }, THUMBNAIL_DELAY_MS)
      if (cloud) {
        cloudPending = next
        window.clearTimeout(cloudTimer)
        cloudTimer = window.setTimeout(flushCloud, CLOUD_SAVE_DELAY_MS)
      }
    })
    // A project that has never been pictured (older saves, or opened from
    // the cloud on a new device) gets one as soon as the 3D view is up.
    if (!loadLocalThumbnail(id)) {
      thumbTimer = window.setTimeout(() => {
        thumbTimer = undefined
        refreshThumbnail()
      }, THUMBNAIL_DELAY_MS)
    }
    const flushAll = () => {
      flush()
      if (cloud && thumbPending && !cloudPending) cloudPending = last
      flushCloud()
    }
    window.addEventListener('beforeunload', flushAll)
    window.addEventListener('pagehide', flushAll)
    return () => {
      unsubscribe()
      unsubscribeNet()
      window.clearTimeout(timer)
      window.clearTimeout(cloudTimer)
      window.clearTimeout(thumbTimer)
      window.removeEventListener('beforeunload', flushAll)
      window.removeEventListener('pagehide', flushAll)
      flushAll()
    }
  }, [id, loadedId, user])

  if (loadedId !== id) return null
  return <AppShell />
}
