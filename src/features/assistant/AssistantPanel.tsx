import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Eraser, SendHorizontal, Sparkles, Square, X } from 'lucide-react'
import { useAuthStore } from '../auth/useAuthStore'
import { AuthDialog } from '../auth/AuthDialog'
import { useViewStore } from '../../state/viewStore'
import { assistantAvailable } from './assistantClient'
import { useAssistantStore } from './useAssistantStore'
import './AssistantPanel.css'

const SUGGESTIONS = [
  'Is this design printable as-is?',
  'Suggest wall and infill settings for a sturdy part',
  'How do I add a lid that fits this box?',
]

/** Chat column on the right of the editor. Every message goes through the
 * `claude` Edge Function, so it needs a signed-in user. */
export function AssistantPanel() {
  const user = useAuthStore((s) => s.user)
  const setOpen = useViewStore((s) => s.setAssistantOpen)
  const messages = useAssistantStore((s) => s.messages)
  const busy = useAssistantStore((s) => s.busy)
  const remaining = useAssistantStore((s) => s.remaining)
  const send = useAssistantStore((s) => s.send)
  const stop = useAssistantStore((s) => s.stop)
  const clear = useAssistantStore((s) => s.clear)
  const [draft, setDraft] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!draft.trim() || busy) return
    void send(draft)
    setDraft('')
    inputRef.current?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <aside className="assistant" aria-label="Design assistant">
      <header className="assistant__header">
        <span className="assistant__title">
          <Sparkles size={14} />
          Assistant
        </span>
        <span className="assistant__header-actions">
          {messages.length > 0 && (
            <button type="button" className="assistant__icon" aria-label="Clear conversation" title="Clear conversation" onClick={clear}>
              <Eraser size={14} />
            </button>
          )}
          <button type="button" className="assistant__icon" aria-label="Close assistant" onClick={() => setOpen(false)}>
            <X size={15} />
          </button>
        </span>
      </header>

      {!assistantAvailable() ? (
        <div className="assistant__empty">
          <strong>Assistant is not configured</strong>
          <span>This build has no Supabase project, so there is nothing to talk to yet.</span>
        </div>
      ) : !user ? (
        <div className="assistant__empty">
          <Sparkles size={22} />
          <strong>Sign in to chat with Claude</strong>
          <span>Ask about printability, wall thickness, fits and tolerances, or how to build something in smartgrid.</span>
          <button type="button" className="assistant__cta" onClick={() => setAuthOpen(true)}>
            Sign in
          </button>
          {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} />}
        </div>
      ) : (
        <>
          <div className="assistant__log" ref={logRef}>
            {messages.length === 0 && (
              <div className="assistant__intro">
                <p>Claude can see a summary of the open project: shapes, sizes, heights and print settings.</p>
                <div className="assistant__suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`assistant__msg assistant__msg--${m.role}`}>
                <div className="assistant__bubble">
                  {m.content}
                  {m.pending && !m.content && <span className="assistant__typing" aria-label="Thinking" />}
                </div>
                {m.error && <div className="assistant__error">{m.error}</div>}
              </div>
            ))}
          </div>
          <form className="assistant__composer" onSubmit={submit}>
            <textarea
              ref={inputRef}
              rows={2}
              placeholder="Ask about this design…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
            />
            {busy ? (
              <button type="button" className="assistant__send" aria-label="Stop" onClick={stop}>
                <Square size={14} />
              </button>
            ) : (
              <button type="submit" className="assistant__send" aria-label="Send" disabled={!draft.trim()}>
                <SendHorizontal size={15} />
              </button>
            )}
          </form>
          {remaining !== null && (
            <div className="assistant__quota">{remaining === 0 ? 'Daily allowance used up — resets at midnight UTC' : `${remaining.toLocaleString()} tokens left today`}</div>
          )}
        </>
      )}
    </aside>
  )
}
