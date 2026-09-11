import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'

// Lazily instantiated so importing this module never crashes when
// STRIPE_SECRET_KEY isn't set yet — only creating a portal session requires the key.
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

// POST /api/stripe/billing-portal
//
// Creates a Stripe Customer Portal session for the current workspace.
// The portal lets users: manage cards, view invoices, cancel, upgrade/downgrade.
//
// Called by the settings page billing section:
//   const res = await fetch('/api/stripe/billing-portal', { method: 'POST' })
//   if (res.ok) { const { url } = await res.json(); window.location.href = url }
export async function POST(_req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const ws = workspace as any

  // Must have a Stripe customer to open the portal
  if (!ws.stripe_customer_id) {
    return NextResponse.json(
      { error: 'no_subscription', message: 'No active subscription found. Subscribe to a plan first.' },
      { status: 400 }
    )
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer:   ws.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_URL}/settings?tab=billing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[billing-portal] Stripe error:', err)

    // Stripe throws when the customer ID is invalid or the portal isn't configured
    if (err?.code === 'resource_missing') {
      return jsonError(
        'Billing portal not configured. Go to Stripe Dashboard → Settings → Customer Portal and enable it.',
        503
      )
    }
    return jsonError('Could not open billing portal — please try again', 500)
  }
}
