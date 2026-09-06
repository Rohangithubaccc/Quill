// ─────────────────────────────────────────────────────────────────────────────
// GDPR / DPDP Act 2023 — account (workspace) deletion.
//
// Semantics (confirmed with product owner, not assumed):
//   - Soft-delete with a 30-day grace period, not instant hard delete.
//   - An active Stripe subscription blocks the request — cancel billing
//     first, deletion does not auto-cancel it.
//   - Only the workspace owner can request deletion.
// See migration 028_gdpr_deletion.sql and the routes under
// src/app/api/gdpr/ and src/app/api/cron/purge-deleted-workspaces/.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend'

export const GRACE_PERIOD_DAYS = 30

// Stripe subscription statuses that mean "still billing in some form" —
// any of these blocks a deletion request. Deliberately conservative:
// past_due/unpaid are still attempting to charge the card, not yet
// resolved to a terminal state, so treated as active rather than assumed
// abandoned.
export const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'] as const

export function hasActiveSubscription(subscriptionStatus: string | null): boolean {
  return !!subscriptionStatus && (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(subscriptionStatus)
}

// Lazily instantiated so importing this module never crashes when
// RESEND_API_KEY isn't set yet — same pattern as workspace/invites/route.ts.
let _resend: Resend | null = null
export function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
  return _resend
}

export function formatPurgeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Resolves email addresses for active workspace members, excluding one
 * user (the person who just took the action — they get their own,
 * more detailed email from the caller). Same two-step shape already used
 * in content/[id]/comments/route.ts for @mention notifications:
 * workspace_members -> user_id, then auth.admin.getUserById() per member.
 * Fine at workspace-team scale; not meant for bulk/paginated use.
 */
export async function getOtherActiveMemberEmails(
  admin: ReturnType<typeof import('@/lib/supabase/server').createSupabaseAdmin>,
  workspaceId: string,
  excludeUserId: string,
): Promise<string[]> {
  const { data: members } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .neq('user_id', excludeUserId)

  const results = await Promise.allSettled(
    (members ?? []).map(m => admin.auth.admin.getUserById(m.user_id)),
  )

  return results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof admin.auth.admin.getUserById>>> => r.status === 'fulfilled')
    .map(r => r.value.data?.user?.email)
    .filter((email): email is string => !!email)
}

/**
 * Shared chrome (brand header + footer) for both deletion-flow emails —
 * unlike the rest of the codebase's one-off inline templates per route,
 * these two are tightly related (same feature, same lib file already),
 * so sharing just the wrapper avoids duplicating it twice while still
 * keeping each email's actual body content inline at its call site.
 */
export function renderEmailShell(innerHtml: string): string {
  return `
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
      ${innerHtml}
    </div>
    <p style="text-align:center;color:#4a4a65;font-size:11px;margin-top:20px">
      © ${new Date().getFullYear()} Quill.AI · <a href="${process.env.NEXT_PUBLIC_URL}/privacy" style="color:#4a4a65">Privacy Policy</a>
    </p>
  </div>
</body></html>`
}
