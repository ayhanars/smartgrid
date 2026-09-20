import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, LogOut, ShieldCheck, Trash2 } from 'lucide-react'
import { isStaffRole, useAuthStore } from '../features/auth/useAuthStore'
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from '../features/auth/authErrors'
import { levelProgress, removeAvatar, updateProfile, uploadAvatar } from '../lib/supabase/profiles'
import { deleteAccount } from '../lib/supabase/account'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { deleteAllLocalProjects } from '../lib/persistence/localProjects'
import './AccountPage.css'

type Flash = { kind: 'ok' | 'error'; text: string } | null

/** `/account`: profile picture, name, email, password, sign-out and
 * account deletion. */
export function AccountPage() {
  const navigate = useNavigate()
  const loading = useAuthStore((s) => s.loading)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const setProfile = useAuthStore((s) => s.setProfile)
  const signOut = useAuthStore((s) => s.signOut)

  useEffect(() => {
    if (!isSupabaseConfigured || (!loading && !user)) navigate('/', { replace: true })
  }, [loading, user, navigate])

  if (!user) return null
  const email = user.email ?? ''
  const meta = user.user_metadata as { avatar_url?: string; full_name?: string } | undefined
  const avatarUrl = profile?.avatarUrl ?? meta?.avatar_url ?? null
  const name = profile?.displayName || meta?.full_name || email
  const hasPassword = (user.identities ?? []).some((i) => i.provider === 'email')

  return (
    <div className="account">
      <div className="account__title">
        <h1>Account</h1>
      </div>
      <main className="account__main">
        <section className="account__card account__identity">
          <AvatarField userId={user.id} avatarUrl={avatarUrl} initial={name.slice(0, 1)} onChange={(url) => profile && setProfile({ ...profile, avatarUrl: url })} />
          <div className="account__identity-text">
            <strong>{name}</strong>
            <span>{email}</span>
            {profile && profile.role !== 'user' && (
              <span className="account__role">
                <ShieldCheck size={12} />
                {profile.role}
              </span>
            )}
            {isStaffRole(profile) && (
              <button type="button" className="account__link" onClick={() => navigate('/admin')}>
                Open the admin dashboard
              </button>
            )}
          </div>
        </section>

        {profile && <LevelCard xp={profile.xp} level={profile.level} />}

        <NameForm userId={user.id} current={profile?.displayName ?? ''} onSaved={(displayName) => profile && setProfile({ ...profile, displayName })} />
        <BioForm userId={user.id} current={profile?.bio ?? ''} onSaved={(bio) => profile && setProfile({ ...profile, bio })} />
        <EmailForm current={email} />
        <PasswordForm hasPassword={hasPassword} email={email} />

        <section className="account__card">
          <h2>Sign out</h2>
          <p>Your projects stay in this browser and in the cloud. Sign back in any time to keep syncing.</p>
          <button
            type="button"
            className="account__button"
            onClick={() => {
              void signOut().then(() => navigate('/'))
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </section>

        <DeleteSection email={email} onDeleted={() => navigate('/')} />
      </main>
    </div>
  )
}

function LevelCard({ xp, level }: { xp: number; level: number }) {
  const p = levelProgress(xp, level)
  return (
    <section className="account__card">
      <h2>
        Level {level} <span className="account__xp">{xp} XP</span>
      </h2>
      <p>
        {p.needed - p.current} XP to level {level + 1}. Publishing models, getting them approved, likes, opened copies, comments and collections all earn XP.
      </p>
      <div className="account__bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.needed} aria-valuenow={p.current}>
        <div className="account__bar-fill" style={{ width: `${Math.round(p.fraction * 100)}%` }} />
      </div>
    </section>
  )
}

function AvatarField({ userId, avatarUrl, initial, onChange }: { userId: string; avatarUrl: string | null; initial: string; onChange: (url: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const url = await uploadAvatar(userId, file)
      await updateProfile(userId, { avatarUrl: url })
      onChange(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await removeAvatar(userId).catch(() => undefined)
      await updateProfile(userId, { avatarUrl: null })
      onChange(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the picture')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account__avatar-field">
      <button type="button" className="account__avatar" disabled={busy} title="Change picture" onClick={() => inputRef.current?.click()}>
        {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
        <span className="account__avatar-overlay">
          <Camera size={16} />
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Profile picture"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="account__avatar-actions">
        <button type="button" className="account__link" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Working…' : avatarUrl ? 'Change picture' : 'Add a picture'}
        </button>
        {avatarUrl && (
          <button type="button" className="account__link account__link--muted" disabled={busy} onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="account__error" role="alert">{error}</p>}
    </div>
  )
}

function NameForm({ userId, current, onSaved }: { userId: string; current: string; onSaved: (name: string) => void }) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  useEffect(() => setName(current), [current])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === current) return
    setBusy(true)
    setFlash(null)
    try {
      const saved = await updateProfile(userId, { displayName: trimmed })
      onSaved(saved.displayName)
      setFlash({ kind: 'ok', text: 'Name saved.' })
    } catch (err) {
      setFlash({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account__card" onSubmit={submit}>
      <h2>Display name</h2>
      <p>Shown on anything you share with the community.</p>
      <div className="account__row">
        <input value={name} maxLength={60} aria-label="Display name" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="account__button account__button--primary" disabled={busy || !name.trim() || name.trim() === current}>
          Save
        </button>
      </div>
      <FlashLine flash={flash} />
    </form>
  )
}

function BioForm({ userId, current, onSaved }: { userId: string; current: string; onSaved: (bio: string) => void }) {
  const [bio, setBio] = useState(current)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  useEffect(() => setBio(current), [current])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (bio.trim() === current) return
    setBusy(true)
    setFlash(null)
    try {
      const saved = await updateProfile(userId, { bio: bio.trim() })
      onSaved(saved.bio)
      setFlash({ kind: 'ok', text: 'Saved.' })
    } catch (err) {
      setFlash({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="account__card" onSubmit={submit}>
      <h2>About you</h2>
      <p>A line or two on your public profile: what you print, what you design.</p>
      <div className="account__stack">
        <textarea className="account__textarea" value={bio} rows={3} maxLength={300} aria-label="About you" onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="account__row account__row--end">
        <button type="submit" className="account__button account__button--primary" disabled={busy || bio.trim() === current}>
          Save
        </button>
      </div>
      <FlashLine flash={flash} />
    </form>
  )
}

function EmailForm({ current }: { current: string }) {
  const updateEmail = useAuthStore((s) => s.updateEmail)
  const [email, setEmail] = useState(current)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)
  useEffect(() => setEmail(current), [current])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || trimmed === current) return
    setBusy(true)
    setFlash(null)
    try {
      await updateEmail(trimmed)
      setFlash({ kind: 'ok', text: `Check both inboxes: the change applies once you confirm it from ${current} and ${trimmed}.` })
    } catch (err) {
      setFlash({ kind: 'error', text: friendlyAuthError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account__card" onSubmit={submit}>
      <h2>Email</h2>
      <p>Used to sign in and for password resets. Changing it sends a confirmation link to both addresses.</p>
      <div className="account__row">
        <input type="email" value={email} autoComplete="email" aria-label="Email" onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="account__button account__button--primary" disabled={busy || !email.trim() || email.trim() === current}>
          Change
        </button>
      </div>
      <FlashLine flash={flash} />
    </form>
  )
}

function PasswordForm({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const updatePassword = useAuthStore((s) => s.updatePassword)
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFlash({ kind: 'error', text: `Use at least ${MIN_PASSWORD_LENGTH} characters.` })
      return
    }
    if (password !== confirm) {
      setFlash({ kind: 'error', text: 'The two passwords do not match.' })
      return
    }
    setBusy(true)
    setFlash(null)
    try {
      await updatePassword(password)
      setPassword('')
      setConfirm('')
      setFlash({ kind: 'ok', text: 'Password updated.' })
    } catch (err) {
      setFlash({ kind: 'error', text: friendlyAuthError(err) })
    } finally {
      setBusy(false)
    }
  }

  const sendReset = async () => {
    setBusy(true)
    setFlash(null)
    try {
      await requestPasswordReset(email)
      setFlash({ kind: 'ok', text: `We emailed a reset link to ${email}.` })
    } catch (err) {
      setFlash({ kind: 'error', text: friendlyAuthError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account__card" onSubmit={submit}>
      <h2>{hasPassword ? 'Change password' : 'Set a password'}</h2>
      <p>
        {hasPassword
          ? 'Pick a new password for signing in with your email.'
          : 'Your account signs in with Google. Add a password to sign in with your email as well.'}
      </p>
      <div className="account__stack">
        <input type="password" value={password} autoComplete="new-password" placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`} aria-label="New password" onChange={(e) => setPassword(e.target.value)} />
        <input type="password" value={confirm} autoComplete="new-password" placeholder="Repeat the new password" aria-label="Repeat new password" onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <div className="account__row account__row--end">
        <button type="button" className="account__link account__link--muted" disabled={busy} onClick={() => void sendReset()}>
          Email me a reset link instead
        </button>
        <button type="submit" className="account__button account__button--primary" disabled={busy || !password || !confirm}>
          {hasPassword ? 'Update password' : 'Set password'}
        </button>
      </div>
      <FlashLine flash={flash} />
    </form>
  )
}

function DeleteSection({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
      deleteAllLocalProjects()
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account')
      setBusy(false)
    }
  }

  return (
    <section className="account__card account__card--danger">
      <h2>Delete account</h2>
      <p>Removes your account, every cloud project, your assets and anything you shared with the community. Projects saved in this browser are cleared too. This cannot be undone.</p>
      {confirming ? (
        <div className="account__stack">
          <label htmlFor="account-delete-confirm">Type your email to confirm</label>
          <input id="account-delete-confirm" value={typed} autoComplete="off" placeholder={email} onChange={(e) => setTyped(e.target.value)} />
          <div className="account__row account__row--end">
            <button type="button" className="account__link account__link--muted" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="account__button account__button--danger" disabled={busy || typed.trim().toLowerCase() !== email.toLowerCase()} onClick={() => void run()}>
              <Trash2 size={14} />
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="account__button account__button--danger" onClick={() => setConfirming(true)}>
          <Trash2 size={14} />
          Delete account…
        </button>
      )}
      {error && <p className="account__error" role="alert">{error}</p>}
    </section>
  )
}

function FlashLine({ flash }: { flash: Flash }) {
  if (!flash) return null
  return (
    <p className={flash.kind === 'ok' ? 'account__ok' : 'account__error'} role={flash.kind === 'ok' ? 'status' : 'alert'}>
      {flash.text}
    </p>
  )
}
