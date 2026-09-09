import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'

// TEMPORARY — diagnosing why stripe_current_period_start/end came back
// null on a real webhook for a real subscription. Same pattern as the
// /api/debug/env-check route used during the NEXT_PUBLIC_URL investigation
// (see handoff doc) — remove once the root cause is confirmed.
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

export async function GET(_req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const ws = workspace as any
  if (!ws.stripe_subscription_id) return jsonError('No subscription on this workspace', 400)

  const sub = await getStripe().subscriptions.retrieve(ws.stripe_subscription_id)
  const raw = sub as any

  return NextResponse.json({
    // Response header — this is the API version Stripe actually used to
    // generate this specific response, regardless of what's pinned (or
    // not pinned) client-side.
    stripe_response_api_version: (sub as any).lastResponse?.headers?.['stripe-version'] ?? null,
    top_level: {
      current_period_start: raw.current_period_start ?? null,
      current_period_end:   raw.current_period_end   ?? null,
      status:               raw.status,
      cancel_at_period_end: raw.cancel_at_period_end,
    },
    first_item: raw.items?.data?.[0]
      ? {
          current_period_start: raw.items.data[0].current_period_start ?? null,
          current_period_end:   raw.items.data[0].current_period_end   ?? null,
        }
      : null,
    trial_start: raw.trial_start ?? null,
    trial_end:   raw.trial_end   ?? null,
  })
}
