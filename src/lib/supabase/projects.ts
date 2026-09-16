import { supabase } from './client'

export interface ProjectRecord {
  id: string
  owner_id: string
  name: string
  data: unknown
  created_at: string
  updated_at: string
}

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function loadProject(id: string) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single()
  if (error) throw error
  return data as ProjectRecord
}

export async function saveProject(id: string | undefined, name: string, projectData: unknown) {
  const { data: userData } = await supabase.auth.getUser()
  const owner_id = userData.user?.id
  if (!owner_id) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from('projects')
    .upsert({ id, owner_id, name, data: projectData })
    .select()
    .single()
  if (error) throw error
  return data as ProjectRecord
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}
