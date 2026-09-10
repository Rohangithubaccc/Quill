import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'

// TEMPORARY — Stage 3 item 6, take three. Take two (manual invoice
// creation) found nothing to bill: the subscription's current period was
// already fully paid from the trial-end trigger, so a fresh invoice for
// that same subscription came back $0-due and auto-marked "paid" before
// we even attempted payment — Stripe doesn't require collection on a
// zero-amount invoice. Manually creating invoices was the wrong tool.
//
// billing_cycle_anchor: 'now' is the correct primitive: it closes out the
// current period early and opens a genuinely new one starting this
// instant, which is what actually makes Stripe attempt to charge the
// current default payment method for a new period — not just re-invoice
// a period that's already settled. Same disposable pattern as the rest of
// this saga: authenticated, scoped to the caller's own workspace, removed
// once the test is done.
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
  if (!ws.stripe_subscription_id || !ws.stripe_customer_id) {
    return jsonError('No subscription on this workspace', 400)
  }

  const stripe = getStripe()

  // Dump the raw payment method data rather than guessing at a field path
  // again — the last attempt's default_payment_method_last4 came back
  // null even with a populated id, which given this account's history of
  // API-version-dependent field placement (see the period-fields saga) is
  // more likely an unexpected shape than a real absence.
  const customer = await stripe.customers.retrieve(ws.stripe_customer_id) as any
  const defaultPmId = typeof customer.invoice_settings?.default_payment_method === 'string'
    ? customer.invoice_settings.default_payment_method
    : customer.invoice_settings?.default_payment_method?.id
  const pm = defaultPmId ? await stripe.paymentMethods.retrieve(defaultPmId) as any : null

  const updated = await stripe.subscriptions.update(ws.stripe_subscription_id, {
    billing_cycle_anchor: 'now',
    proration_behavior: 'none',
  }) as any

  return NextResponse.json({
    default_payment_method_id: defaultPmId ?? null,
    default_payment_method_raw: pm ?? null,
    subscription_status: updated.status,
    latest_invoice_id: updated.latest_invoice ?? null,
  })
}
