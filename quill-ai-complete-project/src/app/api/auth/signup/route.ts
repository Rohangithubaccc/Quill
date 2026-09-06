import { NextRequest } from 'next/server'
import { render } from '@react-email/render'
import WelcomeEmail from '@/emails/WelcomeEmail'
import { z } from 'zod'
import { createSupabaseAdmin, createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { slugify, jsonError, jsonOk } from '@/lib/utils'
import { PLAN_CREDITS } from '@/lib/credits'
import { Resend } from 'resend'
import { getLimiter, checkLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit'

// 10 signup attempts per IP per hour — generous for shared IPs (offices,
// universities) while still blocking automated mass account creation.
const signupLimiter = getLimiter('rl:signup:ip', 10, '1 h')

// Lazily instantiated so importing this module (e.g. during `next build`'s
// page-data collection) never crashes when RESEND_API_KEY isn't set yet —
// only actually sending an email requires the key.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
  return _resend
}

const SignupSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  // Length alone let through things like eight spaces or the literal
  // word "password" — found during a ruthless adversarial pass. Not
  // trying to impose heavy character-class rules (mixed guidance like
  // NIST's actually recommends against that in favor of length +
  // breach-list checking, which is real infrastructure this doesn't
  // have) — just requiring at least one letter and one digit rules out
  // both concrete examples found without being burdensome for genuine
  // passwords.
  password: z.string().min(8).max(128)
    .refine(p => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Password must contain at least one letter and one number.'),
  workspaceName: z.string().min(2).max(100),
})

