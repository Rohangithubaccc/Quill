import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, escapeHtml } from '@/lib/utils'
import { GRACE_PERIOD_DAYS, hasActiveSubscription, getResend, formatPurgeDate, renderEmailShell, getOtherActiveMemberEmails } from '@/lib/gdpr'
import { getLimiter, checkLimit, rateLimitResponse } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const RequestSchema = z.object({
  confirm:  z.literal(true),
  password: z.string().min(1),
})

// DELETE /api/gdpr/delete
// Requests deletion of the current workspace. Soft-delete: marks the
// workspace, blocks all other API routes via requireWorkspace()'s
// pending-deletion gate (migration 028), and a daily cron
// (src/app/api/cron/purge-deleted-workspaces) hard-deletes everything
// once the grace period elapses. Cancellable any time before then via
// POST /api/gdpr/delete/cancel.
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace, role
  try { ({ workspace, role } = await requireWorkspace(user.id, { allowPendingDeletion: true })) }
  catch (e) { return workspaceCatch(e) }

  // Deletion is workspace-wide and irreversible-by-default after the
  // grace period — restricted to the owner, same bar as billing changes.
  if (role !== 'owner') {
    return jsonError('Only the workspace owner can request deletion.', 403)
  }

  let body: z.infer<typeof RequestSchema>
  try { body = RequestSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid request') }

  // Re-verify the password server-side before a destructive action —
  // a throwaway client, not the cookie-bound session client, so this
  // doesn't touch or replace the caller's existing session.
  //
  // Rate limited per user: this calls the same signInWithPassword
  // mechanism as regular login, so Supabase Auth's own platform-level
  // brute-force protection already applies — this is defense-in-depth on
  // top of that, not the only safeguard, for the scenario where an
  // attacker has hijacked a session but not the password (found missing
  // during the ruthless review; every other password/credential-adjacent
  // route in this codebase already rate-limits).
  const pwLimiter = getLimiter('rl:gdpr-delete-pw', 5, '1 h')
  const { success: pwOk, reset: pwReset } = await checkLimit(pwLimiter, user.id)
  if (!pwOk) return rateLimitResponse('Too many attempts. Try again later.', pwReset)

  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { error: authError } = await verifier.auth.signInWithPassword({
    email:    user.email!,
    password: body.password,
  })
  if (authError) return jsonError('Incorrect password.', 401)

  // Idempotent: repeat requests just report the existing schedule
  // instead of erroring or resetting the 30-day clock.
  if (workspace.deletion_requested_at) {
    return jsonOk({
      alreadyRequested: true,
      scheduledPurgeAt: workspace.scheduled_purge_at,
    })
  }

  const admin = createSupabaseAdmin()

  const { data: billing } = await admin
    .from('workspaces')
    .select('subscription_status')
    .eq('id', workspace.id)
    .single()

  if (hasActiveSubscription(billing?.subscription_status ?? null)) {
    return jsonError(
      'You have an active subscription. Cancel your billing plan in Settings → Billing first, then request deletion again.',
      402,
    )
  }

  const scheduledPurgeAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // WHERE deletion_requested_at IS NULL closes the same race a plain
  // read-then-write would leave open: two near-simultaneous requests
  // can't both succeed and each reset the clock to their own timestamp.
  const { data: updated, error: updateErr } = await admin
    .from('workspaces')
    .update({
      deletion_requested_at: new Date().toISOString(),
      deletion_requested_by: user.id,
      scheduled_purge_at:    scheduledPurgeAt,
    })
    .eq('id', workspace.id)
    .is('deletion_requested_at', null)
    .select('scheduled_purge_at')
    .single()

  if (updateErr || !updated) {
    // Lost the race to a concurrent request — report its schedule rather
    // than erroring, since the outcome (workspace is now pending deletion)
    // is the same either way.
    const { data: current } = await admin
      .from('workspaces')
      .select('scheduled_purge_at')
      .eq('id', workspace.id)
      .single()
    return jsonOk({ alreadyRequested: true, scheduledPurgeAt: current?.scheduled_purge_at ?? null })
  }

  // Computed once, used in both email blocks below — html-template-literal
  // emails get zero automatic escaping, unlike JSX, and workspace.name is
  // genuinely user-controlled (zod only constrains length, see
  // auth/signup) and editable later via the client-side saveBrand() write.
  const safeName = escapeHtml(workspace.name)

  // ── Confirmation email ──────────────────────────────────────────────────
  // Non-fatal like every other email send in this codebase (invites, trial
  // reminders) — the deletion is already scheduled regardless of whether
  // this succeeds, so a Resend outage shouldn't block the request itself.
  try {
    await getResend().emails.send({
      from:    process.env.EMAIL_FROM!,
      to:      user.email!,
      subject: `${safeName} is scheduled for deletion — action needed if this wasn't you`,
      html: renderEmailShell(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f06565">Deletion scheduled</h1>
        <p style="color:#7c7c9a;font-size:14px;margin:0 0 24px;line-height:1.6">
          <strong style="color:#e8e8f0">${safeName}</strong> and all its content will be permanently
          deleted on <strong style="color:#e8e8f0">${formatPurgeDate(updated.scheduled_purge_at)}</strong>.
        </p>
        <div style="background:rgba(240,101,101,0.08);border:1px solid rgba(240,101,101,0.25);border-radius:8px;padding:12px 16px;margin-bottom:28px">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#7c7c9a;margin-bottom:4px">Changed your mind?</div>
          <div style="font-size:13px;color:#e8e8f0;line-height:1.5">You can cancel anytime before ${formatPurgeDate(updated.scheduled_purge_at)} — no data is deleted until then.</div>
        </div>
        <div style="text-align:center;margin-bottom:20px">
          <a href="${process.env.NEXT_PUBLIC_URL}/settings"
             style="display:inline-block;background:#6c63ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">
            Go to Settings →
          </a>
        </div>
        <p style="color:#4a4a65;font-size:12px;text-align:center;margin:0">
          Didn't request this? Cancel it from Settings, or contact support immediately.
        </p>
      `),
    })
  } catch (emailErr) {
    console.error('[GDPR] Deletion-scheduled email failed to send:', emailErr)
  }

  // ── Notify other active team members ─────────────────────────────────────
  // They can't cancel it themselves (owner-only, enforced server-side in
  // /api/gdpr/delete/cancel regardless of what any email or UI shows) —
  // this is informational: their access is about to disappear, and they
  // should know who to talk to about it. Also non-fatal, and one
  // recipient's failure doesn't block the others (Promise.allSettled).
  try {
    const memberEmails = await getOtherActiveMemberEmails(admin, workspace.id, user.id)
    const purgeDate = formatPurgeDate(updated.scheduled_purge_at)
    await Promise.allSettled(
      memberEmails.map(email => getResend().emails.send({
        from:    process.env.EMAIL_FROM!,
        to:      email,
        subject: `${safeName} is scheduled for deletion`,
        html: renderEmailShell(`
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f06565">Deletion scheduled</h1>
          <p style="color:#7c7c9a;font-size:14px;margin:0 0 24px;line-height:1.6">
            The owner of <strong style="color:#e8e8f0">${safeName}</strong> has scheduled it for permanent
            deletion on <strong style="color:#e8e8f0">${purgeDate}</strong>. Your access to this workspace will
            end when that happens.
          </p>
          <div style="background:rgba(240,101,101,0.08);border:1px solid rgba(240,101,101,0.25);border-radius:8px;padding:12px 16px;margin-bottom:28px">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#7c7c9a;margin-bottom:4px">Only the owner can cancel this</div>
            <div style="font-size:13px;color:#e8e8f0;line-height:1.5">If this is unexpected, reach out to the workspace owner directly.</div>
          </div>
          <div style="text-align:center;margin-bottom:20px">
            <a href="${process.env.NEXT_PUBLIC_URL}/settings"
               style="display:inline-block;background:#6c63ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">
              View in Settings →
            </a>
          </div>
        `),
      })),
    )
  } catch (memberEmailErr) {
    console.error('[GDPR] Team-member deletion-notice emails failed:', memberEmailErr)
  }

  return jsonOk({ scheduledPurgeAt: updated.scheduled_purge_at })
}
