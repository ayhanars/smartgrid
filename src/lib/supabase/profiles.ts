import { currentUserId, supabase } from './client'

export type UserRole = 'user' | 'moderator' | 'admin'

/** The public half of an account: what other people (and the community
 * pages) see. Mirrors `public.profiles`. */
export interface Profile {
  id: string
  displayName: string
  avatarUrl: string | null
  role: UserRole
  xp: number
  level: number
  bio: string
  followers: number
  following: number
  createdAt: number
  /** Set by an admin: nothing this account shared is public and it cannot post. */
  bannedAt: number | null
  banReason: string
}

interface ProfileRow {
  id: string
  display_name: string
  avatar_url: string | null
  role: UserRole
  xp: number
  level: number
  bio: string | null
  followers: number | null
  following: number | null
  created_at: string
  banned_at?: string | null
  ban_reason?: string | null
}

const toProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  role: row.role,
  xp: row.xp ?? 0,
  level: row.level ?? 1,
  bio: row.bio ?? '',
  followers: row.followers ?? 0,
  following: row.following ?? 0,
  createdAt: Date.parse(row.created_at),
  bannedAt: row.banned_at ? Date.parse(row.banned_at) : null,
  banReason: row.ban_reason ?? '',
})

const COLUMNS = 'id, display_name, avatar_url, role, xp, level, bio, followers, following, created_at, banned_at, ban_reason'

export async function loadProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? toProfile(data as ProfileRow) : null
}

export async function updateProfile(id: string, patch: { displayName?: string; avatarUrl?: string | null; bio?: string }): Promise<Profile> {
  const row: Partial<ProfileRow> = {}
  if (patch.bio !== undefined) row.bio = patch.bio
  if (patch.displayName !== undefined) row.display_name = patch.displayName
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl
  const { data, error } = await supabase.from('profiles').update(row).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return toProfile(data as ProfileRow)
}

const AVATAR_SIZE = 256

/** Squares and shrinks an image file on a canvas so avatars stay small
 * whatever the camera produced. */
export async function prepareAvatar(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That file is not an image we can read'))
      el.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - side) / 2
    const sy = (img.naturalHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process the image')
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Uploads to `avatars/<user id>/avatar.png` and returns a public URL with a
 * cache-buster so the new picture shows up immediately. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const blob = await prepareAvatar(file)
  const path = `${userId}/avatar.png`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/png' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.storage.from('avatars').remove([`${userId}/avatar.png`])
  if (error) throw error
}

/** XP needed to reach `level`: 50 · L · (L − 1). Mirrors xp_to_level in
 * the database. */
export const xpForLevel = (level: number) => 50 * level * (level - 1)

/** Progress inside the current level, for a bar. */
export function levelProgress(xp: number, level: number): { current: number; needed: number; fraction: number } {
  const start = xpForLevel(level)
  const end = xpForLevel(level + 1)
  const current = Math.max(0, xp - start)
  const needed = end - start
  return { current, needed, fraction: Math.min(1, current / needed) }
}

// --- Following -----------------------------------------------------------------

export async function isFollowing(userId: string): Promise<boolean> {
  const me = await currentUserId()
  if (!me || me === userId) return false
  const { data, error } = await supabase.from('follows').select('followee_id').eq('follower_id', me).eq('followee_id', userId).maybeSingle()
  if (error) throw error
  return !!data
}

export async function setFollowing(userId: string, follow: boolean): Promise<void> {
  const me = await currentUserId()
  if (!me) throw new Error('Not signed in')
  if (follow) {
    const { error } = await supabase.from('follows').upsert({ follower_id: me, followee_id: userId })
    if (error) throw error
  } else {
    const { error } = await supabase.from('follows').delete().eq('follower_id', me).eq('followee_id', userId)
    if (error) throw error
  }
}

/** Ids of the people the signed-in user follows. */
export async function listFollowing(): Promise<string[]> {
  const me = await currentUserId()
  if (!me) return []
  const { data, error } = await supabase.from('follows').select('followee_id').eq('follower_id', me)
  if (error) throw error
  return (data as { followee_id: string }[]).map((r) => r.followee_id)
}

export async function listFollowers(userId: string): Promise<Profile[]> {
  const { data, error } = await supabase.from('follows').select(`profiles!follows_follower_id_fkey(${COLUMNS})`).eq('followee_id', userId).limit(60)
  if (error) throw error
  return (data as unknown as { profiles: ProfileRow | null }[]).map((r) => r.profiles).filter((p): p is ProfileRow => !!p).map(toProfile)
}
