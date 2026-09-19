import { functionsUrl, supabaseAnonKeyValue } from '../../lib/supabase/client'
import { currentAccessToken } from '../auth/useAuthStore'

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantResult {
  /** Output tokens left in today's allowance, when the server reported it. */
  remaining: number | null
  refusal: string | null
}

export const assistantAvailable = () => functionsUrl !== null

/**
 * Sends the conversation to the `claude` Edge Function and feeds text
 * deltas to `onDelta` as they stream in. Resolves once the reply is
 * complete; rejects with a readable message on any failure.
 */
export async function streamAssistantReply(
  messages: AssistantTurn[],
  context: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<AssistantResult> {
  if (!functionsUrl) throw new Error('Assistant is not configured for this build')
  const token = currentAccessToken()
  if (!token) throw new Error('Sign in to use the assistant')

  const response = await fetch(`${functionsUrl}/claude`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKeyValue,
    },
    body: JSON.stringify({ messages, context }),
    signal,
  })

  if (!response.ok) {
    let message = `Assistant request failed (${response.status})`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message)
  }
  if (!response.body) throw new Error('Empty response from assistant')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: AssistantResult = { remaining: null, refusal: null }

  const handle = (event: string, data: string) => {
    const payload = JSON.parse(data) as Record<string, unknown>
    if (event === 'text' && typeof payload.delta === 'string') onDelta(payload.delta)
    else if (event === 'done') {
      result = {
        remaining: typeof payload.remaining === 'number' ? payload.remaining : null,
        refusal: typeof payload.refusal === 'string' ? payload.refusal : null,
      }
    } else if (event === 'error') throw new Error(typeof payload.error === 'string' ? payload.error : 'Assistant error')
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length) handle(event, dataLines.join('\n'))
      sep = buffer.indexOf('\n\n')
    }
  }
  return result
}
