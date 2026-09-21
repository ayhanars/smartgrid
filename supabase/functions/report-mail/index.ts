// Supabase Edge Function: e-mails the moderators about a new report.
//
//   POST /report-mail   { reportId }
//
// Called by the site right after a report is filed (no sign-in needed, so
// the function checks the report itself and mails each one at most once).
// Sends through Resend when RESEND_API_KEY is set; MAIL_FROM is the sender
// (e.g. "smartgrid <reports@yourdomain.com>", a domain verified in Resend)
// and SITE_URL the public address for the links. Without a key it does
// nothing, and the in-app notification is all the staff get.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const escape = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

const REASONS: Record<string, string> = {
  copyright: 'Copyright or trademark',
  inappropriate: 'Inappropriate content',
  spam: 'Spam or misleading',
  broken: 'Broken or unprintable',
  other: 'Something else',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  let reportId = ''
  try {
    reportId = String((await req.json()).reportId ?? '')
  } catch {
    return json(400, { error: 'Bad request' })
  }
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return json(400, { error: 'Bad report id' })

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('MAIL_FROM')
  if (!apiKey || !from) return json(200, { skipped: 'no mail provider configured' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: report, error } = await admin
    .from('community_reports')
    .select('id, item_id, reason, details, original_url, reporter_email, reporter_id, emailed_at, created_at, item:community_items (title, owner:profiles!community_items_owner_id_fkey (display_name)), reporter:profiles!community_reports_reporter_id_fkey (display_name)')
    .eq('id', reportId)
    .maybeSingle()
  if (error) return json(500, { error: error.message })
  if (!report) return json(404, { error: 'No such report' })
  if (report.emailed_at) return json(200, { skipped: 'already mailed' })

  // Every moderator and admin with an e-mail address.
  const { data: staff } = await admin.from('profiles').select('id').in('role', ['admin', 'moderator'])
  const recipients: string[] = []
  for (const s of staff ?? []) {
    const { data } = await admin.auth.admin.getUserById(s.id)
    if (data.user?.email) recipients.push(data.user.email)
  }
  if (recipients.length === 0) return json(200, { skipped: 'no staff e-mails' })

  const site = (Deno.env.get('SITE_URL') ?? 'https://ayhanars.github.io/smartgrid').replace(/\/$/, '')
  const item = report.item as unknown as { title: string; owner: { display_name: string } | null } | null
  const reporter = report.reporter as unknown as { display_name: string } | null
  const title = item?.title ?? 'A model'
  const who = report.reporter_id ? (reporter?.display_name ?? 'a member') : report.reporter_email ? `a visitor (${report.reporter_email})` : 'a visitor'
  const reason = REASONS[report.reason] ?? report.reason
  const subject = `[smartgrid] "${title}" was reported: ${reason}`
  const html = `
    <p><strong>${escape(title)}</strong> by ${escape(item?.owner?.display_name ?? '—')} was reported by ${escape(who)}.</p>
    <p><strong>Reason:</strong> ${escape(reason)}</p>
    ${report.details ? `<p><strong>Details:</strong><br>${escape(report.details).replace(/\n/g, '<br>')}</p>` : ''}
    ${report.original_url ? `<p><strong>Original:</strong> <a href="${escape(report.original_url)}">${escape(report.original_url)}</a></p>` : ''}
    <p><a href="${site}/#/admin?tab=reports">Open the reports queue</a> · <a href="${site}/#/c/${report.item_id}">See the model</a></p>
  `
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: recipients, subject, html }),
  })
  if (!res.ok) return json(502, { error: `Mail provider refused: ${res.status} ${(await res.text()).slice(0, 200)}` })
  await admin.rpc('mark_report_emailed', { p_report: reportId })
  return json(200, { ok: true, recipients: recipients.length })
})
