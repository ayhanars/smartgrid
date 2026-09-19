import { useEffect, useState, type FormEvent } from 'react'
import { Mail, X } from 'lucide-react'
import { useAuthStore } from './useAuthStore'
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from './authErrors'
import './AuthDialog.css'

type Mode = 'signin' | 'signup' | 'reset'

interface AuthDialogProps {
  onClose: () => void
  /** Why the dialog opened, shown under the title (guest-mode prompts). */
  reason?: string
  initialMode?: Mode
}

/** Sign-in sheet: email + password (create an account, sign in, or reset a
 * forgotten password), or Google. */
export function AuthDialog({ onClose, reason, initialMode = 'signin' }: AuthDialogProps) {
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const user = useAuthStore((s) => s.user)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<'confirm' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (user) onClose()
  }, [user, onClose])

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setSent(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') {
        await signIn(trimmedEmail, password)
      } else if (mode === 'signup') {
        if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`)
        const { needsConfirmation } = await signUp(trimmedEmail, password, name.trim() || trimmedEmail.split('@')[0])
        if (needsConfirmation) setSent('confirm')
      } else {
        await requestPasswordReset(trimmedEmail)
        setSent('reset')
      }
    } catch (err) {
      setError(friendlyAuthError(err))
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
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  const title = mode === 'signup' ? 'Create your smartgrid account' : mode === 'reset' ? 'Reset your password' : 'Sign in to smartgrid'
  const lead =
    reason ??
    (mode === 'reset'
      ? 'We will email you a link that signs you in and lets you choose a new password.'
      : 'Keep your projects in the cloud, open them anywhere, and share with the community.')

  return (
    <div className="auth-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <button type="button" className="auth-dialog__close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
        <h2 id="auth-dialog-title">{title}</h2>
        <p className="auth-dialog__lead">{lead}</p>

        {sent ? (
          <div className="auth-dialog__sent">
            <Mail size={20} />
            <strong>Check your inbox</strong>
            <span>
              {sent === 'confirm'
                ? `We sent a confirmation link to ${email.trim()}. Open it to activate your account, then sign in.`
                : `We sent a password reset link to ${email.trim()}. Open it on this device to choose a new password.`}
            </span>
          </div>
        ) : (
          <>
            {mode !== 'reset' && (
              <>
                <button type="button" className="auth-dialog__google" disabled={busy} onClick={google}>
                  <GoogleMark />
                  Continue with Google
                </button>
                <div className="auth-dialog__or">
                  <span>or</span>
                </div>
              </>
            )}
            <form className="auth-dialog__form" onSubmit={submit}>
              {mode === 'signup' && (
                <>
                  <label htmlFor="auth-name">Name</label>
                  <input id="auth-name" type="text" autoComplete="name" autoFocus placeholder="How you appear to others" value={name} onChange={(e) => setName(e.target.value)} />
                </>
              )}
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                autoFocus={mode !== 'signup'}
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode !== 'reset' && (
                <>
                  <label htmlFor="auth-password">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
                    placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </>
              )}
              <button type="submit" className="auth-dialog__submit" disabled={busy || !email.trim() || (mode !== 'reset' && !password)}>
                {busy ? 'Working…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Email me a reset link' : 'Sign in'}
              </button>
            </form>
            <div className="auth-dialog__links">
              {mode === 'signin' && (
                <>
                  <button type="button" onClick={() => switchMode('reset')}>
                    Forgot password?
                  </button>
                  <button type="button" onClick={() => switchMode('signup')}>
                    Create an account
                  </button>
                </>
              )}
              {mode === 'signup' && (
                <button type="button" onClick={() => switchMode('signin')}>
                  Already have an account? Sign in
                </button>
              )}
              {mode === 'reset' && (
                <button type="button" onClick={() => switchMode('signin')}>
                  Back to sign in
                </button>
              )}
            </div>
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
