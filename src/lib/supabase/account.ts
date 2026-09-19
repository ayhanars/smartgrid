import { functionsUrl, supabase, supabaseAnonKeyValue } from './client'

/** Deletes the signed-in user's account through the `account` Edge
 * Function (only the service role may delete auth users). Cloud data goes
 * with it through `on delete cascade`. */
export async function deleteAccount(): Promise<void> {
  if (!functionsUrl) throw new Error('This build has no Supabase project')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  const res = await fetch(`${functionsUrl}/account`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKeyValue },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Delete failed (${res.status})`)
  }
  await supabase.auth.signOut()
}
