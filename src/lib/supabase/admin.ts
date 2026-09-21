import { supabase } from './client'
import type { UserRole } from './profiles'

export interface AdminStats {
  users: number
  users_7d: number
  users_banned: number
  projects_trashed: number
  reports_open: number
  projects: number
  assets: number
  community_published: number
  community_pending: number
  community_hidden: number
  community_removed: number
  community_downloads: number
  community_likes: number
  community_comments: number
  collections: number
}

export interface AdminUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  role: UserRole
  xp: number
  level: number
  createdAt: number
  lastSignInAt: number | null
  projects: number
  communityItems: number
  bannedAt: number | null
  banReason: string
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc('admin_stats')
  if (error) throw error
  return data as AdminStats
}

export async function fetchAdminUsers(query = ''): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_users', { p_query: query, p_limit: 200 })
  if (error) throw error
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    email: (r.email as string) ?? '',
    displayName: (r.display_name as string) ?? '',
    avatarUrl: (r.avatar_url as string | null) ?? null,
    role: ((r.role as UserRole) ?? 'user') as UserRole,
    xp: (r.xp as number) ?? 0,
    level: (r.level as number) ?? 1,
    createdAt: Date.parse(r.created_at as string),
    lastSignInAt: r.last_sign_in_at ? Date.parse(r.last_sign_in_at as string) : null,
    projects: (r.projects as number) ?? 0,
    communityItems: (r.community_items as number) ?? 0,
    bannedAt: r.banned_at ? Date.parse(r.banned_at as string) : null,
    banReason: (r.ban_reason as string) ?? '',
  }))
}

/** Admins only: the profiles trigger silently keeps the old role for
 * anyone else. */
export async function setUserRole(userId: string, role: UserRole): Promise<UserRole> {
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', userId).select('role').single()
  if (error) throw error
  return (data as { role: UserRole }).role
}

/** Admins only: hides everything the account shared and stops it posting;
 * `unbanUser` restores it all. The person is notified either way. */
export async function banUser(userId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('ban_user', { p_user: userId, p_reason: reason })
  if (error) throw error
}

export async function unbanUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unban_user', { p_user: userId })
  if (error) throw error
}
