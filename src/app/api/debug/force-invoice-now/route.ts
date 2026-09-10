import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'

// TEMPORARY — Stage 3 item 6, take two. The trial-end trigger (now
// deleted) converted the subscription to active and successfully charged
// the original card before the decline card had been set as default —
// trial_end can only be forced once, so a fresh invoice is the only way
// left to force another collection attempt without waiting for the real
// Oct 10 renewal. Same disposable pattern: authenticated, scoped only to
// the caller's own workspace, removed once the test is done.
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

  // Confirm what's actually set as default before charging anything —
  // this is exactly the check that would have caught the first attempt's
  // problem before it happened, rather than after.
  const customer = await stripe.customers.retrieve(ws.stripe_customer_id) as Stripe.Customer
  const defaultPm = customer.invoice_settings?.default_payment_method
  const pmId = typeof defaultPm === 'string' ? defaultPm : defaultPm?.id
  const pm = pmId ? await stripe.paymentMethods.retrieve(pmId) : null

  const invoice = await stripe.invoices.create({
    customer: ws.stripe_customer_id,
    subscription: ws.stripe_subscription_id,
    auto_advance: true,
  })
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!)

  let paidInvoice: Stripe.Invoice | null = null
  let payError: string | null = null
  try {
    paidInvoice = await stripe.invoices.pay(finalized.id!)
  } catch (e: any) {
    payError = e.message
  }

  return NextResponse.json({
    default_payment_method_last4: pm && pm.card ? pm.card.last4 : null,
    default_payment_method_id:    pmId ?? null,
    invoice_id: finalized.id,
    invoice_status_before_pay: finalized.status,
    pay_attempt_error: payError,
    invoice_status_after_pay: paidInvoice?.status ?? null,
  })
}
