import { currentUserId, supabase } from './client'
import type { DocumentSnapshot } from '../persistence/localProjects'
import { loadProjectSource, saveProjectSource } from '../persistence/thumbnails'

export interface CloudProjectMeta {
  id: string
  name: string
  /** Unix ms, to match `LocalProjectMeta`. */
  createdAt: number
  updatedAt: number
  /** WebP data URL, when the project has been opened in the 3D view. */
  thumbnail: string | null
  /** Unix ms when it went to the trash; only on trash listings. */
  deletedAt?: number
}

interface ProjectRow {
  id: string
  owner_id: string
  name: string
  data: DocumentSnapshot
  thumbnail: string | null
  source_item_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
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

/** Newest first; the trash is not included. */
export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const { data, error } = await supabase.from('projects').select(META_COLUMNS).is('deleted_at', null).order('updated_at', { ascending: false })
  if (error) throw error
  return (data as MetaRow[]).map(toMeta)
}

/** The trash, most recently deleted first. Projects past their keep
 * period are purged on the way (the database does the same nightly). */
export async function listTrashedCloudProjects(): Promise<CloudProjectMeta[]> {
  const { error: purgeError } = await supabase.rpc('purge_deleted_projects')
  if (purgeError) console.warn('Could not purge the trash', purgeError)
  const { data, error } = await supabase.from('projects').select(`${META_COLUMNS}, deleted_at`).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  if (error) throw error
  return (data as (MetaRow & { deleted_at: string })[]).map((row) => ({ ...toMeta(row), deletedAt: Date.parse(row.deleted_at) }))
}

export async function restoreCloudProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}

/** Gone for good, trash or not. */
export async function purgeCloudProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

export async function loadCloudProject(id: string): Promise<{ snapshot: DocumentSnapshot; thumbnail: string | null } | null> {
  const { data, error } = await supabase.from('projects').select('data, thumbnail, source_item_id').eq('id', id).maybeSingle()
  if (error) throw error
  const row = data as Pick<ProjectRow, 'data' | 'thumbnail' | 'source_item_id'> | null
  const snapshot = row?.data
  if (row?.source_item_id) saveProjectSource(id, row.source_item_id)
  return snapshot && snapshot.version === 1 ? { snapshot, thumbnail: row?.thumbnail ?? null } : null
}

/** Upserts the document; `thumbnail` is left untouched when undefined. */
export async function saveCloudProject(id: string, snapshot: DocumentSnapshot, thumbnail?: string | null): Promise<CloudProjectMeta> {
  const owner_id = await currentUserId()
  if (!owner_id) throw new Error('Not signed in')

  const row: Partial<ProjectRow> = { id, owner_id, name: snapshot.name, data: snapshot }
  if (thumbnail !== undefined) row.thumbnail = thumbnail
  const source = loadProjectSource(id)
  if (source) row.source_item_id = source
  const { data, error } = await supabase.from('projects').upsert(row).select(META_COLUMNS).single()
  if (error) throw error
  return toMeta(data as MetaRow)
}

/** To the trash: restorable from the Trash page for a month. */
export async function deleteCloudProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
