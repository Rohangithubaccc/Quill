import { NextRequest }      from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk, escapeHtml } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cron/verify-domains
//
// Schedule (vercel.json): "0 8 * * *"  — 8 AM UTC every day
//
// Automatically checks all pending/verifying custom domains against the
// Vercel Projects API. When a domain's DNS is correctly configured,
// Vercel marks it as verified and this cron updates the DB to 'active'.
//
// Why this is needed:
//   DNS propagation takes 1–24 hours. Without auto-verification, Agency
//   users would have to manually click "Verify DNS" repeatedly until
//   their domain is ready — a frustrating experience. This cron runs
//   once daily and updates the status automatically, sending an email
//   when the domain goes live.
// ─────────────────────────────────────────────────────────────────────────────

const VERCEL_API = 'https://api.vercel.com'

export async function GET(req: NextRequest) {
  // ── Cron auth ──────────────────────────────────────────────────────────────
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError('Unauthorized', 401)
  }

  if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) {
    return jsonOk({ skipped: true, reason: 'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set' })
  }

  const admin = createSupabaseAdmin()

  // ── Fetch all domains that need verification ───────────────────────────────
  const { data: pendingDomains, error: fetchErr } = await admin
    .from('domains')
    .select('id, workspace_id, domain, status')
    .in('status', ['pending', 'verifying'])

  if (fetchErr) {
    console.error('[cron/verify-domains] Fetch failed:', fetchErr)
    return jsonError('Failed to fetch pending domains', 500)
  }

  if (!pendingDomains?.length) {
    return jsonOk({ checked: 0, activated: 0, failed: 0 })
  }

  let activated = 0
  let failed    = 0
  const results: Array<{ domain: string; status: string }> = []

  for (const domainRow of pendingDomains) {
    try {
      // Check domain status with Vercel
      const vercelRes = await fetch(
        `${VERCEL_API}/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domainRow.domain)}`,
        {
          headers: {
            Authorization:  `Bearer ${process.env.VERCEL_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        }
      )

      if (!vercelRes.ok) {
        console.warn(`[cron/verify-domains] Vercel check failed for ${domainRow.domain}:`, vercelRes.status)
        results.push({ domain: domainRow.domain, status: 'check_failed' })
        continue
      }

      const vercelData = await vercelRes.json()

      // A domain is verified when there's no 'verification' array,
      // or when all verification entries have been satisfied.
      const pendingVerification = vercelData.verification?.length > 0
      const isVerified          = !pendingVerification && vercelData.verified !== false

      if (isVerified) {
        // Claim the transition via a conditional UPDATE instead of an
        // unconditional one — found during load-testing (item 4) that two
        // overlapping cron runs could both independently see isVerified
        // from their own Vercel check and both fire the "domain is live"
        // email. Scoping the UPDATE to the pre-active statuses and reading
        // back .select() means only the invocation that actually flips the
        // row (Postgres serializes concurrent UPDATEs on the same row, and
        // the loser's WHERE re-evaluates against the post-commit value and
        // no longer matches) gets a non-null `claimed` — a concurrent
        // run's UPDATE affects 0 rows and correctly skips the notification.
        const { data: claimed } = await admin
          .from('domains')
          .update({ status: 'active', error_message: null })
          .eq('id', domainRow.id)
          .in('status', ['pending', 'verifying'])
          .select('id')
          .maybeSingle()

        activated++
        results.push({ domain: domainRow.domain, status: 'activated' })

        if (!claimed) {
          // Already activated (by us on a prior run, or a concurrent one) —
          // don't re-notify the owner.
          continue
        }

        console.log(`[cron/verify-domains] Domain activated: ${domainRow.domain} (workspace: ${domainRow.workspace_id})`)

        // Send activation notification to workspace owner (non-blocking)
        notifyDomainActive(admin, domainRow.workspace_id, domainRow.domain).catch(err =>
          console.error('[cron/verify-domains] Notification failed:', err)
        )
      } else {
        // Still pending — update status to 'verifying' to indicate we've checked at least once
        if (domainRow.status === 'pending') {
          await admin
            .from('domains')
            .update({ status: 'verifying' })
            .eq('id', domainRow.id)
        }
        results.push({ domain: domainRow.domain, status: 'still_pending' })
      }
    } catch (err: any) {
      console.error(`[cron/verify-domains] Error checking ${domainRow.domain}:`, err)
      failed++
      results.push({ domain: domainRow.domain, status: 'error' })
    }
  }

  return jsonOk({
    checked:   pendingDomains.length,
    activated,
    failed,
    results,
    timestamp: new Date().toISOString(),
  })
}

// ── Notify workspace owner when their domain goes live ────────────────────────
async function notifyDomainActive(
  admin:       ReturnType<typeof createSupabaseAdmin>,
  workspaceId: string,
  domain:      string
): Promise<void> {
  const { Resend } = await import('resend')
  const resend     = new Resend(process.env.RESEND_API_KEY!)

  // Find the workspace owner
  const { data: ownerMember } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .limit(1)
    .single()

  if (!ownerMember) return

  const { data: authUser } = await admin.auth.admin.getUserById(ownerMember.user_id)
  const ownerEmail = authUser?.user?.email
  if (!ownerEmail) return

  // domain is already constrained by a strict regex at input time
  // (domains/route.ts) so this is a no-op in practice, not a live gap —
  // escaping anyway for consistency with every other email in this
  // codebase now doing the same for user-influenced fields.
  const safeDomain = escapeHtml(domain)

  await resend.emails.send({
    from:    process.env.EMAIL_FROM ?? 'noreply@quill.ai',
    to:      ownerEmail,
    subject: `Your custom domain is live — ${safeDomain}`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#0b0b10;color:#e8e8f0;padding:32px 24px;border-radius:12px">
        <div style="font-size:18px;font-weight:700;color:#6c63ff;margin-bottom:24px">✦ Quill.AI</div>
        <div style="background:#13131a;border:1px solid #2a2a3a;border-radius:12px;padding:28px">
          <div style="font-size:22px;font-weight:700;margin-bottom:10px">Your domain is live! 🎉</div>
          <p style="font-size:14px;color:#9898b8;margin:0 0 18px;line-height:1.6">
            Your custom domain has been verified and SSL has been provisioned automatically.
          </p>
          <div style="background:rgba(62,207,142,0.1);border:1px solid rgba(62,207,142,0.3);border-radius:8px;padding:14px 18px;margin-bottom:22px">
            <div style="font-size:11px;color:#7c7c9a;margin-bottom:4px">Your custom domain</div>
            <div style="font-size:16px;font-weight:700;color:#3ecf8e">https://${safeDomain}</div>
          </div>
          <p style="font-size:13px;color:#7c7c9a;margin:0 0 22px">
            Your workspace is now accessible at this URL. Share it with your clients.
          </p>
          <a href="https://${safeDomain}" style="display:inline-block;background:#6c63ff;color:#fff;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:600;text-decoration:none">
            Visit your domain →
          </a>
        </div>
        <p style="font-size:12px;color:#4a4a65;text-align:center;margin-top:24px">
          © ${new Date().getFullYear()} Quill.AI
        </p>
      </div>
    `,
  })
}
