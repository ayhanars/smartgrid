import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client'

interface AuthState {
  /** True while the initial session lookup is still running. */
  loading: boolean
  session: Session | null
  user: User | null
  /** Sends a magic link; resolves once the email is queued. */
  signInWithEmail: (email: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

/** Where auth redirects land after a magic link / OAuth round trip: the
 * app's own origin plus its base path (`/smartgrid/` on GitHub Pages, `/`
 * on a custom domain). Must be listed in Supabase → Auth → URL Configuration. */
export function authRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export const useAuthStore = create<AuthState>((set) => {
  if (isSupabaseConfigured) {
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, user: data.session?.user ?? null, loading: false })
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, loading: false })
    })
  }

  return {
    loading: isSupabaseConfigured,
    session: null,
    user: null,
    signInWithEmail: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authRedirectUrl() },
      })
      if (error) throw error
    },
    signInWithGoogle: async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectUrl() },
      })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
})

/** Convenience for non-React code: the current access token, if signed in. */
export function currentAccessToken(): string | null {
  return useAuthStore.getState().session?.access_token ?? null
}
