import { create } from 'zustand'
import { listNotifications, markAllNotificationsRead, markNotificationsRead, type Notification } from '../lib/supabase/notifications'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { useAuthStore } from '../features/auth/useAuthStore'
import { useConnectivity } from '../lib/connectivity'

const POLL_MS = 60_000

/** The signed-in user's notifications, refreshed every minute, on focus
 * and after sign-in. Reads are optimistic. */
interface NotificationsState {
  items: Notification[]
  unread: number
  loaded: boolean
  refresh: () => Promise<void>
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
}

export const useNotifications = create<NotificationsState>((set) => ({
  items: [],
  unread: 0,
  loaded: false,
  refresh: async () => {
    if (!isSupabaseConfigured || !useAuthStore.getState().user || !useConnectivity.getState().online) return
    try {
      const items = await listNotifications()
      set({ items, unread: items.filter((n) => !n.read).length, loaded: true })
    } catch (err) {
      console.warn('Notifications refresh failed', err)
    }
  },
  markRead: async (ids) => {
    const set_ = new Set(ids)
    set((s) => {
      const items = s.items.map((n) => (set_.has(n.id) ? { ...n, read: true } : n))
      return { items, unread: items.filter((n) => !n.read).length }
    })
    await markNotificationsRead(ids).catch((err) => console.warn('Mark read failed', err))
  },
  markAllRead: async () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }))
    await markAllNotificationsRead().catch((err) => console.warn('Mark all read failed', err))
  },
}))

let timer: number | undefined
function schedule() {
  window.clearInterval(timer)
  timer = window.setInterval(() => void useNotifications.getState().refresh(), POLL_MS)
}

if (typeof window !== 'undefined') {
  let lastUser: string | null = null
  useAuthStore.subscribe((s) => {
    const id = s.user?.id ?? null
    if (id === lastUser) return
    lastUser = id
    if (id) {
      void useNotifications.getState().refresh()
      schedule()
    } else {
      window.clearInterval(timer)
      useNotifications.setState({ items: [], unread: 0, loaded: false })
    }
  })
  window.addEventListener('focus', () => void useNotifications.getState().refresh())
  useConnectivity.subscribe((s, prev) => {
    if (s.online && !prev.online) void useNotifications.getState().refresh()
  })
}
