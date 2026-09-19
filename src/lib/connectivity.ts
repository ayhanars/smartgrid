import { create } from 'zustand'

/** Whether the browser thinks it has a network. `navigator.onLine` is
 * optimistic (a captive portal still counts as online), so cloud calls
 * treat their own failures as the real signal and this as the early one. */
interface ConnectivityState {
  online: boolean
}

export const useConnectivity = create<ConnectivityState>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
}))

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useConnectivity.setState({ online: true }))
  window.addEventListener('offline', () => useConnectivity.setState({ online: false }))
}

export const isOnline = () => useConnectivity.getState().online

/** Runs `fn` the next time the browser reports it is back online (once). */
export function whenOnline(fn: () => void): () => void {
  if (isOnline()) {
    fn()
    return () => {}
  }
  const unsub = useConnectivity.subscribe((s) => {
    if (s.online) {
      unsub()
      fn()
    }
  })
  return unsub
}

/** A network failure from fetch / supabase-js, as opposed to a server
 * answer like 401 or a Postgres error. */
export function isNetworkError(err: unknown): boolean {
  if (!isOnline()) return true
  const message = err instanceof Error ? err.message : String(err)
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message)
}
