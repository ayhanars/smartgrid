import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client'
import { loadProfile, type Profile } from '../../lib/supabase/profiles'

interface AuthState {
  /** True while the initial session lookup is still running. */
  loading: boolean
  session: Session | null
  user: User | null
  /** The user's `profiles` row; null until loaded or when signed out. */
  profile: Profile | null
  /** Set when the app was opened from a password-recovery email: the user
   * is signed in but must choose a new password. */
  recovering: boolean
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  /** Emails a link that signs the user in and opens the new-password form. */
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  updateEmail: (email: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  setProfile: (profile: Profile | null) => void
  clearRecovering: () => void
}

/** Where auth redirects land after an email link / OAuth round trip: the
 * app's own origin plus its base path (`/smartgrid/` on GitHub Pages, `/`
 * on a custom domain). Must be listed in Supabase → Auth → URL Configuration. */
export function authRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export const useAuthStore = create<AuthState>((set, get) => {
  const fetchProfile = async (user: User | null) => {
    if (!user) {
      set({ profile: null })
      return
    }
    try {
      set({ profile: await loadProfile(user.id) })
    } catch (err) {
      console.warn('Could not load profile', err)
    }
  }

  if (isSupabaseConfigured) {
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, user: data.session?.user ?? null, loading: false })
      void fetchProfile(data.session?.user ?? null)
    })
    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null
      const previous = get().user
      set({ session, user, loading: false, ...(event === 'PASSWORD_RECOVERY' ? { recovering: true } : {}) })
      if (user?.id !== previous?.id || event === 'USER_UPDATED') void fetchProfile(user)
    })
  }

  return {
    loading: isSupabaseConfigured,
    session: null,
    user: null,
    profile: null,
    recovering: false,
    signUp: async (email, password, displayName) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: authRedirectUrl(), data: { display_name: displayName } },
      })
      if (error) throw error
      // Supabase answers an already-registered email with a user that has
      // no identities rather than an error, to avoid leaking who has an
      // account. Surface that as a normal sign-in hint instead.
      if (data.user && data.user.identities?.length === 0) throw new Error('That email already has an account. Sign in instead.')
      return { needsConfirmation: data.session === null }
    },
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signInWithGoogle: async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectUrl() },
      })
      if (error) throw error
    },
    requestPasswordReset: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() })
      if (error) throw error
    },
    updatePassword: async (password) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      set({ recovering: false })
    },
    updateEmail: async (email) => {
      const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: authRedirectUrl() })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
      set({ profile: null, recovering: false })
    },
    refreshProfile: () => fetchProfile(get().user),
    setProfile: (profile) => set({ profile }),
    clearRecovering: () => set({ recovering: false }),
  }
})

/** Convenience for non-React code: the current access token, if signed in. */
export function currentAccessToken(): string | null {
  return useAuthStore.getState().session?.access_token ?? null
}

export const isStaffRole = (profile: Profile | null) => profile?.role === 'admin' || profile?.role === 'moderator'
