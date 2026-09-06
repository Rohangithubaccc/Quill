import { requireUser, requireWorkspace, createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, escapeHtml, dbError } from '@/lib/utils'
import { getResend, renderEmailShell, getOtherActiveMemberEmails } from '@/lib/gdpr'

export const runtime = 'nodejs'

// POST /api/gdpr/delete/cancel
// Cancels a pending deletion request any time before scheduled_purge_at.
// Same owner-only bar as requesting deletion in the first place.
export async function POST() {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace, role
  try { ({ workspace, role } = await requireWorkspace(user.id, { allowPendingDeletion: true })) }
  catch (e) { return workspaceCatch(e) }

  if (role !== 'owner') {
    return jsonError('Only the workspace owner can cancel a deletion request.', 403)
  }

  if (!workspace.deletion_requested_at) {
    return jsonOk({ cancelled: false, message: 'No deletion request is pending.' })
  }

  const admin = createSupabaseAdmin()
  const { error } = await admin
    .from('workspaces')
    .update({
      deletion_requested_at: null,
      deletion_requested_by: null,
      scheduled_purge_at:    null,
    })
    .eq('id', workspace.id)

  if (error) return dbError('gdpr/delete/cancel', error, 'Failed to cancel deletion. Please try again.', 500)

  // See the matching comment in gdpr/delete/route.ts — html-template
  // emails get zero automatic escaping, and workspace.name is genuinely
  // user-controlled.
  const safeName = escapeHtml(workspace.name)

  // Non-fatal, same as every other email send in this codebase — the
  // cancellation already succeeded regardless of whether this does.
  try {
    await getResend().emails.send({
      from:    process.env.EMAIL_FROM!,
      to:      user.email!,
      subject: `${safeName} is safe — deletion cancelled`,
      html: renderEmailShell(`
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#3ecf8e">Deletion cancelled ✓</h1>
        <p style="color:#7c7c9a;font-size:14px;margin:0 0 24px;line-height:1.6">
          <strong style="color:#e8e8f0">${safeName}</strong> is no longer scheduled for deletion.
          Everything — content, brand assets, team, and settings — is untouched and stays that way.
        </p>
        <div style="text-align:center;margin-bottom:20px">
          <a href="${process.env.NEXT_PUBLIC_URL}/dashboard"
             style="display:inline-block;background:#6c63ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">
            Back to Dashboard →
          </a>
        </div>
        <p style="color:#4a4a65;font-size:12px;text-align:center;margin:0">
          Didn't request this cancellation? Contact support if that seems wrong.
        </p>
      `),
    })
  } catch (emailErr) {
    console.error('[GDPR] Deletion-cancelled email failed to send:', emailErr)
  }

  // ── Notify other active team members ─────────────────────────────────────
  try {
    const memberEmails = await getOtherActiveMemberEmails(admin, workspace.id, user.id)
    await Promise.allSettled(
      memberEmails.map(email => getResend().emails.send({
        from:    process.env.EMAIL_FROM!,
        to:      email,
        subject: `${safeName} is safe — deletion cancelled`,
        html: renderEmailShell(`
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#3ecf8e">Deletion cancelled ✓</h1>
          <p style="color:#7c7c9a;font-size:14px;margin:0 0 24px;line-height:1.6">
            The owner of <strong style="color:#e8e8f0">${safeName}</strong> has cancelled the scheduled
            deletion. Your access is unaffected — nothing was deleted.
          </p>
          <div style="text-align:center;margin-bottom:20px">
            <a href="${process.env.NEXT_PUBLIC_URL}/dashboard"
               style="display:inline-block;background:#6c63ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">
              Back to Dashboard →
            </a>
          </div>
        `),
      })),
    )
  } catch (memberEmailErr) {
    console.error('[GDPR] Team-member cancellation-notice emails failed:', memberEmailErr)
  }

  return jsonOk({ cancelled: true })
}
