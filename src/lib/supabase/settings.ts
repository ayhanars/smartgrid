import { create } from 'zustand'
import { isSupabaseConfigured, supabase } from './client'

/** Site-wide switches an admin can flip (public.site_settings). The
 * defaults are how the site behaved before the settings existed. */
export interface SiteSettings {
  /** Who may download a shared model's 3MF / STL. */
  downloadAccess: 'everyone' | 'members'
  /** New models and collections wait for a moderator. */
  requireApproval: boolean
  /** Members may publish new models (staff always can). */
  publishingOpen: boolean
  /** Members may comment (staff always can). */
  commentsOpen: boolean
  /** Days a deleted project stays in the trash. */
  trashDays: number
}

export const DEFAULT_SETTINGS: SiteSettings = { downloadAccess: 'everyone', requireApproval: true, publishingOpen: true, commentsOpen: true, trashDays: 30 }

const KEYS: Record<keyof SiteSettings, string> = { downloadAccess: 'download_access', requireApproval: 'require_approval', publishingOpen: 'publishing_open', commentsOpen: 'comments_open', trashDays: 'trash_days' }

export async function loadSiteSettings(): Promise<SiteSettings> {
  const { data, error } = await supabase.from('site_settings').select('key, value')
  if (error) throw error
  const rows = new Map((data as { key: string; value: unknown }[]).map((r) => [r.key, r.value]))
  const text = (k: string, fallback: string) => (typeof rows.get(k) === 'string' ? (rows.get(k) as string) : fallback)
  const bool = (k: string, fallback: boolean) => (typeof rows.get(k) === 'boolean' ? (rows.get(k) as boolean) : fallback)
  const num = (k: string, fallback: number) => (typeof rows.get(k) === 'number' ? (rows.get(k) as number) : fallback)
  return {
    downloadAccess: text(KEYS.downloadAccess, DEFAULT_SETTINGS.downloadAccess) === 'members' ? 'members' : 'everyone',
    requireApproval: bool(KEYS.requireApproval, DEFAULT_SETTINGS.requireApproval),
    publishingOpen: bool(KEYS.publishingOpen, DEFAULT_SETTINGS.publishingOpen),
    commentsOpen: bool(KEYS.commentsOpen, DEFAULT_SETTINGS.commentsOpen),
    trashDays: Math.max(1, Math.round(num(KEYS.trashDays, DEFAULT_SETTINGS.trashDays))),
  }
}

/** Admins only (RLS refuses everyone else). */
export async function saveSiteSetting<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const { error } = await supabase.from('site_settings').upsert({ key: KEYS[key], value, updated_at: new Date().toISOString(), updated_by: session.session?.user.id ?? null })
  if (error) throw error
}

interface SettingsState {
  settings: SiteSettings
  loaded: boolean
  refresh: () => Promise<void>
  set: <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => Promise<void>
}

/** The settings, loaded once per page load; `refresh` after changing them. */
export const useSiteSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: !isSupabaseConfigured,
  refresh: async () => {
    if (!isSupabaseConfigured) return
    try {
      set({ settings: await loadSiteSettings(), loaded: true })
    } catch (err) {
      console.warn('Could not load the site settings; using the defaults', err)
      set({ loaded: true })
    }
  },
  set: async (key, value) => {
    await saveSiteSetting(key, value)
    set({ settings: { ...get().settings, [key]: value } })
  },
}))

if (isSupabaseConfigured && typeof window !== 'undefined') void useSiteSettings.getState().refresh()
