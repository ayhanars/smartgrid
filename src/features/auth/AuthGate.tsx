import { useEffect, useState } from 'react'
import { CloudOff, X } from 'lucide-react'
import { useAuthGate, GATE_COPY } from './authGate'
import { AuthDialog } from './AuthDialog'
import './AuthDialog.css'

/** Mounted once at the app root: whenever a guest hits a feature that
 * needs an account, this explains why and offers to sign in. */
export function AuthGate() {
  const pending = useAuthGate((s) => s.pending)
  const close = useAuthGate((s) => s.close)
  const [showAuth, setShowAuth] = useState(false)

  useEffect(() => {
    if (!pending) setShowAuth(false)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [pending, close])

  if (!pending) return null
  const copy = GATE_COPY[pending]
  if (showAuth) return <AuthDialog onClose={close} reason={copy.reason} initialMode="signin" />

  return (
    <div className="auth-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
        <button type="button" className="auth-dialog__close" aria-label="Close" onClick={close}>
          <X size={15} />
        </button>
        <h2 id="auth-gate-title">{copy.title}</h2>
        <p className="auth-dialog__lead">{copy.reason}</p>
        <div className="auth-gate__note">
          <CloudOff size={15} />
          <span>You are browsing as a guest. Nothing is uploaded, and clearing this browser's data deletes your projects.</span>
        </div>
        <div className="auth-gate__actions">
          <button type="button" className="auth-gate__guest" onClick={close}>
            Stay a guest
          </button>
          <button type="button" className="auth-dialog__submit" onClick={() => setShowAuth(true)}>
            Sign in or create account
          </button>
        </div>
      </div>
    </div>
  )
}
