import { supabase } from './client'
import type { DocumentSnapshot } from '../persistence/localProjects'

export type CommunityStatus = 'published' | 'hidden' | 'removed'

/** A shared model as listed on the community pages (no geometry). */
export interface CommunityItem {
  id: string
  ownerId: string
  sourceProjectId: string | null
  title: string
  description: string
  notes: string
  tags: string[]
  thumbnail: string | null
  status: CommunityStatus
  featured: boolean
  downloads: number
  createdAt: number
  updatedAt: number
  author: { displayName: string; avatarUrl: string | null }
  /** Shape count, from the stored document. */
  shapeCount: number
}

export interface CommunityItemFull extends CommunityItem {
  data: DocumentSnapshot
}

export interface CommunityDraft {
  title: string
  description: string
  notes: string
  tags: string[]
}

interface ItemRow {
  id: string
  owner_id: string
  source_project_id: string | null
  title: string
  description: string
  notes: string
  tags: string[]
  thumbnail: string | null
  status: CommunityStatus
  featured: boolean
  downloads: number
  created_at: string
  updated_at: string
  shape_count: number | null
  profiles: { display_name: string; avatar_url: string | null } | null
}

const LIST_COLUMNS = 'id, owner_id, source_project_id, title, description, notes, tags, thumbnail, status, featured, downloads, created_at, updated_at, shape_count:data->order, profiles(display_name, avatar_url)'

const toItem = (row: ItemRow): CommunityItem => ({
  id: row.id,
  ownerId: row.owner_id,
  sourceProjectId: row.source_project_id,
  title: row.title,
  description: row.description,
  notes: row.notes,
  tags: row.tags ?? [],
  thumbnail: row.thumbnail,
  status: row.status,
  featured: row.featured,
  downloads: row.downloads,
  createdAt: Date.parse(row.created_at),
  updatedAt: Date.parse(row.updated_at),
  author: { displayName: row.profiles?.display_name || 'Someone', avatarUrl: row.profiles?.avatar_url ?? null },
  shapeCount: Array.isArray(row.shape_count) ? (row.shape_count as unknown[]).length : 0,
})

export interface ListOptions {
  /** Case-insensitive match on title, description and tags. */
  query?: string
  /** Only this author's items (every status the caller may see). */
  ownerId?: string
  /** Staff: include hidden / removed items. */
  includeUnpublished?: boolean
  limit?: number
}

/** Featured first, then newest. */
export async function listCommunityItems(options: ListOptions = {}): Promise<CommunityItem[]> {
  let q = supabase.from('community_items').select(LIST_COLUMNS).order('featured', { ascending: false }).order('created_at', { ascending: false })
  if (!options.includeUnpublished && !options.ownerId) q = q.eq('status', 'published')
  if (options.ownerId) q = q.eq('owner_id', options.ownerId)
  const term = options.query?.trim()
  if (term) {
    const like = `%${term.replace(/[%_]/g, '')}%`
    q = q.or(`title.ilike.${like},description.ilike.${like},tags.cs.{${term.replace(/[{}",]/g, '')}}`)
  }
  if (options.limit) q = q.limit(options.limit)
  const { data, error } = await q
  if (error) throw error
  return (data as unknown as ItemRow[]).map(toItem)
}

export async function getCommunityItem(id: string): Promise<CommunityItemFull | null> {
  const { data, error } = await supabase.from('community_items').select(`${LIST_COLUMNS}, data`).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as ItemRow & { data: DocumentSnapshot }
  return { ...toItem(row), data: row.data }
}

/** The caller's item published from this project, if any. */
export async function findMyCommunityItemForProject(projectId: string): Promise<CommunityItem | null> {
  const { data: userData } = await supabase.auth.getUser()
  const owner = userData.user?.id
  if (!owner) return null
  const { data, error } = await supabase
    .from('community_items')
    .select(LIST_COLUMNS)
    .eq('owner_id', owner)
    .eq('source_project_id', projectId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? toItem(data as unknown as ItemRow) : null
}

export async function publishCommunityItem(projectId: string, snapshot: DocumentSnapshot, thumbnail: string | null, draft: CommunityDraft): Promise<CommunityItem> {
  const { data: userData } = await supabase.auth.getUser()
  const owner_id = userData.user?.id
  if (!owner_id) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('community_items')
    .insert({ owner_id, source_project_id: projectId, title: draft.title, description: draft.description, notes: draft.notes, tags: draft.tags, data: snapshot, thumbnail })
    .select(LIST_COLUMNS)
    .single()
  if (error) throw error
  return toItem(data as unknown as ItemRow)
}

/** Edits the texts and, when a snapshot is given, replaces the shared copy
 * of the model with the current project. */
export async function updateCommunityItem(id: string, patch: Partial<CommunityDraft> & { status?: 'published' | 'hidden'; snapshot?: DocumentSnapshot; thumbnail?: string | null }): Promise<CommunityItem> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.description !== undefined) row.description = patch.description
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.tags !== undefined) row.tags = patch.tags
  if (patch.status !== undefined) row.status = patch.status
  if (patch.snapshot !== undefined) row.data = patch.snapshot
  if (patch.thumbnail !== undefined) row.thumbnail = patch.thumbnail
  const { data, error } = await supabase.from('community_items').update(row).eq('id', id).select(LIST_COLUMNS).single()
  if (error) throw error
  return toItem(data as unknown as ItemRow)
}

export async function deleteCommunityItem(id: string): Promise<void> {
  const { error } = await supabase.from('community_items').delete().eq('id', id)
  if (error) throw error
}

/** Staff only (the row trigger ignores these fields for everyone else). */
export async function moderateCommunityItem(id: string, patch: { status?: CommunityStatus; featured?: boolean }): Promise<CommunityItem> {
  const { data, error } = await supabase.from('community_items').update(patch).eq('id', id).select(LIST_COLUMNS).single()
  if (error) throw error
  return toItem(data as unknown as ItemRow)
}

export async function recordCommunityDownload(id: string): Promise<void> {
  const { error } = await supabase.rpc('record_community_download', { p_item: id })
  if (error) console.warn('Could not count the download', error)
}

export function parseTags(input: string): string[] {
  const seen = new Set<string>()
  for (const raw of input.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase().replace(/^#/, '').slice(0, 24)
    if (tag) seen.add(tag)
  }
  return [...seen].slice(0, 8)
}
