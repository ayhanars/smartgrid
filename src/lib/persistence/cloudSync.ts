import { useAuthStore } from '../../features/auth/useAuthStore'
import { deleteCloudProject, loadCloudProject, saveCloudProject } from '../supabase/projects'
import { deleteLocalProject, loadLocalProject, saveLocalProject, type DocumentSnapshot } from './localProjects'

/** Cloud rows are keyed by uuid; ids from the pre-uuid fallback in
 * `localProjects.newId` stay local-only. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isCloudSyncable = (id: string) => UUID_RE.test(id)
export const isSignedIn = () => useAuthStore.getState().user !== null

/** The project as the editor should open it: the browser's copy when there
 * is one, otherwise the cloud copy (cached locally so it autosaves and
 * shows up on the home page like any other project). */
export async function loadProjectAnywhere(id: string): Promise<DocumentSnapshot | null> {
  const local = loadLocalProject(id)
  if (local) return local
  if (!isSignedIn() || !isCloudSyncable(id)) return null
  const remote = await loadCloudProject(id)
  if (remote) saveLocalProject(id, remote)
  return remote
}

/** Pushes the browser's copy of a project to the cloud. */
export async function uploadProject(id: string): Promise<boolean> {
  const snapshot = loadLocalProject(id)
  if (!snapshot || !isSignedIn() || !isCloudSyncable(id)) return false
  await saveCloudProject(id, snapshot)
  return true
}

/** Removes a project from this browser and, when signed in, from the cloud. */
export async function deleteProjectEverywhere(id: string): Promise<void> {
  deleteLocalProject(id)
  if (isSignedIn() && isCloudSyncable(id)) {
    try {
      await deleteCloudProject(id)
    } catch (err) {
      console.warn('Cloud delete failed', err)
    }
  }
}
