import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Clock, Download, ExternalLink, GitBranch } from 'lucide-react'
import { getBedPreset } from '../../lib/geometry/bedPresets'
import type { DocumentSnapshot } from '../../lib/persistence/localProjects'
import {
  getCommunityItem,
  getItemVersionData,
  listCommunityItems,
  listItemVersions,
  recordCommunityDownload,
  type CommunityItem,
  type CommunityItemFull,
  type ItemVersion,
} from '../../lib/supabase/community'
import { useAuthStore } from '../auth/useAuthStore'
import { defaultPrinterFor, downloadSnapshot } from './downloadModel'
import { Avatar } from './CommunityCard'

/** One row of the list: an archived version, the current model, or a
 * model someone else published from a copy. */
interface Row {
  key: string
  label: string
  title: string
  thumbnail: string | null
  changes: string
  bedPresetId: string
  plateCount: number
  shapeCount: number
  createdAt: number
  author?: CommunityItem['author'] & { id: string }
  pending?: boolean
  current?: boolean
  /** Where to open it: nothing for the archived versions of this page. */
  itemId?: string
  load: () => Promise<{ snapshot: DocumentSnapshot; title: string } | null>
  countDownload?: string
}

/**
 * Every version of a model: the author's earlier versions (archived when
 * they publish a new one), the current one, and the models other people
 * published from a copy of it — each with a direct 3MF download.
 */
export function VersionsPanel({ item }: { item: CommunityItemFull }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [versions, setVersions] = useState<ItemVersion[]>([])
  const [others, setOthers] = useState<CommunityItem[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listItemVersions(item.id)
      .then((list) => !cancelled && setVersions(list))
      .catch(() => undefined)
    listCommunityItems({ rootId: item.rootId })
      .then((list) => !cancelled && setOthers(list.filter((v) => v.id !== item.id)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [item.id, item.rootId, item.versionCount])

  const rows: Row[] = [
    ...versions.map<Row>((v) => ({
      key: v.id,
      label: `v${v.version}`,
      title: v.title,
      thumbnail: v.thumbnail,
      changes: v.changes,
      bedPresetId: v.bedPresetId,
      plateCount: v.plateCount,
      shapeCount: v.shapeCount,
      createdAt: v.createdAt,
      load: async () => {
        const snapshot = await getItemVersionData(v.id)
        return snapshot ? { snapshot, title: `${v.title} v${v.version}` } : null
      },
      countDownload: item.id,
    })),
    {
      key: item.id,
      label: `v${item.versionCount}`,
      title: item.title,
      thumbnail: item.thumbnail,
      changes: item.versionCount > 1 ? item.changes : '',
      bedPresetId: item.bedPresetId,
      plateCount: item.plateCount,
      shapeCount: item.shapeCount,
      createdAt: item.updatedAt,
      pending: item.approval === 'pending',
      current: true,
      load: async () => ({ snapshot: item.data, title: item.title }),
      countDownload: item.id,
    },
    ...others.map<Row>((v) => ({
      key: v.id,
      label: v.id === item.parentId ? 'Original' : v.parentId === item.id ? 'From this' : 'Related',
      title: v.title,
      thumbnail: v.thumbnail,
      changes: v.changes,
      bedPresetId: v.bedPresetId,
      plateCount: v.plateCount,
      shapeCount: v.shapeCount,
      createdAt: v.createdAt,
      author: { ...v.author, id: v.ownerId },
      pending: v.approval === 'pending',
      itemId: v.id,
      load: async () => {
        const full = await getCommunityItem(v.id)
        return full ? { snapshot: full.data, title: full.title } : null
      },
      countDownload: user?.id === v.ownerId ? undefined : v.id,
    })),
  ]

  if (rows.length < 2) return null

  const download = async (row: Row) => {
    if (busy) return
    setBusy(row.key)
    setError(null)
    try {
      const loaded = await row.load()
      if (!loaded) throw new Error('This version is no longer available')
      if ((await downloadSnapshot(loaded.snapshot, loaded.title, '3mf', defaultPrinterFor(loaded.snapshot))) && row.countDownload && user?.id !== item.ownerId) {
        void recordCommunityDownload(row.countDownload)
      }
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
        Versions <span className="versions__count">{rows.length}</span>
      </h2>
      <p>
        {versions.length > 0 ? `${item.author.displayName} has published ${item.versionCount} versions of this model` : 'Every version of this model'}
        {others.length > 0 ? `${versions.length > 0 ? ', and' : ':'} ${others.length} ${others.length === 1 ? 'model was' : 'models were'} published from a copy of it` : ''}. Download any of them as is.
      </p>
      {error && <p className="auth-dialog__error">{error}</p>}
      <ol className="versions__list">
        {rows.map((row) => {
          const bed = getBedPreset(row.bedPresetId)
          return (
            <li key={row.key} className={`versions__row ${row.current ? 'versions__row--current' : ''}`}>
              <button type="button" className="versions__thumb" title={row.itemId ? `Open ${row.title}` : row.title} disabled={!row.itemId} onClick={() => row.itemId && navigate(`/c/${row.itemId}`)}>
                {row.thumbnail ? <img src={row.thumbnail} alt="" /> : <Box size={20} />}
              </button>
              <div className="versions__body">
                <div className="versions__head">
                  <span className="versions__tag">{row.label}</span>
                  <strong>{row.title}</strong>
                  {row.current && <span className="versions__here">current</span>}
                  {row.pending && (
                    <span className="approval-badge approval-badge--pending">
                      <Clock size={11} /> waiting for review
                    </span>
                  )}
                </div>
                <div className="versions__meta">
                  {row.author && (
                    <button type="button" className="versions__author" onClick={() => navigate(`/u/${row.author?.id}`)}>
                      <Avatar name={row.author.displayName} url={row.author.avatarUrl} />
                      {row.author.displayName}
                    </button>
                  )}
                  <span>{new Date(row.createdAt).toLocaleDateString()}</span>
                  {bed && <span>{bed.label}</span>}
                  {row.plateCount > 1 && <span>{row.plateCount} plates</span>}
                  <span>
                    {row.shapeCount} shape{row.shapeCount === 1 ? '' : 's'}
                  </span>
                </div>
                {row.changes && <p className="versions__changes">{row.changes}</p>}
              </div>
              <div className="versions__actions">
                <button type="button" className="versions__download" disabled={busy !== null} onClick={() => void download(row)}>
                  <Download size={13} />
                  {busy === row.key ? 'Preparing…' : '3MF'}
                </button>
                {row.itemId && (
                  <button type="button" className="versions__open" onClick={() => navigate(`/c/${row.itemId}`)}>
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
