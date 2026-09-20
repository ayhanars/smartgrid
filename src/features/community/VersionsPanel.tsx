import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Clock, Download, ExternalLink, GitBranch } from 'lucide-react'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import { getCommunityItem, listCommunityItems, recordCommunityDownload, type CommunityItem } from '../../lib/supabase/community'
import { useAuthStore } from '../auth/useAuthStore'
import { defaultPrinterFor, downloadSnapshot } from './downloadModel'
import { Avatar } from './CommunityCard'

/**
 * Every model of one lineage — the original and each version published
 * from a copy of it, by its author or by anyone else — oldest first, with
 * a direct 3MF download for each. Shown on every page of the family.
 */
export function VersionsPanel({ item }: { item: CommunityItem }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [family, setFamily] = useState<CommunityItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listCommunityItems({ rootId: item.rootId })
      .then((list) => {
        if (cancelled) return
        // The page's own item is always in the list, even while it waits for review.
        setFamily(list.some((v) => v.id === item.id) ? list : [...list, item].sort((a, b) => a.createdAt - b.createdAt))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [item.id, item.rootId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (family.length < 2) return null

  const download = async (v: CommunityItem) => {
    if (busy) return
    setBusy(v.id)
    setError(null)
    try {
      const full = v.id === item.id && 'data' in item ? (item as CommunityItem & { data: Parameters<typeof downloadSnapshot>[0] }) : await getCommunityItem(v.id)
      if (!full) throw new Error('This version is no longer available')
      if (await downloadSnapshot(full.data, full.title, '3mf', defaultPrinterFor(full.data)) && user?.id !== v.ownerId) void recordCommunityDownload(v.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="versions">
      <h2>
        <GitBranch size={15} />
        Versions <span className="versions__count">{family.length}</span>
      </h2>
      <p>The original and every version published from a copy of it. Download any of them as is, or open its page.</p>
      {error && <p className="auth-dialog__error">{error}</p>}
      <ol className="versions__list">
        {family.map((v, i) => {
          const current = v.id === item.id
          const bed = getBedPreset(v.bedPresetId)
          return (
            <li key={v.id} className={`versions__row ${current ? 'versions__row--current' : ''}`}>
              <button type="button" className="versions__thumb" title={current ? 'This page' : `Open ${v.title}`} disabled={current} onClick={() => navigate(`/c/${v.id}`)}>
                {v.thumbnail ? <img src={v.thumbnail} alt="" /> : <Box size={20} />}
              </button>
              <div className="versions__body">
                <div className="versions__head">
                  <span className="versions__tag">{i === 0 ? 'Original' : `v${i + 1}`}</span>
                  <strong>{v.title}</strong>
                  {current && <span className="versions__here">this page</span>}
                  {v.approval === 'pending' && (
                    <span className="approval-badge approval-badge--pending">
                      <Clock size={11} /> waiting for review
                    </span>
                  )}
                </div>
                <div className="versions__meta">
                  <button type="button" className="versions__author" onClick={() => navigate(`/u/${v.ownerId}`)}>
                    <Avatar name={v.author.displayName} url={v.author.avatarUrl} />
                    {v.author.displayName}
                  </button>
                  <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                  {bed && <span>{bed.label}</span>}
                  {v.plateCount > 1 && <span>{v.plateCount} plates</span>}
                  <span>
                    {v.shapeCount} shape{v.shapeCount === 1 ? '' : 's'}
                  </span>
                </div>
                {v.changes && <p className="versions__changes">{v.changes}</p>}
              </div>
              <div className="versions__actions">
                <button type="button" className="versions__download" disabled={busy !== null} onClick={() => void download(v)}>
                  <Download size={13} />
                  {busy === v.id ? 'Preparing…' : '3MF'}
                </button>
                {!current && (
                  <button type="button" className="versions__open" onClick={() => navigate(`/c/${v.id}`)}>
                    <ExternalLink size={13} />
                    Open
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
