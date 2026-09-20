import { currentUserId, supabase } from './client'

/** A person's named set of community models. */
export interface Collection {
  id: string
  ownerId: string
  name: string
  description: string
  isPublic: boolean
  createdAt: number
  updatedAt: number
  /** How many models are in it. */
  count: number
  /** Up to four thumbnails for the cover. */
  covers: string[]
  owner: { displayName: string; avatarUrl: string | null }
}

interface CollectionRow {
  id: string
  owner_id: string
  name: string
  description: string
  is_public: boolean
  created_at: string
  updated_at: string
  collection_items: { item_id: string; added_at: string; community_items: { thumbnail: string | null; status: string } | null }[]
  profiles: { display_name: string; avatar_url: string | null } | null
}

const COLUMNS = 'id, owner_id, name, description, is_public, created_at, updated_at, collection_items(item_id, added_at, community_items!collection_items_item_id_fkey(thumbnail, status)), profiles!collections_owner_id_fkey(display_name, avatar_url)'

const toCollection = (r: CollectionRow): Collection => {
  const items = (r.collection_items ?? []).filter((i) => i.community_items?.status === 'published').sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at))
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    description: r.description,
    isPublic: r.is_public,
    createdAt: Date.parse(r.created_at),
    updatedAt: Date.parse(r.updated_at),
    count: items.length,
    covers: items.map((i) => i.community_items?.thumbnail).filter((t): t is string => !!t).slice(0, 4),
    owner: { displayName: r.profiles?.display_name || 'Someone', avatarUrl: r.profiles?.avatar_url ?? null },
  }
}

/** The signed-in user's collections, most recently changed first. */
export async function listMyCollections(): Promise<Collection[]> {
  const owner = await currentUserId()
  if (!owner) return []
  const { data, error } = await supabase.from('collections').select(COLUMNS).eq('owner_id', owner).order('updated_at', { ascending: false })
  if (error) throw error
  return (data as unknown as CollectionRow[]).map(toCollection)
}

export async function getCollection(id: string): Promise<Collection | null> {
  const { data, error } = await supabase.from('collections').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? toCollection(data as unknown as CollectionRow) : null
}

/** Ids of the models in a collection, newest addition first. */
export async function listCollectionItemIds(id: string): Promise<string[]> {
  const { data, error } = await supabase.from('collection_items').select('item_id, added_at').eq('collection_id', id).order('added_at', { ascending: false })
  if (error) throw error
  return (data as { item_id: string }[]).map((r) => r.item_id)
}

export async function createCollection(name: string, description = '', isPublic = false): Promise<Collection> {
  const owner_id = await currentUserId()
  if (!owner_id) throw new Error('Not signed in')
  const { data, error } = await supabase.from('collections').insert({ owner_id, name: name.trim(), description, is_public: isPublic }).select(COLUMNS).single()
  if (error) throw error
  return toCollection(data as unknown as CollectionRow)
}

export async function updateCollection(id: string, patch: { name?: string; description?: string; isPublic?: boolean }): Promise<Collection> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.description !== undefined) row.description = patch.description
  if (patch.isPublic !== undefined) row.is_public = patch.isPublic
  const { data, error } = await supabase.from('collections').update(row).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return toCollection(data as unknown as CollectionRow)
}

export async function deleteCollection(id: string): Promise<void> {
  const { error } = await supabase.from('collections').delete().eq('id', id)
  if (error) throw error
}

/** Which of the user's collections hold this model. */
export async function collectionsContaining(itemId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('collection_items').select('collection_id').eq('item_id', itemId)
  if (error) throw error
  return new Set((data as { collection_id: string }[]).map((r) => r.collection_id))
}

export async function setInCollection(collectionId: string, itemId: string, inside: boolean): Promise<void> {
  if (inside) {
    const { error } = await supabase.from('collection_items').upsert({ collection_id: collectionId, item_id: itemId })
    if (error) throw error
  } else {
    const { error } = await supabase.from('collection_items').delete().eq('collection_id', collectionId).eq('item_id', itemId)
    if (error) throw error
  }
}
