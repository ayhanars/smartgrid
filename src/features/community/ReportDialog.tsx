import { useState } from 'react'
import { Flag, X } from 'lucide-react'
import { REPORT_REASONS, reportCommunityItem, type ReportReason } from '../../lib/supabase/reports'
import { useAuthStore } from '../auth/useAuthStore'
import '../auth/AuthDialog.css'
import './community.css'

/** Flags a shared model for the moderators: a reason and, for copyright
 * claims especially, the details they need to check it. */
export function ReportDialog({ itemId, title, onClose, onSent }: { itemId: string; title: string; onClose: () => void; onSent: () => void }) {
  const [reason, setReason] = useState<ReportReason>('copyright')
  const [details, setDetails] = useState('')
  const [email, setEmail] = useState('')
  const [originalUrl, setOriginalUrl] = useState('')
  const user = useAuthStore((s) => s.user)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = REPORT_REASONS.find((r) => r.id === reason)!
  const needsDetails = reason === 'copyright' || reason === 'other'

  const send = async () => {
    if (busy) return
    if (reason === 'copyright' && details.trim().length < 10 && originalUrl.trim().length < 8) {
      setError('Tell us whose work it is, or link to the original.')
      return
    }
    if (reason === 'other' && details.trim().length < 10) {
      setError('Tell us what is wrong in a sentence or two.')
      return
    }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('That e-mail address does not look right.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reportCommunityItem(itemId, reason, details, { email: user ? '' : email, originalUrl })
      onSent()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-dialog__backdrop" onClick={onClose}>
      <div className="auth-dialog report-dialog" role="dialog" aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="auth-dialog__close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <h2 id="report-title">
          <Flag size={15} /> Report “{title}”
        </h2>
        <p className="auth-dialog__lead">A moderator looks at every report, no account needed. The author is not told who reported it.</p>
        <div className="report-dialog__reasons" role="radiogroup" aria-label="Reason">
          {REPORT_REASONS.map((r) => (
            <label key={r.id} className={`report-dialog__reason ${reason === r.id ? 'report-dialog__reason--on' : ''}`}>
              <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
              <span>
                <strong>{r.label}</strong>
                <small>{r.hint}</small>
              </span>
            </label>
          ))}
        </div>
        {reason === 'copyright' && (
          <label className="report-dialog__details">
            <span>Link to the original (optional)</span>
            <input type="url" value={originalUrl} maxLength={500} placeholder="https://… where the original design lives" onChange={(e) => setOriginalUrl(e.target.value)} />
          </label>
        )}
        <label className="report-dialog__details">
          <span>Details{needsDetails ? '' : ' (optional)'}</span>
          <textarea
            value={details}
            rows={3}
            maxLength={1000}
            placeholder={reason === 'copyright' ? 'Whose design is it? A link to the original helps most.' : chosen.hint}
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
        {!user && (
          <label className="report-dialog__details">
            <span>Your e-mail (optional, only so a moderator can ask you for more)</span>
            <input type="email" value={email} maxLength={200} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="auth-dialog__error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="auth-dialog__submit" disabled={busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </div>
  )
}
