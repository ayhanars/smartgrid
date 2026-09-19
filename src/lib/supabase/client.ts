import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False when the build has no Supabase credentials: the app then runs in
 * guest mode (no sign-in, no cloud sync, no community). */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase env vars are missing. Copy .env.example to .env.local and fill in your project credentials.',
  )
}

export const supabase = createClient(supabaseUrl ?? 'https://placeholder.supabase.co', supabaseAnonKey ?? 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Base URL of the project's Edge Functions (`<project>/functions/v1`). */
export const functionsUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1` : null

export const supabaseAnonKeyValue = supabaseAnonKey ?? ''
