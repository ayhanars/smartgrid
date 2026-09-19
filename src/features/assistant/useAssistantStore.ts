import { create } from 'zustand'
import { useDocumentStore } from '../../state/documentStore'
import { describeDocument } from './documentContext'
import { streamAssistantReply, type AssistantTurn } from './assistantClient'

export interface AssistantMessage extends AssistantTurn {
  id: number
  /** True while this assistant reply is still streaming in. */
  pending?: boolean
  error?: string
}

interface AssistantState {
  messages: AssistantMessage[]
  busy: boolean
  /** Output tokens left today, as last reported by the server. */
  remaining: number | null
  send: (text: string) => Promise<void>
  stop: () => void
  clear: () => void
}

const MAX_HISTORY_TURNS = 20
let counter = 0
let controller: AbortController | null = null

export const useAssistantStore = create<AssistantState>((set, get) => ({
  messages: [],
  busy: false,
  remaining: null,

  send: async (text) => {
    const content = text.trim()
    if (!content || get().busy) return
    const userMsg: AssistantMessage = { id: ++counter, role: 'user', content }
    const replyId = ++counter
    const history = [...get().messages.filter((m) => !m.error && m.content), userMsg]
    set({
      busy: true,
      messages: [...history, { id: replyId, role: 'assistant', content: '', pending: true }],
    })

    const turns: AssistantTurn[] = history.slice(-MAX_HISTORY_TURNS).map(({ role, content }) => ({ role, content }))
    const context = describeDocument(useDocumentStore.getState())
    controller = new AbortController()

    const patch = (update: Partial<AssistantMessage>) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === replyId ? { ...m, ...update } : m)) }))

    try {
      const result = await streamAssistantReply(
        turns,
        context,
        (delta) => set((s) => ({ messages: s.messages.map((m) => (m.id === replyId ? { ...m, content: m.content + delta } : m)) })),
        controller.signal,
      )
      patch({ pending: false, error: result.refusal ? `Claude declined: ${result.refusal}` : undefined })
      set({ remaining: result.remaining })
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      patch({ pending: false, error: aborted ? undefined : err instanceof Error ? err.message : 'Assistant error' })
    } finally {
      controller = null
      set({ busy: false })
    }
  },

  stop: () => controller?.abort(),
  clear: () => {
    controller?.abort()
    set({ messages: [], busy: false })
  },
}))
