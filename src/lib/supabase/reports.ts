import { supabase } from './client'

export type ReportReason = 'copyright' | 'inappropriate' | 'spam' | 'broken' | 'other'
export type ReportStatus = 'open' | 'resolved' | 'dismissed'

export const REPORT_REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: 'copyright', label: 'Copyright or trademark', hint: 'The model is someone else’s work, a licensed design or a brand’s product.' },
  { id: 'inappropriate', label: 'Inappropriate content', hint: 'Offensive, hateful or adult content, or a weapon part.' },
  { id: 'spam', label: 'Spam or misleading', hint: 'Advertising, a duplicate, or not what the listing says.' },
  { id: 'broken', label: 'Broken or unprintable', hint: 'The model does not open, slice or print as described.' },
  { id: 'other', label: 'Something else', hint: 'Tell us in the details.' },
]

export const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id

export interface CommunityReport {
  id: string
  itemId: string
  itemTitle: string
  itemThumbnail: string | null
  itemStatus: string
  itemOwnerId: string
  itemOwnerName: string
  reporterId: string
  reporterName: string
  reason: ReportReason
  details: string
  status: ReportStatus
  resolution: string
  createdAt: number
  resolvedAt: number | null
}

interface ReportRow {
  id: string
  item_id: string
  reporter_id: string
  reason: ReportReason
  details: string
  status: ReportStatus
  resolution: string
  created_at: string
  resolved_at: string | null
  item: { title: string; thumbnail: string | null; status: string; owner_id: string; owner: { display_name: string } | null } | null
  reporter: { display_name: string } | null
}

const COLUMNS = 'id, item_id, reporter_id, reason, details, status, resolution, created_at, resolved_at, item:community_items (title, thumbnail, status, owner_id, owner:profiles!community_items_owner_id_fkey (display_name)), reporter:profiles!community_reports_reporter_id_fkey (display_name)'

const toReport = (r: ReportRow): CommunityReport => ({
  id: r.id,
  itemId: r.item_id,
  itemTitle: r.item?.title ?? 'Deleted model',
  itemThumbnail: r.item?.thumbnail ?? null,
  itemStatus: r.item?.status ?? 'deleted',
  itemOwnerId: r.item?.owner_id ?? '',
  itemOwnerName: r.item?.owner?.display_name ?? '—',
  reporterId: r.reporter_id,
  reporterName: r.reporter?.display_name ?? '—',
  reason: r.reason,
  details: r.details,
  status: r.status,
  resolution: r.resolution,
  createdAt: Date.parse(r.created_at),
  resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) : null,
})

/** Signed-in users flag a model; staff hear about it at once. */
export async function reportCommunityItem(itemId: string, reason: ReportReason, details: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const reporter_id = session.session?.user.id
  if (!reporter_id) throw new Error('Not signed in')
  const { error } = await supabase.from('community_reports').insert({ item_id: itemId, reporter_id, reason, details: details.trim() })
  if (error) throw error
}

/** The caller's own reports of one model (to say "you reported this"). */
export async function myReportsFor(itemId: string): Promise<CommunityReport[]> {
  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user.id
  if (!uid) return []
  const { data, error } = await supabase.from('community_reports').select(COLUMNS).eq('item_id', itemId).eq('reporter_id', uid)
  if (error) throw error
  return (data as unknown as ReportRow[]).map(toReport)
}

/** Staff: reports, open ones first. */
export async function listReports(status: ReportStatus | 'all' = 'open'): Promise<CommunityReport[]> {
  let q = supabase.from('community_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(300)
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return (data as unknown as ReportRow[]).map(toReport)
}

/** Staff: settle a report, optionally hiding or removing the model. */
export async function resolveReport(id: string, status: 'resolved' | 'dismissed', action: 'none' | 'hide' | 'remove' = 'none', note = ''): Promise<void> {
  const { error } = await supabase.rpc('resolve_report', { p_report: id, p_status: status, p_action: action, p_note: note })
  if (error) throw error
}
