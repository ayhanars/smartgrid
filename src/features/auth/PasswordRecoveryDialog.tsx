import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { useAuthStore } from './useAuthStore'
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from './authErrors'
import './AuthDialog.css'

/** Shown after the app opens from a password-reset email: the session is
 * live, but the user still has to choose the new password. */
export function PasswordRecoveryDialog() {
  const recovering = useAuthStore((s) => s.recovering)
  const updatePassword = useAuthStore((s) => s.updatePassword)
  const clearRecovering = useAuthStore((s) => s.clearRecovering)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!recovering) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updatePassword(password)
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <div className="auth-dialog__backdrop">
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-recovery-title">
        <h2 id="auth-recovery-title">Choose a new password</h2>
        <p className="auth-dialog__lead">You are signed in through the reset link. Set the password you will use from now on.</p>
        <form className="auth-dialog__form" onSubmit={submit}>
          <label htmlFor="auth-new-password">New password</label>
          <input id="auth-new-password" type="password" autoComplete="new-password" autoFocus required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} />
          <label htmlFor="auth-new-password-2">Repeat it</label>
          <input id="auth-new-password-2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button type="submit" className="auth-dialog__submit" disabled={busy || !password || !confirm}>
            <KeyRound size={14} />
            {busy ? 'Saving…' : 'Save password'}
          </button>
        </form>
        <div className="auth-dialog__links">
          <button type="button" onClick={clearRecovering}>
            Keep my current password
          </button>
        </div>
        {error && <p className="auth-dialog__error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
