import { NextRequest } from 'next/server'
import Stripe           from 'stripe'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/stripe/create-addon-checkout
//
// Creates a one-time Stripe Checkout session for credit add-on purchases.
// Uses mode: 'payment' (not 'subscription') — this is a one-time charge.
//
// STRIPE SETUP REQUIRED (do this before deploying):
//   1. Dashboard → Products → Add product
//      Name: "Quill.AI Credits"
//   2. Add three one-time prices (not recurring):
//      - 100 credits: $39.00  → copy price ID → STRIPE_ADDON_SMALL_PRICE_ID
//      - 300 credits: $99.00  → copy price ID → STRIPE_ADDON_MEDIUM_PRICE_ID
//      - 750 credits: $199.00 → copy price ID → STRIPE_ADDON_LARGE_PRICE_ID
//   3. Do NOT create Stripe Payment Links (static URLs cannot carry
//      workspace_id context). Use dynamic Checkout Sessions instead.
//   4. Ensure 'checkout.session.completed' is enabled in your webhook.
// ─────────────────────────────────────────────────────────────────────────────

// Lazily instantiated so importing this module never crashes when
// STRIPE_SECRET_KEY isn't set yet — only creating a checkout session requires the key.
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

const ADDON_PACKS = {
  small: {
    priceId:  process.env.STRIPE_ADDON_SMALL_PRICE_ID  ?? '',
    credits:  100,
    label:    '100 credits',
    priceUsd: 39,
  },
  medium: {
    priceId:  process.env.STRIPE_ADDON_MEDIUM_PRICE_ID ?? '',
    credits:  300,
    label:    '300 credits',
    priceUsd: 99,
  },
  large: {
    priceId:  process.env.STRIPE_ADDON_LARGE_PRICE_ID  ?? '',
    credits:  750,
    label:    '750 credits',
    priceUsd: 199,
  },
} as const

type PackSize = keyof typeof ADDON_PACKS

export async function POST(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) {
    return workspaceCatch(e)
  }

  // ── Parse and validate pack size ───────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const { packSize } = body as { packSize: string }

  if (!packSize || !(packSize in ADDON_PACKS)) {
    return jsonError('Invalid packSize. Must be "small", "medium", or "large".', 400)
  }

  const pack = ADDON_PACKS[packSize as PackSize]

  if (!pack.priceId) {
    console.error(`[addon-checkout] STRIPE_ADDON_${packSize.toUpperCase()}_PRICE_ID is not set`)
    return jsonError('Credit add-on pricing is not configured. Contact support.', 503)
  }

  // ── Get or create Stripe customer ──────────────────────────────────────────
  const admin = createSupabaseAdmin()
  const ws    = workspace as any
  let customerId: string = ws.stripe_customer_id ?? ''

  if (!customerId) {
    const customer = await getStripe().customers.create({
      email:    user.email ?? '',
      metadata: { workspace_id: ws.id, user_id: user.id },
    })
    customerId = customer.id
    await admin.from('workspaces').update({ stripe_customer_id: customerId }).eq('id', ws.id)
  }

  // ── Create one-time Checkout Session ───────────────────────────────────────
  const session = await getStripe().checkout.sessions.create({
    customer:    customerId,
    mode:        'payment',
    line_items:  [{ price: pack.priceId, quantity: 1 }],

    // workspace_id and credit amount must be in BOTH metadata locations:
    // - session.metadata          → readable in the webhook event directly
    // - payment_intent_data.metadata → on the PaymentIntent (fallback)
    metadata: {
      workspace_id:  ws.id,
      addon_credits: pack.credits.toString(),
      pack_size:     packSize,
      type:          'credit_addon',   // webhook uses this to distinguish from subscriptions
    },

    payment_intent_data: {
      metadata: {
        workspace_id:  ws.id,
        addon_credits: pack.credits.toString(),
        pack_size:     packSize,
        type:          'credit_addon',
      },
    },

    // Redirect back to generator — query params show a success toast
    success_url: `${process.env.NEXT_PUBLIC_URL}/generator?addon=success&credits=${pack.credits}&pack=${packSize}`,
    cancel_url:  `${process.env.NEXT_PUBLIC_URL}/generator?addon=cancelled`,

    // Allow promo codes so you can run credit-pack promotions
    allow_promotion_codes: true,
  })

  if (!session.url) {
    return jsonError('Failed to create Stripe checkout session', 500)
  }

  return jsonOk({ url: session.url, credits: pack.credits, priceUsd: pack.priceUsd })
}
