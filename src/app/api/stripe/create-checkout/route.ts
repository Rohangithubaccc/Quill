import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { z } from 'zod'

// Lazily instantiated so importing this module never crashes when
// STRIPE_SECRET_KEY isn't set yet — only creating a checkout session requires the key.
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

// POST /api/stripe/create-checkout
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  const { priceId } = await req.json() as { priceId: string }
  if (!priceId) return jsonError('priceId is required')

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  const admin = createSupabaseAdmin()

  let customerId = workspace.stripe_customer_id

  if (!customerId) {
    const customer = await getStripe().customers.create({
      email: user.email,
      metadata: { workspace_id: workspace.id, user_id: user.id },
    })
    customerId = customer.id
    await admin.from('workspaces').update({ stripe_customer_id: customerId }).eq('id', workspace.id)
  }

  let session: Stripe.Checkout.Session
  try {
    session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_URL}/settings?billing=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_URL}/settings`,
      // trial_period_days must be nested inside subscription_data, not top-level
      // on the Checkout Session — verified against the installed stripe package's
      // SessionsResource.d.ts (SubscriptionData.trial_period_days).
      subscription_data: {
        trial_period_days: 14,
        metadata: { workspace_id: workspace.id },
      },
      allow_promotion_codes: true,
    })
  } catch (err: any) {
    // Found live: this call previously had no error handling at all — a
    // malformed NEXT_PUBLIC_URL (Stripe requires an absolute URL with a
    // scheme for success_url/cancel_url) threw StripeInvalidRequestError
    // on every attempt, and with no catch here it surfaced as an
    // unhandled 500 with zero explanation, while the frontend's own
    // fetch just saw a non-ok response and showed a generic toast — the
    // upgrade button spun and did nothing, with no way to tell why short
    // of reading server logs. Same catch-and-explain shape as
    // billing-portal/route.ts, which already had this right.
    console.error('[create-checkout] Stripe error:', err)
    if (err?.code === 'url_invalid') {
      return jsonError('Server misconfiguration: NEXT_PUBLIC_URL is not a valid absolute URL. Contact support.', 503)
    }
    return jsonError('Could not start checkout — please try again', 500)
  }

  return jsonOk({ url: session.url })
}
