import { functionsUrl, supabase, supabaseAnonKeyValue } from './client'

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
  reporterId: string | null
  reporterName: string
  reporterEmail: string
  originalUrl: string
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
  reporter_id: string | null
  reporter_email: string
  original_url: string
  reason: ReportReason
  details: string
  status: ReportStatus
  resolution: string
  created_at: string
  resolved_at: string | null
  item: { title: string; thumbnail: string | null; status: string; owner_id: string; owner: { display_name: string } | null } | null
  reporter: { display_name: string } | null
}

const COLUMNS = 'id, item_id, reporter_id, reporter_email, original_url, reason, details, status, resolution, created_at, resolved_at, item:community_items (title, thumbnail, status, owner_id, owner:profiles!community_items_owner_id_fkey (display_name)), reporter:profiles!community_reports_reporter_id_fkey (display_name)'

const toReport = (r: ReportRow): CommunityReport => ({
  id: r.id,
  itemId: r.item_id,
  itemTitle: r.item?.title ?? 'Deleted model',
  itemThumbnail: r.item?.thumbnail ?? null,
  itemStatus: r.item?.status ?? 'deleted',
  itemOwnerId: r.item?.owner_id ?? '',
  itemOwnerName: r.item?.owner?.display_name ?? '—',
  reporterId: r.reporter_id,
  reporterName: r.reporter?.display_name ?? (r.reporter_email ? `visitor · ${r.reporter_email}` : 'visitor'),
  reporterEmail: r.reporter_email ?? '',
  originalUrl: r.original_url ?? '',
  reason: r.reason,
  details: r.details,
  status: r.status,
  resolution: r.resolution,
  createdAt: Date.parse(r.created_at),
  resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) : null,
})

/** Anyone flags a model, signed in or not; staff get a notification at
 * once and, when a mail provider is configured, an e-mail. */
export async function reportCommunityItem(itemId: string, reason: ReportReason, details: string, extra: { email?: string; originalUrl?: string } = {}): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const reporter_id = session.session?.user.id ?? null
  // The id is minted here: a guest cannot read the row back (no select
  // policy for them), and RETURNING would trip over that.
  const id = crypto.randomUUID()
  const row = { id, item_id: itemId, reporter_id, reason, details: details.trim(), reporter_email: (extra.email ?? '').trim(), original_url: (extra.originalUrl ?? '').trim() }
  const { error } = await supabase.from('community_reports').insert(row)
  if (error) throw error
  // Best effort: the notification is already in; the mail is a bonus.
  if (functionsUrl) {
    void fetch(`${functionsUrl}/report-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKeyValue, Authorization: `Bearer ${session.session?.access_token ?? supabaseAnonKeyValue}` },
      body: JSON.stringify({ reportId: id }),
    }).catch((err: unknown) => console.warn('Report mail not sent', err))
  }
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
