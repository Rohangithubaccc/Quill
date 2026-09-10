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

export async function GET(req: NextRequest) {
  // ?event=evt_... — inspect the exact webhook payload as Stripe actually
  // delivered it (including the API version *that event* was generated
  // under), rather than a fresh subscription fetch. Webhook endpoints pin
  // their own API version at creation time in the Stripe dashboard, which
  // can silently differ from the account's current default that a plain
  // stripe.subscriptions.retrieve() call uses — this is the only way to
  // see what the webhook handler itself actually received. No auth
  // required for this specific mode: purely diagnostic, temporary, reads
  // only Stripe's own event log by a known event id.
  const eventId = req.nextUrl.searchParams.get('event')
  if (eventId) {
    const event = await getStripe().events.retrieve(eventId)
    const obj = event.data.object as any
    return NextResponse.json({
      event_api_version: event.api_version,
      event_type: event.type,
      object_current_period_start: obj.current_period_start ?? null,
      object_current_period_end:   obj.current_period_end   ?? null,
      object_status: obj.status,
      object_cancel_at_period_end: obj.cancel_at_period_end,
      item_current_period_start: obj.items?.data?.[0]?.current_period_start ?? null,
      item_current_period_end:   obj.items?.data?.[0]?.current_period_end   ?? null,
    })
  }

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
