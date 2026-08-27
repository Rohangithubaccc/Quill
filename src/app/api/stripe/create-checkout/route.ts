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

  const session = await getStripe().checkout.sessions.create({
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

  return jsonOk({ url: session.url })
}
