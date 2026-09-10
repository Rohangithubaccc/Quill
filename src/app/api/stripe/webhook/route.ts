import { NextRequest } from 'next/server'
import Stripe           from 'stripe'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { PLAN_CREDITS }        from '@/lib/credits'
import { PLAN_STORAGE_LIMITS } from '@/lib/storage-quota'

// Lazily instantiated so importing this module never crashes when
// STRIPE_SECRET_KEY isn't set yet — only handling a webhook requires the key.
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

// Maps Stripe price IDs → plan name + monthly credit allocation.
// Add STRIPE_AGENCY_PRICE_ID to env when creating the Agency Stripe product.
const PLAN_LIMITS: Record<string, { plan: string; credits: number }> = {
  [process.env.STRIPE_STARTER_PRICE_ID ?? '']: { plan: 'starter', credits: PLAN_CREDITS.starter },
  [process.env.STRIPE_GROWTH_PRICE_ID  ?? '']: { plan: 'growth',  credits: PLAN_CREDITS.growth  },
  [process.env.STRIPE_AGENCY_PRICE_ID  ?? '']: { plan: 'agency',  credits: PLAN_CREDITS.agency  },
}

export async function POST(req: NextRequest) {
  // ── 1. Parse + verify Stripe signature ────────────────────────────────────
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig) return new Response('No signature', { status: 400 })

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('[Stripe webhook] Signature verification failed:', err)
    return new Response('Signature verification failed', { status: 400 })
  }

  const admin = createSupabaseAdmin()

  // ── 2. Claim this event_id atomically ─────────────────────────────────────
  // Found during the ruthless review: the previous version SELECTed first,
  // processed, then INSERTed the claim at the end. That SELECT was never
  // the actual safety mechanism — stripe_events.event_id's PRIMARY KEY is —
  // but doing the INSERT last meant two near-simultaneous deliveries of the
  // same event (Stripe explicitly documents at-least-once, not
  // exactly-once, delivery) could BOTH pass the SELECT before either
  // recorded anything, and both reach checkout.session.completed's
  // add_credits() call — a real double-credit, not a hypothetical one,
  // since that handler is additive rather than idempotent-by-construction
  // like the plan/credits SET in subscription.updated.
  //
  // Fix: attempt the INSERT first. It succeeding IS the claim — no other
  // request can also succeed for the same event_id, the same guarantee
  // migration 026/027's atomic functions rely on, just expressed as a
  // unique-constraint claim instead of a conditional UPDATE. A duplicate
  // delivery hits the constraint and is turned away before doing any work,
  // not after.
  const { error: claimError } = await admin
    .from('stripe_events')
    .insert({ event_id: event.id, event_type: event.type })

  if (claimError) {
    const isDuplicate =
      claimError.message.includes('duplicate') ||
      claimError.message.includes('unique')    ||
      (claimError as any).code === '23505'

    if (isDuplicate) {
      console.log(`[Stripe] Duplicate event ${event.id} (${event.type}) — already claimed, skipping`)
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Not a duplicate — some other DB error means we couldn't record a
    // claim at all. Processing anyway would defeat the point of claiming
    // first, so fail closed and let Stripe's own retry try again, the
    // same as any other genuine failure below.
    console.error('[Stripe webhook] Failed to claim event_id (non-duplicate error):', claimError.message)
    return new Response('Idempotency claim failed', { status: 500 })
  }

  // ── 3. Process event ──────────────────────────────────────────────────────
  try {
    switch (event.type) {

      // ── Subscription created / updated ─────────────────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub  = event.data.object as Stripe.Subscription
        const wsId = sub.metadata?.workspace_id

        if (!wsId) {
          console.error(`[Stripe] ${event.type}: missing workspace_id in metadata`, { subscriptionId: sub.id })
          break
        }

        const priceId  = sub.items.data[0]?.price.id ?? ''
        const planInfo = PLAN_LIMITS[priceId] ?? { plan: 'starter', credits: PLAN_CREDITS.starter }
        // Confirmed via a direct dump of this account's actual webhook
        // payload (see /api/debug/stripe-period-check?event=... during
        // Stage 3 item 4): this webhook endpoint is pinned to API version
        // 2026-08-26.dahlia, under which sub.current_period_start/end are
        // null on the Subscription object itself — Stripe moved these
        // onto each subscription item (to support multiple prices with
        // independent billing cycles per subscription), and the stripe
        // npm SDK here (v17.3.1) predates that change, so its types don't
        // know about it either, hence the cast. Every subscription this
        // app creates has exactly one price/item, so item[0] is
        // authoritative; falling back to the legacy top-level fields
        // costs nothing and keeps this working if the webhook's pinned
        // version is ever set back to something older.
        const periodItem = sub.items.data[0] as any
        const rawPeriodStart = periodItem?.current_period_start ?? sub.current_period_start
        const rawPeriodEnd   = periodItem?.current_period_end   ?? sub.current_period_end
        const newPeriodStart = rawPeriodStart
          ? new Date(rawPeriodStart * 1000).toISOString()
          : null
        // Stage 3 item 4 surfaced that this webhook never captured either
        // of these, despite Stripe sending both on every subscription
        // object — meaning a Customer Portal cancellation (which defaults
        // to "cancel at period end", not immediate) was completely
        // invisible to the app right up until subscription.deleted fired
        // and zeroed the workspace out with no warning. Synced
        // unconditionally on every created/updated event, same as the
        // other passthrough fields below — this is just reflecting
        // Stripe's current state, never spending or granting anything, so
        // it doesn't need the shouldResetCredits gate.
        const newPeriodEnd = rawPeriodEnd
          ? new Date(rawPeriodEnd * 1000).toISOString()
          : null

        // Found during a ruthless adversarial pass: subscription.updated
        // fires for far more than plan changes and renewals — a payment
        // method update, toggling cancel_at_period_end via the Customer
        // Portal, a metadata change, pause/resume collection all trigger
        // this exact same event type. Resetting credits_remaining to
        // full on every one of them meant a customer who'd used 80% of
        // their monthly credits and simply updated an expiring card got
        // a silent, free full refill. subscription.created is always a
        // genuine new activation, so it always resets; for .updated,
        // only reset when this is actually a plan change or the billing
        // period has genuinely rolled over — determined by comparing
        // against what's already on record, not by trusting that this
        // event type firing implies either.
        let shouldResetCredits = event.type === 'customer.subscription.created'

        if (!shouldResetCredits) {
          const { data: existing } = await admin
            .from('workspaces')
            .select('plan, stripe_current_period_start')
            .eq('id', wsId)
            .single()

          const isPlanChange = existing?.plan !== planInfo.plan
          // Compare as actual instants, not raw strings — Stripe's
          // toISOString() always produces the ".000Z" suffix format, but
          // PostgREST can return timestamptz columns as "+00:00" instead
          // (equally valid ISO 8601, same instant). A naive string `>`
          // comparison between those two representations of the exact
          // same moment gives a wrong answer (caught this empirically
          // before shipping the fix, not after), which would have
          // reintroduced the same bug via a different path — a false
          // "period rollover" on routine updates instead of a blanket
          // reset on every one.
          const isPeriodRollover = newPeriodStart
            ? !existing?.stripe_current_period_start
              || new Date(newPeriodStart).getTime() > new Date(existing.stripe_current_period_start).getTime()
            : false

          shouldResetCredits = isPlanChange || isPeriodRollover
        }

        const { error: updateError } = await admin.from('workspaces').update({
          plan:                    planInfo.plan,
          stripe_subscription_id:  sub.id,
          credits_monthly:         planInfo.credits,
          // NOT planInfo.credits directly — found live during Stage 3
          // testing: a real Starter checkout produced "Monthly Usage:
          // 0/120 pieces" in Settings, showing the credit count mislabeled
          // as a piece count (a real customer could not actually create
          // 120 blog posts a month on 120 credits, since content types
          // cost different credit amounts). usage_limit and credits are
          // different units; migration 012 already established the
          // system's own conversion between them (`credits_monthly =
          // usage_limit * 10`) when credits were introduced — dividing by
          // that same 10 here keeps this webhook consistent with that
          // existing ratio instead of inventing a new one, and matches
          // exactly what the signup route already sets for Starter (12).
          usage_limit:             Math.round(planInfo.credits / 10),
          storage_limit_bytes:     PLAN_STORAGE_LIMITS[planInfo.plan] ?? PLAN_STORAGE_LIMITS.starter,
          subscription_status:     sub.status,
          stripe_current_period_start: newPeriodStart,
          stripe_current_period_end:   newPeriodEnd,
          cancel_at_period_end:        sub.cancel_at_period_end,
          trial_ends_at:           sub.trial_end
            ? new Date(sub.trial_end * 1000).toISOString()
            : null,
          // Only touch the customer's actual balance when justified —
          // see shouldResetCredits above. Every other field here is safe
          // to sync unconditionally; it's just reflecting current
          // subscription state, not spending or granting anything.
          ...(shouldResetCredits ? { credits_remaining: planInfo.credits } : {}),
          // Auto-enable white-label for Agency plan upgrades.
          // Non-Agency plans do NOT set this to false — if an Agency customer
          // downgrades, their branding stays configured (they just lose the feature).
          ...(planInfo.plan === 'agency' ? { white_label_enabled: true } : {}),
        }).eq('id', wsId)

        if (updateError) throw new Error(`Failed to update workspace ${wsId}: ${updateError.message}`)

        console.log(`[Stripe] Workspace ${wsId} → ${planInfo.plan} (status: ${sub.status}${shouldResetCredits ? `, credits reset to ${planInfo.credits}` : ', credits unchanged'})`)
        break
      }

      // ── Subscription cancelled ──────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription

        const { error: cancelError } = await admin.from('workspaces').update({
          plan:                'cancelled',
          credits_monthly:     0,
          credits_remaining:   0,
          usage_limit:         0,
          storage_limit_bytes: PLAN_STORAGE_LIMITS.cancelled,
          subscription_status: 'cancelled',
          cancel_at_period_end: false,
        }).eq('stripe_subscription_id', sub.id)

        if (cancelError) throw new Error(`Failed to cancel workspace for sub ${sub.id}: ${cancelError.message}`)
        console.log(`[Stripe] Subscription ${sub.id} cancelled`)
        break
      }

      // ── Payment failed ──────────────────────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice    = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string
        if (!customerId) break

        const { error: failedError } = await admin.from('workspaces')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', customerId)

        if (failedError) throw new Error(`Failed to mark workspace past_due for customer ${customerId}: ${failedError.message}`)
        console.error(`[Stripe] Payment failed for customer ${customerId}`, {
          invoiceId: invoice.id, amountDue: invoice.amount_due, attemptCount: invoice.attempt_count,
        })
        break
      }

      // ── Payment succeeded ───────────────────────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice    = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string
        if (!customerId || invoice.amount_paid === 0) break

        const { error: succeededError } = await admin.from('workspaces')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', customerId)

        if (succeededError) throw new Error(`Failed to mark workspace active: ${succeededError.message}`)
        console.log(`[Stripe] Payment succeeded for customer ${customerId}`)
        break
      }

      // ── Credit add-on purchase ──────────────────────────────────────────────
      // Triggered by the create-addon-checkout endpoint (mode: 'payment').
      // Subscriptions do NOT fire this event — they use customer.subscription.*.
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        // Only handle one-time credit add-ons, not subscription checkouts
        if (session.mode !== 'payment')                 break
        if (session.metadata?.type !== 'credit_addon')  break

        const wsId    = session.metadata?.workspace_id
        const credits = parseInt(session.metadata?.addon_credits ?? '0', 10)

        if (!wsId || isNaN(credits) || credits <= 0) {
          console.error('[Stripe webhook] checkout.session.completed: missing workspace_id or credits', {
            sessionId: session.id, metadata: session.metadata,
          })
          break
        }

        // ATOMIC increment via Postgres function — prevents race conditions
        // when Stripe delivers the same event twice simultaneously (at-least-once).
        // The function: UPDATE workspaces SET credits_remaining = credits_remaining + p_credits WHERE id = p_workspace_id
        const { error: addErr } = await admin.rpc('add_credits', {
          p_workspace_id: wsId,
          p_credits:      credits,
        })

        if (addErr) {
          // Throw so we return 500 — Stripe will retry. Never return 200 on DB failure.
          throw new Error(`add_credits failed for workspace ${wsId}: ${addErr.message}`)
        }

        console.log(`[Stripe] Added ${credits} credits to workspace ${wsId} (session: ${session.id})`)
        break
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type} — ignoring`)
        break
    }

    // Event fully processed — the claim made at step 2 stands, correctly
    // marking this event_id as done. Nothing left to record here now that
    // claiming happens before processing instead of after.

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Stripe webhook] Handler error:', message, { eventId: event.id, eventType: event.type })

    // Release the claim — processing failed, so this event was never
    // actually handled. Leaving the claim in place would make Stripe's
    // retry get turned away at step 2 as a "duplicate" for an event that
    // in reality was never successfully processed once. Best-effort: if
    // this delete itself fails, the event is stuck claimed-but-unhandled
    // until someone notices in the stripe_events table — worse than a
    // silent double-charge risk, not worse than data loss.
    await Promise.resolve(
      admin.from('stripe_events').delete().eq('event_id', event.id),
    ).catch(() => {
      console.error(`[Stripe webhook] Also failed to release claim on ${event.id} — will look like a false duplicate on retry`)
    })

    return new Response('Webhook handler error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
