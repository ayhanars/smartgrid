import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase/client'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  signInWithEmail: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => {
  supabase.auth.getSession().then(({ data }) => {
    set({ session: data.session, user: data.session?.user ?? null, loading: false })
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    set({ session, user: session?.user ?? null, loading: false })
  })

  return {
    session: null,
    user: null,
    loading: true,
    signInWithEmail: async (email: string) => {
      const { error } = await supabase.auth.signInWithOtp({ email })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
})
