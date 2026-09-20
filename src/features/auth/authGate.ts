import { create } from 'zustand'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuthStore } from './useAuthStore'

/** Features a guest cannot use; the gate sheet explains each one. */
export type GatedFeature = 'cloud' | 'community' | 'collections' | 'social' | 'assets' | 'account'

export const GATE_COPY: Record<GatedFeature, { title: string; reason: string }> = {
  cloud: { title: 'Sign in to save to the cloud', reason: 'As a guest your projects live only in this browser. An account backs them up and opens them on any device.' },
  community: { title: 'Sign in to publish', reason: 'Community models are tied to the account that shares them, so you can update or remove them later.' },
  collections: { title: 'Sign in to keep collections', reason: 'Collections save the community models you want to come back to, and follow your account.' },
  social: { title: 'Sign in to join in', reason: 'Likes and comments are tied to an account so people know who they are talking to.' },
  assets: { title: 'Sign in to sync your assets', reason: 'Personal assets follow your account across projects and devices. As a guest they stay in this browser.' },
  account: { title: 'Sign in to manage your account', reason: 'There is no account to manage while browsing as a guest.' },
}

interface AuthGateState {
  /** The feature a guest just tried to use, or null when nothing is pending. */
  pending: GatedFeature | null
  open: (feature: GatedFeature) => void
  close: () => void
}

export const useAuthGate = create<AuthGateState>((set) => ({
  pending: null,
  open: (feature) => set({ pending: feature }),
  close: () => set({ pending: null }),
}))

/** True when the caller may go ahead; otherwise opens the sign-in gate for
 * `feature` and returns false. With no Supabase configured nothing is
 * gated, since there is nothing to sign in to. */
export function requireAccount(feature: GatedFeature): boolean {
  if (!isSupabaseConfigured) return false
  if (useAuthStore.getState().user) return true
  useAuthGate.getState().open(feature)
  return false
}

export const isGuest = () => isSupabaseConfigured && !useAuthStore.getState().loading && useAuthStore.getState().user === null
