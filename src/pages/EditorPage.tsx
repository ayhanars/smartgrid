import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../app/AppShell'
import { serializeDocument, useDocumentStore } from '../state/documentStore'
import { useViewStore } from '../state/viewStore'
import { listLocalProjects, saveLocalProject, type DocumentSnapshot } from '../lib/persistence/localProjects'
import { isCloudSyncable, loadProjectAnywhere } from '../lib/persistence/cloudSync'
import { saveCloudProject } from '../lib/supabase/projects'
import { useAuthStore } from '../features/auth/useAuthStore'
import { isNetworkError, useConnectivity } from '../lib/connectivity'

const AUTOSAVE_DELAY_MS = 400
/** Cloud writes are slower and metered, so they trail the local autosave. */
const CLOUD_SAVE_DELAY_MS = 2500

/** Opens one project into the editor and autosaves every document change
 * back to the browser's storage — and, when signed in, to the cloud. */
export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const authLoading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const [loadedId, setLoadedId] = useState<string | null>(null)

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
    let pending: DocumentSnapshot | null = null
    let cloudPending: DocumentSnapshot | null = null
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
      saveCloudProject(id, snapshot)
        .then(() => useViewStore.getState().setCloudStatus('synced'))
        .catch((err) => {
          console.warn('Cloud save failed', err)
          // Nothing newer arrived meanwhile: retry this one later.
          if (!cloudPending) cloudPending = snapshot
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
      if (cloud) {
        cloudPending = next
        window.clearTimeout(cloudTimer)
        cloudTimer = window.setTimeout(flushCloud, CLOUD_SAVE_DELAY_MS)
      }
    })
    const flushAll = () => {
      flush()
      flushCloud()
    }
    window.addEventListener('beforeunload', flushAll)
    window.addEventListener('pagehide', flushAll)
    return () => {
      unsubscribe()
      unsubscribeNet()
      window.clearTimeout(timer)
      window.clearTimeout(cloudTimer)
      window.removeEventListener('beforeunload', flushAll)
      window.removeEventListener('pagehide', flushAll)
      flushAll()
    }
  }, [id, loadedId, user])

  if (loadedId !== id) return null
  return <AppShell />
}
