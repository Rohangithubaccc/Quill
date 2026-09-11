import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Seat limits — single source of truth.
// Must stay in sync with Stripe plan configuration and the UI copy in settings.
// ─────────────────────────────────────────────────────────────────────────────

export const SEAT_LIMITS: Record<string, number> = {
  starter:   1,    // solo use — owner is the only seat
  growth:    5,
  agency:    20,
  cancelled: 0,    // no access after cancellation
}

export function getSeatLimit(plan: string): number {
  return SEAT_LIMITS[plan] ?? 1
}

// ── Seat usage breakdown ──────────────────────────────────────────────────────
// A "seat" is occupied by either an active member OR a pending (unexpired) invite.
// Counting both prevents a workspace from having 5 active members and 10 pending
// invites all accept simultaneously, exceeding the plan limit.
export interface SeatUsage {
  active:      number   // workspace_members with status = 'active'
  pending:     number   // workspace_invites with status = 'pending' AND not expired
  total:       number   // active + pending
  limit:       number   // max allowed by plan
  hasCapacity: boolean  // total < limit
}

export async function getSeatsUsed(
  admin: SupabaseClient,
  workspaceId: string,
  plan: string
): Promise<SeatUsage> {
  const limit = getSeatLimit(plan)

  const [activeRes, pendingRes] = await Promise.all([
    admin
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'active'),

    admin
      .from('workspace_invites')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString()),
  ])

  const active  = activeRes.count  ?? 0
  const pending = pendingRes.count ?? 0
  const total   = active + pending

  return {
    active,
    pending,
    total,
    limit,
    hasCapacity: total < limit,
  }
}

// ── Human-readable error message for seat limit hits ─────────────────────────
export function getSeatLimitMessage(seats: SeatUsage, plan: string): string {
  if (plan === 'starter') {
    return 'The Starter plan is for solo use (1 seat). Upgrade to Growth to add up to 5 teammates.'
  }

  const nextPlan = plan === 'growth' ? 'Agency (20 seats)' : null
  const base =
    `Seat limit reached. Your ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan allows ` +
    `${seats.limit} seat${seats.limit !== 1 ? 's' : ''} ` +
    `(${seats.active} active member${seats.active !== 1 ? 's' : ''} + ` +
    `${seats.pending} pending invite${seats.pending !== 1 ? 's' : ''}).`

  return nextPlan ? `${base} Upgrade to ${nextPlan} to add more team members.` : base
}
