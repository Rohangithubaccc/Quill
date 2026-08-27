import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'
import { getLimiter, checkLimit } from '@/lib/rate-limit'

// Max 3 resend attempts per email address per hour.
// Keyed per email so one bad actor can't exhaust the global limit.
const limiter = getLimiter('rl:resend', 3, '1 h')

const BodySchema = z.object({
  email: z.string().email('Invalid email address'),
})

export async function POST(req: NextRequest) {
  // ── 1. Validate request body ───────────────────────────────────────────
  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch (e) {
    return jsonError(
      e instanceof z.ZodError ? e.errors[0].message : 'Invalid request body'
    )
  }

  const { email } = body

  // ── 2. Rate limit: 3 per email per hour ────────────────────────────────
  // Key is the email address itself (lowercased to be case-insensitive).
  const { success, remaining } = await checkLimit(limiter, email.toLowerCase())

  if (!success) {
    console.warn(`[resend-verification] Rate limit hit for: ${email}`)
    return jsonError('rate_limited', 429)
  }

  // ── 3. Resend the confirmation email via Supabase Auth ─────────────────
  //
  // We use the server client (anon key + cookies) here rather than the
  // admin client. supabase.auth.resend() with type:'signup' re-sends the
  // confirmation email for an unconfirmed account. It is a no-op (returns
  // no error) if the account is already confirmed — this prevents probing
  // whether an email address is registered.
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_URL}/api/auth/callback`,
    },
  })

  if (error) {
    // Log the internal error but return a generic message to the client
    // to avoid leaking whether the email is registered.
    console.error('[resend-verification] Supabase resend error:', error.message, { email })
    return jsonError('Failed to resend email. Please try again.', 500)
  }

  console.log(`[resend-verification] Resent confirmation email to ${email} (${remaining} attempts remaining this hour)`)

  return jsonOk({ sent: true })
}
