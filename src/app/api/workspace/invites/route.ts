import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, escapeHtml } from '@/lib/utils'
import { getSeatsUsed, getSeatLimit, getSeatLimitMessage, type SeatUsage } from '@/lib/seats'
import { Resend } from 'resend'
import { getLimiter, checkLimit, rateLimitResponse } from '@/lib/rate-limit'

// Lazily instantiated so importing this module never crashes when
// RESEND_API_KEY isn't set yet — only sending an email requires the key.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
  return _resend
}

// Per-workspace, not per-IP: the abuse case here is a compromised or
// malicious admin/owner account spamming invite emails to arbitrary
// addresses (Resend account reputation risk, harassment vector), not
// anonymous bot traffic — this route already requires an authenticated
// owner/admin, so the workspace is the meaningful unit to throttle.
const inviteLimiter = getLimiter('rl:invites:ws', 20, '1 h')

// ── POST /api/workspace/invites — send invite ───────────────────────────────
const InviteSchema = z.object({
  // Normalized to lowercase (and trimmed) here, at the validation
  // boundary, so every downstream use (the duplicate-member check, the
  // pending-invite dedup, the stored row, the seat-claim RPC, the
  // delivery address) is automatically consistent — found during a
  // ruthless pass that both the "already a member?" and "expire any
  // existing pending invite" checks used exact-match .eq() comparisons,
  // so inviting 'Jane@Example.com' when 'jane@example.com' already had
  // a pending (or accepted) invite neither detected the duplicate nor
  // deduped it — confirmed directly against real seeded rows, and
  // confirmed the seat-limit function counts raw rows, not distinct
  // emails, so this genuinely wasted a real, paid seat slot.
  //
  // .trim().toLowerCase() chained BEFORE .email() (not a .transform()
  // after it) — caught this ordering mistake myself before shipping it:
  // .email() validates the raw input first if the normalization comes
  // after, so a whitespace-padded address like "  a@b.com  " fails
  // validation outright instead of ever reaching a trim step. Verified
  // directly that this ordering actually applies the transform first.
  email: z.string().trim().toLowerCase().email(),
  role:  z.enum(['admin', 'editor', 'viewer']),
})

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  if (!['owner', 'admin'].includes(role)) {
    return jsonError('Only owners and admins can invite members', 403)
  }

  const { success, reset } = await checkLimit(inviteLimiter, workspace.id)
  if (!success) {
    return rateLimitResponse('Too many invites sent recently. Try again later.', reset)
  }

  let body: z.infer<typeof InviteSchema>
  try { body = InviteSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  // ── Duplicate member check ─────────────────────────────────────────────────
  const { data: existing } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspace.id)
    .eq('invited_email', body.email)
    .eq('status', 'active')
    .limit(1)
    .single()

  if (existing) return jsonError('This email is already a member of the workspace', 409)

  // Expire any existing pending invite for same email+workspace
  await admin
    .from('workspace_invites')
    .update({ status: 'expired' })
    .eq('workspace_id', workspace.id)
    .eq('email', body.email)
    .eq('status', 'pending')

  // ── Claim a seat and create the invite atomically ───────────────────────────
  // Was: getSeatsUsed() (a plain SELECT count) checked capacity, then a
  // separate .insert() created the invite — a real check-then-act race,
  // proven exploitable with a real 10-concurrent-request test against a
  // workspace with 2 free seats (without this fix, more than 2 could
  // succeed). claim_seat_and_create_invite() (migration 034) does the
  // count check and the insert as one atomic unit via a row lock on the
  // workspace, the same guarantee the credits/storage atomic functions
  // provide for a single counter column, just shaped for a two-table count
  // instead.
  const { data: claimResult, error: claimError } = await admin.rpc('claim_seat_and_create_invite', {
    p_workspace_id: workspace.id,
    p_invited_by:   user.id,
    p_email:        body.email,
    p_role:         body.role,
    p_seat_limit:   getSeatLimit(workspace.plan),
  })

  if (claimError) return jsonError('Failed to create invite: ' + claimError.message, 500)

  const claim = claimResult?.[0]

  if (!claim?.success) {
    const seats: SeatUsage = {
      active:      claim?.active_count  ?? 0,
      pending:     claim?.pending_count ?? 0,
      total:       (claim?.active_count ?? 0) + (claim?.pending_count ?? 0),
      limit:       getSeatLimit(workspace.plan),
      hasCapacity: false,
    }
    return new Response(
      JSON.stringify({
        error:            'seat_limit_reached',
        seats_used:       seats.total,
        seats_limit:      seats.limit,
        seats_active:     seats.active,
        seats_pending:    seats.pending,
        plan:             workspace.plan,
        upgrade_required: true,
        message:          getSeatLimitMessage(seats, workspace.plan),
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const invite = {
    id:         claim.invite_id,
    email:      body.email,
    role:       body.role,
    token:      claim.invite_token,
    expires_at: claim.invite_expires_at,
  }

  // Both fields below are genuinely user-controlled with no character
  // restriction (only zod length limits at signup / workspace creation,
  // and workspace.name is editable later too) — html: template literals
  // get zero automatic escaping, unlike JSX, so this is required, not
  // defensive-programming theater.
  const inviterName = escapeHtml(user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'A team member')
  const safeWsName  = escapeHtml(workspace.name)

  const roleDescriptions: Record<string, string> = {
    admin:  'Admin — can manage team and settings',
    editor: 'Editor — can create and publish content',
    viewer: 'Viewer — can view content only',
  }

  // ── Send invite email ──────────────────────────────────────────────────────
  try {
    await getResend().emails.send({
      from:    process.env.EMAIL_FROM!,
      to:      body.email,
      subject: `${inviterName} invited you to ${safeWsName} on Quill.AI`,
      html: `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:Inter,sans-serif;color:#e8e8f0">
  <div style="max-width:540px;margin:40px auto;padding:0 20px">
    <div style="text-align:center;margin-bottom:32px">
      <div style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#f5c842);border-radius:10px;padding:12px 20px;font-size:20px;font-weight:800;color:#fff">
        ✦ Quill.AI
      </div>
    </div>
    <div style="background:#1e1e28;border:1px solid #2a2a3a;border-radius:16px;padding:32px">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700">You're invited! 🎉</h1>
      <p style="color:#7c7c9a;font-size:14px;margin:0 0 24px;line-height:1.6">
        <strong style="color:#e8e8f0">${inviterName}</strong> has invited you to join
        <strong style="color:#e8e8f0">${safeWsName}</strong> on Quill.AI.
      </p>
      <div style="background:rgba(108,99,255,0.12);border:1px solid rgba(108,99,255,0.3);border-radius:8px;padding:12px 16px;margin-bottom:28px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#7c7c9a;margin-bottom:4px">Your Role</div>
        <div style="font-size:14px;font-weight:600;color:#6c63ff">${roleDescriptions[body.role] ?? body.role}</div>
      </div>
      <div style="text-align:center;margin-bottom:20px">
        <a href="${process.env.NEXT_PUBLIC_URL}/invite/${invite.token}"
           style="display:inline-block;background:#6c63ff;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600">
          Accept Invitation →
        </a>
      </div>
      <p style="color:#4a4a65;font-size:12px;text-align:center;margin:0">
        This invitation expires in 7 days.
      </p>
    </div>
    <p style="text-align:center;color:#4a4a65;font-size:11px;margin-top:20px">
      © ${new Date().getFullYear()} Quill.AI · <a href="${process.env.NEXT_PUBLIC_URL}/privacy" style="color:#4a4a65">Privacy Policy</a>
    </p>
  </div>
</body></html>
      `,
    })
  } catch (emailErr) {
    console.error('[Invite] Email send failed:', emailErr)
    // Non-fatal — invite created, email failed
  }

  return jsonOk({ invite: { id: invite.id, email: invite.email, role: invite.role, expires_at: invite.expires_at } }, 201)
}

// ── GET /api/workspace/invites — list pending invites ──────────────────────
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data, error } = await admin
    .from('workspace_invites')
    .select('id, email, role, status, expires_at, created_at')
    .eq('workspace_id', workspace.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) return jsonError('Failed to fetch invites', 500)

  // Also return seat usage so the settings UI can display the counter
  const admin2 = createSupabaseAdmin()
  const seats = await getSeatsUsed(admin2, workspace.id, workspace.plan)

  return jsonOk({ invites: data ?? [], seats })
}

// ── DELETE /api/workspace/invites — revoke invite ──────────────────────────
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner', 'admin'].includes(role)) return jsonError('Forbidden', 403)

  const { id } = await req.json() as { id: string }
  if (!id) return jsonError('Invite ID required')

  const admin = createSupabaseAdmin()
  await admin
    .from('workspace_invites')
    .update({ status: 'expired' })
    .eq('id', id)
    .eq('workspace_id', workspace.id)

  return jsonOk({ revoked: true })
}
