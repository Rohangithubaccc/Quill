import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import TrialEndingSoonEmail from '@/emails/TrialEndingSoonEmail'
import UsageLimitEmail from '@/emails/UsageLimitEmail'

// render() from @react-email/render is async and works correctly in
// Next.js serverless functions. Do NOT use renderToStaticMarkup from
// react-dom/server — it does not work reliably in serverless/edge runtimes.

// Lazily instantiated so importing this module never crashes when
// RESEND_API_KEY isn't set yet — only sending an email requires the key.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
  return _resend
}
const CRON_SECRET = process.env.CRON_SECRET

// Days at which we send trial-ending emails
const TRIAL_ALERT_DAYS = [10, 4, 1]

export async function POST(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createSupabaseAdmin()
  const now   = new Date()
  let trialSent = 0
  let usageSent = 0
  const errors: string[] = []

  // ── 1. Trial-ending emails ─────────────────────────────────────────────
  const { data: trialingWorkspaces } = await admin
    .from('workspaces')
    .select('id, name, plan, usage_count, usage_limit, trial_ends_at')
    .eq('subscription_status', 'trialing')
    .not('trial_ends_at', 'is', null)

  for (const ws of trialingWorkspaces ?? []) {
    const daysLeft = Math.ceil(
      (new Date(ws.trial_ends_at as string).getTime() - now.getTime()) / 86_400_000
    )

    if (!TRIAL_ALERT_DAYS.includes(daysLeft)) continue

    // ── Atomically claim this send (migration 036) ───────────────────────
    // Replaces a separate SELECT-then-INSERT — see linkedin-token-reminder
    // for the concurrent test that proved the old shape could double-send.
    // claim_email_send() both checks AND logs the send in one atomic RPC;
    // a non-null id means this invocation owns the send and must release
    // it (delete the row) below if the actual send fails.
    const emailType = `trial_ending_${daysLeft}d`
    const { data: claimId } = await admin.rpc('claim_email_send', {
      p_workspace_id: ws.id,
      p_email_type:   emailType,
      p_window_start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    })

    if (!claimId) continue

    // Get owner email
    const { data: ownerMember } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', ws.id)
      .eq('role', 'owner')
      .limit(1)
      .single()

    if (!ownerMember) continue

    const { data: authUser } = await admin.auth.admin.getUserById(ownerMember.user_id)
    if (!authUser?.user?.email) continue

    const firstName = (authUser.user.user_metadata?.full_name as string ?? '').split(' ')[0] || 'there'

    try {
      // render() is async — must be awaited. Returns a plain HTML string
      // ready to pass directly to resend.emails.send().
      const html = await render(
        TrialEndingSoonEmail({
          firstName,
          daysLeft,
          usageCount: ws.usage_count,
          usageLimit: ws.usage_limit,
          workspaceName: ws.name,
        })
      )

      await getResend().emails.send({
        from: process.env.EMAIL_FROM!,
        to: authUser.user.email,
        subject: daysLeft === 1
          ? '⚠️ Last day of your Quill.AI trial!'
          : `⏰ ${daysLeft} days left in your Quill.AI trial`,
        html,
      })

      console.log(`[Trial email] Sent ${emailType} to ${authUser.user.email} (ws: ${ws.id})`)
      trialSent++
    } catch (err) {
      // Release the claim so this alert is retried on a future run
      // instead of being permanently marked "sent today" despite never
      // actually going out.
      await Promise.resolve(admin.from('sent_emails').delete().eq('id', claimId)).catch(() => {})
      const msg = `Trial email failed for ws ${ws.id}: ${err instanceof Error ? err.message : String(err)}`
      console.error(msg)
      errors.push(msg)
    }
  }

  // ── 2. Usage-limit (80%) emails ────────────────────────────────────────
  const { data: nearLimitWorkspaces } = await admin
    .from('workspaces')
    .select('id, name, plan, usage_count, usage_limit')
    .neq('plan', 'cancelled')
    .gt('usage_limit', 0)

  for (const ws of nearLimitWorkspaces ?? []) {
    const pct = ws.usage_count / ws.usage_limit
    if (pct < 0.8) continue

    // Atomically claim this send (migration 036) — see the trial-ending
    // branch above for why this replaced a separate SELECT-then-INSERT.
    const emailType = 'usage_80pct'
    const { data: claimId } = await admin.rpc('claim_email_send', {
      p_workspace_id: ws.id,
      p_email_type:   emailType,
      p_window_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    })

    if (!claimId) continue

    const { data: ownerMember } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', ws.id)
      .eq('role', 'owner')
      .limit(1)
      .single()

    if (!ownerMember) continue

    const { data: authUser } = await admin.auth.admin.getUserById(ownerMember.user_id)
    if (!authUser?.user?.email) continue

    const firstName = (authUser.user.user_metadata?.full_name as string ?? '').split(' ')[0] || 'there'

    try {
      // render() is async — must be awaited. Returns a plain HTML string
      // ready to pass directly to resend.emails.send().
      const html = await render(
        UsageLimitEmail({
          firstName,
          usageCount: ws.usage_count,
          usageLimit: ws.usage_limit,
          plan: ws.plan,
          workspaceName: ws.name,
        })
      )

      await getResend().emails.send({
        from: process.env.EMAIL_FROM!,
        to: authUser.user.email,
        subject: `⚡ You've used ${Math.round(pct * 100)}% of your Quill.AI monthly limit`,
        html,
      })

      console.log(`[Usage email] Sent 80% alert to ${authUser.user.email} (ws: ${ws.id})`)
      usageSent++
    } catch (err) {
      await Promise.resolve(admin.from('sent_emails').delete().eq('id', claimId)).catch(() => {})
      const msg = `Usage email failed for ws ${ws.id}: ${err instanceof Error ? err.message : String(err)}`
      console.error(msg)
      errors.push(msg)
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      summary: `Trial emails sent: ${trialSent}. Usage emails sent: ${usageSent}.`,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
