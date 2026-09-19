// Supabase Edge Function: account self-service that needs the service role.
//
//   DELETE /account   deletes the calling user (auth row + everything that
//                     cascades from it: profile, projects, assets, shares)
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
// by the platform automatically.

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'DELETE') return json(405, { error: 'Method not allowed' })

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'Sign in first' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await anonClient.auth.getUser(jwt)
  if (userError || !userData.user) return json(401, { error: 'Sign in first' })
  const userId = userData.user.id

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Storage objects do not cascade from auth.users; clear the user's folders.
  for (const bucket of ['avatars', 'community']) {
    const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 })
    if (files && files.length > 0) {
      await admin.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`))
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return json(500, { error: error.message })
  return json(200, { ok: true })
})
