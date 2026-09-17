import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../app/AppShell'
import { serializeDocument, useDocumentStore } from '../state/documentStore'
import { useViewStore } from '../state/viewStore'
import { listLocalProjects, loadLocalProject, saveLocalProject, type DocumentSnapshot } from '../lib/persistence/localProjects'

const AUTOSAVE_DELAY_MS = 400

/** Opens one local project into the editor and autosaves every document
 * change back to the browser's storage. */
export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loadedId, setLoadedId] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const snapshot = loadLocalProject(id)
    if (!snapshot) {
      navigate('/', { replace: true })
      return
    }
    useDocumentStore.getState().loadDocument(id, snapshot)
    useViewStore.getState().setSaveStatus('saved')
    setLoadedId(id)

    let timer: number | undefined
    let pending: DocumentSnapshot | null = null
    let last = serializeDocument(useDocumentStore.getState())
    const changed = (a: DocumentSnapshot, b: DocumentSnapshot) => (Object.keys(a) as (keyof DocumentSnapshot)[]).some((k) => a[k] !== b[k])

    const flush = () => {
      if (!pending) return
      const snapshot = pending
      pending = null
      // A project deleted from the top-bar menu must not be resurrected by
      // the autosave that fires as the editor unmounts.
      if (!listLocalProjects().some((p) => p.id === id)) return
      saveLocalProject(id, snapshot)
      useViewStore.getState().setSaveStatus('saved')
    }

    const unsubscribe = useDocumentStore.subscribe((state) => {
      const next = serializeDocument(state)
      if (!changed(next, last)) return
      last = next
      pending = next
      useViewStore.getState().setSaveStatus('saving')
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, AUTOSAVE_DELAY_MS)
    })
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [id, navigate])

  if (loadedId !== id) return null
  return <AppShell />
}
