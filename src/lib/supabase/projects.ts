import { supabase } from './client'
import type { DocumentSnapshot } from '../persistence/localProjects'

export interface CloudProjectMeta {
  id: string
  name: string
  /** Unix ms, to match `LocalProjectMeta`. */
  createdAt: number
  updatedAt: number
}

interface ProjectRow {
  id: string
  owner_id: string
  name: string
  data: DocumentSnapshot
  created_at: string
  updated_at: string
}

const toMeta = (row: Pick<ProjectRow, 'id' | 'name' | 'created_at' | 'updated_at'>): CloudProjectMeta => ({
  id: row.id,
  name: row.name,
  createdAt: Date.parse(row.created_at),
  updatedAt: Date.parse(row.updated_at),
})

/** Newest first. */
export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as Pick<ProjectRow, 'id' | 'name' | 'created_at' | 'updated_at'>[]).map(toMeta)
}

export async function loadCloudProject(id: string): Promise<DocumentSnapshot | null> {
  const { data, error } = await supabase.from('projects').select('data').eq('id', id).maybeSingle()
  if (error) throw error
  const snapshot = (data as Pick<ProjectRow, 'data'> | null)?.data
  return snapshot && snapshot.version === 1 ? snapshot : null
}

export async function saveCloudProject(id: string, snapshot: DocumentSnapshot): Promise<CloudProjectMeta> {
  const { data: userData } = await supabase.auth.getUser()
  const owner_id = userData.user?.id
  if (!owner_id) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('projects')
    .upsert({ id, owner_id, name: snapshot.name, data: snapshot })
    .select('id, name, created_at, updated_at')
    .single()
  if (error) throw error
  return toMeta(data as ProjectRow)
}

export async function deleteCloudProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}
