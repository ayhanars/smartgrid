// Supabase Edge Function: the only place the Anthropic API key lives.
//
// The browser never talks to Anthropic directly. It sends the chat history
// plus a summary of the open document here with the user's Supabase JWT;
// this function checks the user is signed in, checks today's usage against
// the daily allowance, forwards the request to Claude and streams the reply
// back as server-sent events.
//
// Secrets (set with `supabase secrets set`):
//   ANTHROPIC_API_KEY        required
//   ASSISTANT_DAILY_TOKENS   optional, output tokens per user per UTC day (default 40000)
//   ASSISTANT_MODEL          optional, defaults to claude-opus-5
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
// by the platform automatically.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-opus-5'
const DAILY_OUTPUT_TOKENS = Number(Deno.env.get('ASSISTANT_DAILY_TOKENS') ?? 40000)
const MAX_TURNS = 30
const MAX_CHARS_PER_MESSAGE = 8000
const MAX_CONTEXT_CHARS = 12000

const SYSTEM_PROMPT = `You are the built-in assistant of smartgrid, a browser app where people draw 2D shapes and extrude them into 3D-printable models (STL / 3MF).

You help with: designing printable parts, choosing extrusion depths, bevels, holes, hollowing (shell), surface textures and perforation grids; slicer-style print settings (layer height, walls, infill); troubleshooting SVG imports; and general 3D-printing advice.

The user's currently open document is described below when available. Refer to shapes by their names. Give dimensions in the document's display unit. Be concise and practical; prefer short lists over long prose. When the user asks for something the app cannot do yet, say so plainly.`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  messages: ChatTurn[]
  /** Plain-text summary of the open document, built by the client. */
  context?: string
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseRequest(raw: unknown): ChatRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const { messages, context } = raw as Record<string, unknown>
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS) return null
  const turns: ChatTurn[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    if (content.length === 0 || content.length > MAX_CHARS_PER_MESSAGE) return null
    turns.push({ role, content })
  }
  if (turns[0].role !== 'user' || turns[turns.length - 1].role !== 'user') return null
  if (context !== undefined && typeof context !== 'string') return null
  return { messages: turns, context: context?.slice(0, MAX_CONTEXT_CHARS) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY is not configured' })

  // 1. Who is asking? Validate the user's JWT against Supabase Auth.
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json(401, { error: 'Sign in to use the assistant' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await anonClient.auth.getUser(jwt)
  if (userError || !userData.user) return json(401, { error: 'Sign in to use the assistant' })
  const userId = userData.user.id

  // 2. Has this user spent today's allowance?
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const today = new Date().toISOString().slice(0, 10)
  const { data: usage } = await admin
    .from('assistant_usage')
    .select('output_tokens')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle()
  const spent = usage?.output_tokens ?? 0
  if (spent >= DAILY_OUTPUT_TOKENS) {
    return json(429, {
      error: 'Daily assistant allowance used up. It resets at midnight UTC.',
      remaining: 0,
    })
  }

  // 3. Validate the payload.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }
  const request = parseRequest(body)
  if (!request) return json(400, { error: 'Invalid chat request' })

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ]
  if (request.context) system.push({ type: 'text', text: `Open document:\n${request.context}` })

  // 4. Stream Claude's reply back as SSE while tallying usage.
  const anthropic = new Anthropic({ apiKey })
  const encoder = new TextEncoder()
  const remainingBudget = Math.min(8000, DAILY_OUTPUT_TOKENS - spent)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      try {
        const run = anthropic.messages.stream({
          model: MODEL,
          max_tokens: Math.max(1024, remainingBudget),
          system,
          messages: request.messages,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
        })
        run.on('text', (delta) => send('text', { delta }))
        const final = await run.finalMessage()

        await admin.rpc('record_assistant_usage', {
          p_user_id: userId,
          p_input_tokens: final.usage.input_tokens,
          p_output_tokens: final.usage.output_tokens,
        })

        send('done', {
          stop_reason: final.stop_reason,
          refusal: final.stop_reason === 'refusal' ? final.stop_details?.explanation ?? null : null,
          remaining: Math.max(0, DAILY_OUTPUT_TOKENS - spent - final.usage.output_tokens),
        })
      } catch (err) {
        let message = 'The assistant is unavailable right now'
        if (err instanceof Anthropic.RateLimitError) message = 'The assistant is busy, try again in a moment'
        else if (err instanceof Anthropic.AuthenticationError) message = 'Assistant is misconfigured (invalid API key)'
        else if (err instanceof Anthropic.APIError) message = `Assistant error (${err.status})`
        console.error('claude function error', err)
        send('error', { error: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
})
