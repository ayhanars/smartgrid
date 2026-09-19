import { supabase } from './client'
import type { DocumentSnapshot } from '../persistence/localProjects'

export interface CloudProjectMeta {
  id: string
  name: string
  /** Unix ms, to match `LocalProjectMeta`. */
  createdAt: number
  updatedAt: number
  /** WebP data URL, when the project has been opened in the 3D view. */
  thumbnail: string | null
}

interface ProjectRow {
  id: string
  owner_id: string
  name: string
  data: DocumentSnapshot
  thumbnail: string | null
  created_at: string
  updated_at: string
}

type MetaRow = Pick<ProjectRow, 'id' | 'name' | 'thumbnail' | 'created_at' | 'updated_at'>
const META_COLUMNS = 'id, name, thumbnail, created_at, updated_at'

const toMeta = (row: MetaRow): CloudProjectMeta => ({
  id: row.id,
  name: row.name,
  createdAt: Date.parse(row.created_at),
  updatedAt: Date.parse(row.updated_at),
  thumbnail: row.thumbnail ?? null,
})

/** Newest first. */
export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const { data, error } = await supabase.from('projects').select(META_COLUMNS).order('updated_at', { ascending: false })
  if (error) throw error
  return (data as MetaRow[]).map(toMeta)
}

export async function loadCloudProject(id: string): Promise<{ snapshot: DocumentSnapshot; thumbnail: string | null } | null> {
  const { data, error } = await supabase.from('projects').select('data, thumbnail').eq('id', id).maybeSingle()
  if (error) throw error
  const row = data as Pick<ProjectRow, 'data' | 'thumbnail'> | null
  const snapshot = row?.data
  return snapshot && snapshot.version === 1 ? { snapshot, thumbnail: row?.thumbnail ?? null } : null
}

/** Upserts the document; `thumbnail` is left untouched when undefined. */
export async function saveCloudProject(id: string, snapshot: DocumentSnapshot, thumbnail?: string | null): Promise<CloudProjectMeta> {
  const { data: userData } = await supabase.auth.getUser()
  const owner_id = userData.user?.id
  if (!owner_id) throw new Error('Not signed in')

  const row: Partial<ProjectRow> = { id, owner_id, name: snapshot.name, data: snapshot }
  if (thumbnail !== undefined) row.thumbnail = thumbnail
  const { data, error } = await supabase.from('projects').upsert(row).select(META_COLUMNS).single()
  if (error) throw error
  return toMeta(data as MetaRow)
}

export async function deleteCloudProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}