export async function POST(req: NextRequest) {
  const { success, reset } = await checkLimit(signupLimiter, getClientIp(req))
  if (!success) {
    return rateLimitResponse('Too many signup attempts from this network. Try again later.', reset)
  }

  let body: z.infer<typeof SignupSchema>
  try {
    body = SignupSchema.parse(await req.json())
  } catch (e) {
    return jsonError(
      'Validation error: ' +
        (e instanceof z.ZodError ? e.errors.map((er) => er.message).join(', ') : 'invalid input')
    )
  }

  const { fullName, email, password, workspaceName } = body

  // ── 1. Create auth user ────────────────────────────────────────────────
  //
  // We use the anon-key server client's signUp() rather than
  // admin.auth.admin.createUser() so that Supabase sends the confirmation
  // email automatically when "Confirm email" is enabled in the dashboard.
  //
  // admin.createUser() with email_confirm:false creates the user but does
  // NOT trigger the confirmation email — the user would be unconfirmed
  // forever with no way to verify. signUp() handles this correctly.
  const supabase = await createSupabaseServerClient()

  const { data: signUpData, error: authErr } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_URL}/api/auth/callback`,
    },
  })

  const user = signUpData?.user

  if (authErr || !user) {
    // Supabase returns a generic "User already registered" message for
    // duplicate emails when email confirmation is enabled.
    if (
      authErr?.message?.includes('already registered') ||
      authErr?.message?.includes('already exists')
    ) {
      return jsonError('An account with this email already exists.', 409)
    }
    return jsonError(authErr?.message ?? 'Failed to create account', 500)
  }

  // ── 2. Create workspace eagerly ────────────────────────────────────────
  //
  // We create the workspace even for unverified users so that when they
  // click the confirmation link and are redirected to /dashboard, their
  // workspace already exists and they land in a good state immediately.
  // The workspace is inaccessible via the app until email is confirmed
  // because middleware enforces email_confirmed_at on every app route.
  const admin = createSupabaseAdmin()
  const baseSlug = slugify(workspaceName)

  // Retry-on-conflict instead of check-then-insert. Found during a
  // ruthless pass: the previous SELECT-then-INSERT had a real race —
  // two people signing up with the same workspace name at nearly the
  // same moment could both see "no existing slug" and both attempt the
  // identical insert, with the loser hitting a hard Postgres
  // unique-violation and their brand-new auth account getting silently
  // rolled back behind a generic error. Reproduced directly with two
  // real concurrent signups against the same workspace name. A plain
  // SELECT-then-INSERT can't close this race by construction — the
  // fix is to let the database's own unique constraint be the actual
  // source of truth and retry with a new random suffix on conflict,
  // same principle as every other atomic-claim fix in this codebase,
  // just expressed as a retry loop since a slug is freely regenerable,
  // unlike a fixed resource such as a credit balance.
  // Starter plan values, explicit — found via a real signup landing with
  // credits_remaining: 0, credits_monthly: 0, trial_ends_at: null. This
  // INSERT previously only set plan/usage_count/usage_limit, silently
  // relying on the workspaces table's raw column defaults (0, 0, NULL)
  // for everything else instead of actual Starter-plan values — meaning
  // every real signup landed permanently unable to generate any content
  // at all (credits_remaining < creditCost is the real gate in
  // ai/generate/route.ts; usage_limit isn't), with no trial period
  // despite WelcomeEmail unconditionally telling the new user they have
  // 14 days. credits_remaining/credits_monthly come from the same
  // PLAN_CREDITS constant every credit-deducting route already uses —
  // "never hardcode credit values" per that file's own header comment,
  // which this route was quietly violating by omission. usage_limit=12
  // matches this plan's documented definition (4 blogs + 8 social posts);
  // it isn't the actual generation gate but is shown directly in
  // Settings, the generator page, and the dashboard, so a stale value
  // there is a real user-facing bug too, just a less severe one.
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  let workspace: any = null
  let wsErr: any = null
  const MAX_SLUG_ATTEMPTS = 5

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidateSlug = attempt === 0
      ? baseSlug
      : `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`

    const { data, error } = await admin
      .from('workspaces')
      .insert({
        name: workspaceName,
        slug: candidateSlug,
        plan: 'starter',
        usage_count: 0,
        usage_limit: 12,
        credits_monthly: PLAN_CREDITS.starter,
        credits_remaining: PLAN_CREDITS.starter,
        trial_ends_at: trialEndsAt,
        subscription_status: 'trialing',
      })
      .select()
      .single()

    if (!error) { workspace = data; wsErr = null; break }

    wsErr = error
    const isSlugCollision =
      error.message?.includes('duplicate') ||
      error.message?.includes('unique')    ||
      (error as any).code === '23505'
    // Anything other than a genuine slug collision (a real DB outage,
    // for instance) should fail immediately, not burn through retries
    // that can't possibly help.
    if (!isSlugCollision) break
  }

  if (wsErr || !workspace) {
    // Rollback: delete the auth user so they can retry cleanly
    await admin.auth.admin.deleteUser(user.id)
    return jsonError('Failed to create workspace', 500)
  }

  // ── 3. Add user as owner ───────────────────────────────────────────────
  const { error: memberErr } = await admin.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'owner',
    status: 'active',
  })

  if (memberErr) {
    await admin.auth.admin.deleteUser(user.id)
    await admin.from('workspaces').delete().eq('id', workspace.id)
    return jsonError('Failed to set up workspace membership', 500)
  }

  // ── 4. Check whether email verification is required ───────────────────
  //
  // When "Confirm email" is enabled in Supabase Auth settings,
  // user.email_confirmed_at will be null immediately after signUp().
  // In that case we return requiresVerification:true so the frontend
  // redirects the user to /verify-email instead of /dashboard.
  //
  // If Supabase is configured with email confirmation disabled (e.g. in
  // local dev), email_confirmed_at will be set and we proceed to auto-login.
  const requiresVerification = !user.email_confirmed_at

  if (requiresVerification) {
    // The Supabase confirmation email is already sent by signUp() above.
    // Send our branded welcome email separately (non-fatal on failure).
    try {
      const html = await render(
        WelcomeEmail({
          firstName: fullName.split(' ')[0] || fullName,
          workspaceName,
          trialDays: 14,
        })
      )
      await getResend().emails.send({
        from: process.env.EMAIL_FROM!,
        to: email,
        subject: 'Welcome to Quill.AI ✦',
        html,
      })
    } catch (emailErr) {
      console.error('[Quill.AI] Welcome email failed:', emailErr)
    }

    // Return early — do NOT auto-login an unverified user
    return jsonOk({ requiresVerification: true, email: user.email })
  }

  // ── 5. Email already confirmed — auto-login ────────────────────────────
  //
  // This branch runs when email confirmation is disabled in Supabase
  // (e.g. local development). Production always goes through branch 4.
  try {
    const html = await render(
      WelcomeEmail({
        firstName: fullName.split(' ')[0] || fullName,
        workspaceName,
        trialDays: 14,
      })
    )
    await getResend().emails.send({
      from: process.env.EMAIL_FROM!,
      to: email,
      subject: 'Welcome to Quill.AI ✦',
      html,
    })
  } catch (emailErr) {
    console.error('[Quill.AI] Welcome email failed:', emailErr)
  }

  // signUp() sets the session in the cookie store automatically when
  // email confirmation is disabled. Set the workspace_id cookie too.
  const cookieStore = await cookies()
  cookieStore.set('workspace_id', workspace.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })

  return jsonOk({ success: true, workspace, autoLogin: true }, 201)
}
