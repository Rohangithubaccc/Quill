import { NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { decrypt, jsonError, jsonOk } from '@/lib/utils'
import { Resend } from 'resend'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cron/linkedin-token-reminder
//
// Runs daily (vercel.json schedule: "0 9 * * *" — add alongside trial-reminder).
// Scans all LinkedIn integrations and emails workspace owners when their
// token is within 7 days of expiry.
//
// LinkedIn access tokens last 60 days and cannot be refreshed — users must
// reconnect manually. Without this cron, publishing silently 404s after ~60 days.
//
// Vercel cron: add to vercel.json →
//   { "path": "/api/cron/linkedin-token-reminder", "schedule": "0 10 * * *" }
// ─────────────────────────────────────────────────────────────────────────────

const WARN_DAYS    = 7          // warn this many days before expiry
const WARN_MS      = WARN_DAYS * 24 * 60 * 60 * 1000

// Lazily instantiated so importing this module never crashes when
// RESEND_API_KEY isn't set yet — only sending an email requires the key.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

export async function GET(req: NextRequest) {
  // ── Cron auth ──────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret') ??
                 req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError('Unauthorized', 401)
  }

  const admin = createSupabaseAdmin()
  const now   = Date.now()

  // ── Fetch all connected LinkedIn integrations ──────────────────────────────
  const { data: integrations, error: fetchErr } = await admin
    .from('integrations')
    .select('id, workspace_id, config, connected_at')
    .eq('provider', 'linkedin')
    .eq('status', 'connected')

  if (fetchErr) {
    console.error('[cron/linkedin-token-reminder] Fetch failed:', fetchErr)
    return jsonError('Failed to fetch integrations', 500)
  }

  if (!integrations || integrations.length === 0) {
    return jsonOk({ checked: 0, reminded: 0, expired: 0 })
  }

  let reminded = 0
  let expired  = 0
  const errors: string[] = []

  for (const integration of integrations) {
    try {
      // ── Decrypt to get expires_at ──────────────────────────────────────────
      let creds: { expires_at?: number; profile_name?: string } = {}
      try {
        creds = JSON.parse(await decrypt(integration.config.encrypted_config))
      } catch {
        // Corrupted creds — skip silently
        continue
      }

      if (!creds.expires_at) continue

      const msUntilExpiry = creds.expires_at - now

      // Already expired — mark disconnected
      if (msUntilExpiry < 0) {
        expired++
        await admin
          .from('integrations')
          .update({ status: 'expired' })
          .eq('id', integration.id)
        // Fall through to send expired email
      } else if (msUntilExpiry > WARN_MS) {
        // Not yet in warning window — skip
        continue
      }

      const daysLeft    = Math.max(0, Math.floor(msUntilExpiry / (24 * 60 * 60 * 1000)))
      const isExpired   = msUntilExpiry < 0

      // ── Look up workspace owner email ──────────────────────────────────────
      const { data: ownerMember } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', integration.workspace_id)
        .eq('role', 'owner')
        .eq('status', 'active')
        .limit(1)
        .single()

      if (!ownerMember) continue

      // Get email from auth.users via admin API
      let ownerEmail = ''
      try {
        const { data: authUser } = await admin.auth.admin.getUserById(ownerMember.user_id)
        ownerEmail = authUser?.user?.email ?? ''
      } catch { continue }

      if (!ownerEmail) continue

      // ── Atomically claim this send (migration 036) ─────────────────────────
      // Replaces a separate SELECT-then-INSERT: two concurrent runs of this
      // cron could otherwise both see "not sent this week" before either had
      // logged it, and both would email the customer — reproduced with a
      // real concurrent test during load-testing (item 4). claim_email_send
      // does the check and the log-insert as one atomic unit; a non-null id
      // means THIS invocation owns the send and must release it on failure
      // below so a future run can retry instead of the reminder silently
      // never going out again this week.
      const emailType = isExpired ? 'linkedin_token_expired' : `linkedin_token_expiring_${daysLeft}d`
      const { data: claimId } = await admin.rpc('claim_email_send', {
        p_workspace_id: integration.workspace_id,
        p_email_type:   emailType,
        p_window_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      })

      if (!claimId) continue // already sent within the window (by us or a concurrent run)

      // ── Send email ──────────────────────────────────────────────────────────
      const reconnectUrl = `${process.env.NEXT_PUBLIC_URL}/api/integrations/linkedin/connect`
      const settingsUrl  = `${process.env.NEXT_PUBLIC_URL}/settings?tab=integrations`

      const subject = isExpired
        ? 'Your LinkedIn connection has expired — reconnect to resume publishing'
        : `Your LinkedIn connection expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`

      const bodyHtml = `
        <div style="font-family:Inter,-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0b0b10;color:#e8e8f0;padding:32px 24px;border-radius:12px">
          <div style="font-size:18px;font-weight:700;color:#6c63ff;margin-bottom:24px">✦ Quill.AI</div>
          <h2 style="font-size:20px;font-weight:700;margin:0 0 12px;letter-spacing:-0.02em">
            ${isExpired ? 'LinkedIn connection expired' : `LinkedIn reconnect reminder`}
          </h2>
          <p style="font-size:14px;color:#9898b8;line-height:1.6;margin:0 0 20px">
            ${isExpired
              ? 'Your LinkedIn access token has expired. Any scheduled posts to LinkedIn will fail until you reconnect.'
              : `Your LinkedIn access token expires in <strong style="color:#f59e42">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>. LinkedIn tokens last 60 days and must be manually renewed.`
            }
          </p>
          <p style="font-size:13px;color:#7c7c9a;margin:0 0 24px">
            This only takes 30 seconds — click below to re-authorise Quill.AI with your LinkedIn account.
          </p>
          <a href="${reconnectUrl}" style="display:inline-block;background:#6c63ff;color:#fff;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;text-decoration:none">
            Reconnect LinkedIn →
          </a>
          <p style="font-size:12px;color:#4a4a6a;margin:24px 0 0">
            You can also go to <a href="${settingsUrl}" style="color:#6c63ff">Settings → Integrations</a> to manage all connected services.
          </p>
        </div>
      `

      try {
        await getResend().emails.send({
          from:    process.env.EMAIL_FROM ?? 'noreply@quill.ai',
          to:      ownerEmail,
          subject,
          html:    bodyHtml,
        })
      } catch (sendErr) {
        // Release the claim so this reminder is retried on a future run
        // instead of being permanently marked "sent" despite never
        // actually going out.
        await Promise.resolve(admin.from('sent_emails').delete().eq('id', claimId)).catch(() => {})
        throw sendErr
      }

      reminded++
      console.log(`[cron/linkedin-token-reminder] Sent ${emailType} to ${ownerEmail}`)

    } catch (err: any) {
      errors.push(`workspace ${integration.workspace_id}: ${err.message}`)
      console.error('[cron/linkedin-token-reminder] Error:', err)
    }
  }

  return jsonOk({
    checked:  integrations.length,
    reminded,
    expired,
    errors:   errors.length > 0 ? errors : undefined,
  })
}
