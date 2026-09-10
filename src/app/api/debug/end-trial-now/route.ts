import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'

// TEMPORARY — Stage 3 item 6 (real payment-failure test). Same disposable
// pattern as the earlier /api/debug/stripe-period-check route: remove once
// the test is done. Requires a real logged-in session and only ever acts
// on THAT user's own workspace's subscription — there's no
// subscriptionId/workspaceId input, so this cannot be pointed at anyone
// else's subscription no matter what's passed in.
//
// Ending a trial immediately (trial_end: 'now') is the standard way to
// force Stripe to attempt to charge whatever payment method is currently
// on file, without waiting for the real trial period to elapse. Combined
// with Stripe's documented always-fails-on-charge test card
// (4000 0000 0000 0341, attached via the Customer Portal beforehand),
// this produces a genuine invoice.payment_failed event tied to the real
// customer/subscription — not a Stripe CLI fixture disconnected from any
// real workspace, which wouldn't exercise this app's actual handling
// logic (workspace lookup by stripe_customer_id, past_due banner, etc).
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

export async function POST() {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const ws = workspace as any
  if (!ws.stripe_subscription_id) return jsonError('No subscription on this workspace', 400)

  const updated = await getStripe().subscriptions.update(ws.stripe_subscription_id, {
    trial_end: 'now',
    proration_behavior: 'none',
  })

  return NextResponse.json({
    subscription_id: updated.id,
    status: updated.status,
    cancel_at_period_end: updated.cancel_at_period_end,
  })
}
