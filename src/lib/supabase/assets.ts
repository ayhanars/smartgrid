import { currentUserId, supabase } from './client'
import type { AssetDefinition } from '../assets/types'

interface AssetRow {
  id: string
  owner_id: string
  name: string
  data: AssetDefinition
  updated_at: string
}

/** The signed-in user's assets, newest first. */
export async function listCloudAssets(): Promise<AssetDefinition[]> {
  const { data, error } = await supabase.from('user_assets').select('id, data').order('updated_at', { ascending: false })
  if (error) throw error
  return (data as Pick<AssetRow, 'id' | 'data'>[]).map((row) => ({ ...row.data, id: row.id }))
}

export async function upsertCloudAssets(assets: AssetDefinition[]): Promise<void> {
  if (assets.length === 0) return
  const owner_id = await currentUserId()
  if (!owner_id) throw new Error('Not signed in')
  const rows = assets.map((a) => ({ id: a.id, owner_id, name: a.name, data: a }))
  const { error } = await supabase.from('user_assets').upsert(rows)
  if (error) throw error
}

export async function deleteCloudAsset(id: string): Promise<void> {
  const { error } = await supabase.from('user_assets').delete().eq('id', id)
  if (error) throw error
}
