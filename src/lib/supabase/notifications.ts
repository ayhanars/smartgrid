import { supabase } from './client'

export interface Notification {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: number
}

interface Row {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  read: boolean
  created_at: string
}

const toNotification = (r: Row): Notification => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: r.read, createdAt: Date.parse(r.created_at) })

/** Newest first, capped. */
export async function listNotifications(limit = 40): Promise<Notification[]> {
  const { data, error } = await supabase.from('notifications').select('id, kind, title, body, link, read, created_at').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data as Row[]).map(toNotification)
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids)
  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('read', false)
  if (error) throw error
}
