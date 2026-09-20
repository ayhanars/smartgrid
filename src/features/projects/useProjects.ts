import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listLocalProjects, duplicateLocalProject, renameLocalProject, type LocalProjectMeta } from '../../lib/persistence/localProjects'
import { deleteProjectEverywhere, isCloudSyncable, uploadProject } from '../../lib/persistence/cloudSync'
import { listCloudProjects, type CloudProjectMeta } from '../../lib/supabase/projects'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuthStore } from '../auth/useAuthStore'
import { isNetworkError, useConnectivity } from '../../lib/connectivity'

/** One row of the project list: a project saved in this browser, in the cloud,
 * or both. */
export interface ProjectEntry {
  id: string
  name: string
  updatedAt: number
  shapeCount: number | null
  /** Saved in this browser (opens instantly, can be renamed here). */
  local: LocalProjectMeta | null
  cloud: CloudProjectMeta | null
}

/** Landing page: one list of projects. Signed in, everything saved in this
 * browser is uploaded automatically and cloud copies from other devices
 * show up alongside; as a guest the same list is just this browser. */
export type CardCloudState = 'none' | 'guest' | 'unknown' | 'uploading' | 'cloud' | 'missing'

/**
 * One list of projects: everything saved in this browser plus, signed in,
 * the cloud copies. Local-only projects upload automatically once the
 * cloud list is known; failures surface as "not in cloud".
 */
export function useProjects() {
  const user = useAuthStore((s) => s.user)
  const authLoading = useAuthStore((s) => s.loading)
  const online = useConnectivity((s) => s.online)
  const [projects, setProjects] = useState<LocalProjectMeta[]>(() => listLocalProjects())
  const [cloudProjects, setCloudProjects] = useState<CloudProjectMeta[] | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Set<string>>(() => new Set())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const refresh = () => setProjects(listLocalProjects())


  const refreshCloud = useCallback(() => {
    if (!user) {
      setCloudProjects(null)
      return
    }
    listCloudProjects()
      .then((list) => {
        setCloudProjects(list)
        setCloudError(null)
      })
      .catch((err: unknown) => setCloudError(isNetworkError(err) ? 'No connection: showing what is saved in this browser. Cloud copies appear when you are back online.' : err instanceof Error ? err.message : 'Could not load cloud projects'))
  }, [user])
  useEffect(refreshCloud, [refreshCloud])
  // Back online: reload the cloud list (and clear the offline notice).
  useEffect(() => {
    if (online) refreshCloud()
  }, [online, refreshCloud])

  const guest = isSupabaseConfigured && !authLoading && user === null
  const cloudKnown = user !== null && cloudProjects !== null && !cloudError
  const cloudIds = useMemo(() => new Set((cloudProjects ?? []).map((p) => p.id)), [cloudProjects])

  // Signed in with the cloud list in hand: anything only in this browser
  // goes up now, so there is one set of projects wherever you sign in.
  const attempted = useRef(new Set<string>())
  useEffect(() => {
    if (!cloudKnown || !online) return
    const missing = projects.filter((p) => isCloudSyncable(p.id) && !cloudIds.has(p.id) && !attempted.current.has(p.id))
    if (missing.length === 0) return
    for (const p of missing) attempted.current.add(p.id)
    setUploading((set) => new Set([...set, ...missing.map((p) => p.id)]))
    let done = 0
    for (const p of missing) {
      uploadProject(p.id)
        .then((ok) => {
          if (!ok) attempted.current.delete(p.id)
        })
        .catch((err: unknown) => {
          console.warn('Upload failed', err)
          attempted.current.delete(p.id)
          setFailed((set) => new Set([...set, p.id]))
        })
        .finally(() => {
          setUploading((set) => {
            const next = new Set(set)
            next.delete(p.id)
            return next
          })
          if (++done === missing.length) refreshCloud()
        })
    }
  }, [cloudKnown, online, projects, cloudIds, refreshCloud])
  // A user signing out (or a new one signing in) starts the bookkeeping over.
  useEffect(() => {
    attempted.current.clear()
    setFailed(new Set())
  }, [user?.id])

  const entries = useMemo((): ProjectEntry[] => {
    const byId = new Map<string, ProjectEntry>()
    for (const p of projects) byId.set(p.id, { id: p.id, name: p.name, updatedAt: p.updatedAt, shapeCount: p.shapeCount, local: p, cloud: null })
    for (const c of user ? cloudProjects ?? [] : []) {
      const existing = byId.get(c.id)
      if (existing) existing.cloud = c
      else byId.set(c.id, { id: c.id, name: c.name, updatedAt: c.updatedAt, shapeCount: null, local: null, cloud: c })
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projects, cloudProjects, user])

  const cloudStateFor = (e: ProjectEntry): CardCloudState => {
    if (!isSupabaseConfigured) return 'none'
    if (guest) return 'guest'
    if (e.cloud) return 'cloud'
    if (!e.local || !isCloudSyncable(e.id)) return 'none'
    if (uploading.has(e.id)) return 'uploading'
    if (failed.has(e.id) || !online) return 'missing'
    return cloudKnown ? 'uploading' : 'unknown'
  }

  const duplicate = (id: string) => {
    duplicateLocalProject(id)
    refresh()
  }
  const remove = (entry: ProjectEntry) => {
    const where = entry.cloud && entry.local ? 'from this browser and the cloud' : entry.cloud ? 'from the cloud' : 'from this browser'
    if (!window.confirm(`Delete "${entry.name}" ${where}? This can't be undone.`)) return
    void deleteProjectEverywhere(entry.id).then(() => {
      refresh()
      refreshCloud()
    })
  }
  const upload = (id: string) => {
    setFailed((set) => {
      const next = new Set(set)
      next.delete(id)
      return next
    })
    setUploading((set) => new Set([...set, id]))
    uploadProject(id)
      .then((ok) => {
        if (ok) refreshCloud()
      })
      .catch((err: unknown) => {
        setFailed((set) => new Set([...set, id]))
        setCloudError(isNetworkError(err) ? 'No connection: the project was not uploaded. It will be retried when you are back online.' : err instanceof Error ? err.message : 'Upload failed')
      })
      .finally(() =>
        setUploading((set) => {
          const next = new Set(set)
          next.delete(id)
          return next
        }),
      )
  }
  const rename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) renameLocalProject(id, trimmed)
    setRenamingId(null)
    refresh()
  }

  const menuEntry = menu ? entries.find((e) => e.id === menu.id) : undefined
  const notUploaded = entries.filter((e) => cloudStateFor(e) === 'missing').length

  return {
    user,
    guest,
    online,
    cloudError,
    cloudProjects,
    entries,
    cloudStateFor,
    notUploaded,
    menu,
    setMenu,
    menuEntry,
    renamingId,
    setRenamingId,
    refresh,
    refreshCloud,
    duplicate,
    remove,
    upload,
    rename,
  }
}
