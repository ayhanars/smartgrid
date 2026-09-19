import { useEffect, useState, type FormEvent } from 'react'
import { Mail, X } from 'lucide-react'
import { useAuthStore } from './useAuthStore'
import './AuthDialog.css'

interface AuthDialogProps {
  onClose: () => void
}

/** Sign-in sheet: a magic link by email, or Google. Nothing to remember,
 * no passwords to store. */
export function AuthDialog({ onClose }: AuthDialogProps) {
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const user = useAuthStore((s) => s.user)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) onClose()
  }, [user, onClose])

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await signInWithEmail(trimmed)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link')
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
      setBusy(false)
    }
  }

  return (
    <div className="auth-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <button type="button" className="auth-dialog__close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
        <h2 id="auth-dialog-title">Sign in to smartgrid</h2>
        <p className="auth-dialog__lead">Keep your projects in the cloud, open them anywhere, and use the design assistant.</p>

        {sent ? (
          <div className="auth-dialog__sent">
            <Mail size={20} />
            <strong>Check your inbox</strong>
            <span>We sent a sign-in link to {email.trim()}. Open it on this device to finish.</span>
          </div>
        ) : (
          <>
            <button type="button" className="auth-dialog__google" disabled={busy} onClick={google}>
              <GoogleMark />
              Continue with Google
            </button>
            <div className="auth-dialog__or">
              <span>or</span>
            </div>
            <form className="auth-dialog__form" onSubmit={submit}>
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="auth-dialog__submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          </>
        )}
        {error && <p className="auth-dialog__error" role="alert">{error}</p>}
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}
