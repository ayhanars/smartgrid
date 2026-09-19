import { create } from 'zustand'
import type { AssetDefinition } from '../lib/assets/types'
import { loadUserAssets, saveUserAssets } from '../lib/assets/userAssets'
import { deleteCloudAsset, listCloudAssets, upsertCloudAssets } from '../lib/supabase/assets'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { useAuthStore } from '../features/auth/useAuthStore'
import { isNetworkError, useConnectivity } from '../lib/connectivity'

/**
 * The user's own assets ("My assets"): always kept in this browser, and
 * mirrored to the cloud while signed in so they show up in every project
 * on every device. Cloud failures never lose an asset — the local copy is
 * the working set and the next sync pushes what is missing.
 */
interface UserAssetsState {
  assets: AssetDefinition[]
  /** off: guest / no Supabase. Otherwise the last cloud round trip. */
  status: 'off' | 'syncing' | 'synced' | 'offline' | 'error'
  add: (asset: AssetDefinition) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  /** Pull the cloud set, merge with local, push anything local-only. */
  sync: () => Promise<void>
}

/** Ids removed locally while offline / signed out, deleted in the cloud on
 * the next sync so they do not come back. */
const TOMBSTONES_KEY = 'smartgrid:assets:deleted'

function readTombstones(): string[] {
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeTombstones(ids: string[]) {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(ids))
  } catch {
    /* best effort */
  }
}

const signedIn = () => isSupabaseConfigured && useAuthStore.getState().user !== null

export const useUserAssets = create<UserAssetsState>((set, get) => ({
  assets: loadUserAssets(),
  status: 'off',

  add: (asset) => {
    const assets = [asset, ...get().assets.filter((a) => a.id !== asset.id)]
    set({ assets })
    saveUserAssets(assets)
    if (!signedIn()) return
    set({ status: 'syncing' })
    upsertCloudAssets([asset])
      .then(() => set({ status: 'synced' }))
      .catch((err) => {
        console.warn('Asset upload failed', err)
        set({ status: isNetworkError(err) ? 'offline' : 'error' })
      })
  },

  rename: (id, name) => {
    const trimmed = name.trim()
    const current = get().assets.find((a) => a.id === id)
    if (!current || !trimmed || trimmed === current.name) return
    const renamed = { ...current, name: trimmed }
    const assets = get().assets.map((a) => (a.id === id ? renamed : a))
    set({ assets })
    saveUserAssets(assets)
    if (!signedIn()) return
    upsertCloudAssets([renamed]).catch((err) => {
      console.warn('Asset rename upload failed', err)
      set({ status: isNetworkError(err) ? 'offline' : 'error' })
    })
  },

  remove: (id) => {
    const assets = get().assets.filter((a) => a.id !== id)
    set({ assets })
    saveUserAssets(assets)
    writeTombstones([...readTombstones().filter((t) => t !== id), id])
    if (!signedIn()) return
    deleteCloudAsset(id)
      .then(() => writeTombstones(readTombstones().filter((t) => t !== id)))
      .catch((err) => console.warn('Asset delete failed', err))
  },

  sync: async () => {
    if (!signedIn()) {
      set({ status: 'off' })
      return
    }
    set({ status: 'syncing' })
    try {
      const tombstones = readTombstones()
      for (const id of tombstones) await deleteCloudAsset(id)
      writeTombstones([])
      const remote = await listCloudAssets()
      const remoteIds = new Set(remote.map((a) => a.id))
      const local = get().assets
      const localOnly = local.filter((a) => !remoteIds.has(a.id))
      if (localOnly.length) await upsertCloudAssets(localOnly)
      // Cloud order first (newest), then anything that was only here.
      const merged = [...remote, ...localOnly]
      set({ assets: merged, status: 'synced' })
      saveUserAssets(merged)
    } catch (err) {
      console.warn('Asset sync failed', err)
      set({ status: isNetworkError(err) ? 'offline' : 'error' })
    }
  },
}))

// Sync whenever a user signs in, and again when the network comes back
// after a failed round trip.
let lastUserId: string | null = null
useAuthStore.subscribe((s) => {
  const id = s.user?.id ?? null
  if (id === lastUserId) return
  lastUserId = id
  void useUserAssets.getState().sync()
})
useConnectivity.subscribe((s, prev) => {
  if (s.online && !prev.online && useUserAssets.getState().status === 'offline') void useUserAssets.getState().sync()
})
