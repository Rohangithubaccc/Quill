import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
// NOTE: <Database> generic intentionally omitted from the client factories
// below. src/lib/types/database.ts is a placeholder stub (no real project
// connected yet) — its index-signature Tables shape doesn't satisfy
// Supabase's generic resolution for named-table operations, which
// cascades into `never` types at update/insert/select call sites
// throughout the app. Supabase-js's documented default for this generic
// is `any` when omitted, so this has ZERO effect on runtime behavior.
// Once you replace src/lib/types/database.ts with real output from
// `supabase gen types typescript`, re-add <Database> to both factories
// below for full compile-time table/column checking.

/** Server component / API route client — uses cookie-based session */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — cookies cannot be
            // mutated from Server Components; middleware handles refresh
          }
        },
      },
    }
  )
}

/**
 * Admin client — uses service_role key, bypasses RLS.
 * ONLY use server-side (API routes, server actions).
 * NEVER import in client components.
 *
 * CONNECTION POOLING NOTE:
 * In serverless (Vercel), use the Supabase transaction pooler URL (port 6543)
 * in DATABASE_URL to avoid exhausting Postgres connection limits.
 * Direct connections (port 5432) are fine for local dev but will fail at scale.
 * Find pooler URL: Supabase Dashboard → Settings → Database → Connection pooling
 */
export function createSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

/** Get the authenticated user — throws if not authenticated */
export async function requireUser() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return user
}

/**
 * Get workspace for the current user — throws if not found.
 *
 * By default, throws a 403 if the workspace has a pending GDPR deletion
 * request (migration 028) — this is the single choke-point almost every
 * route already goes through, so gating here blocks the whole app for a
 * workspace mid-grace-period without touching every route individually.
 * The handful of routes that legitimately need to keep working during the
 * grace period (export, delete, delete/cancel) pass
 * `{ allowPendingDeletion: true }` to opt out.
 */
export async function requireWorkspace(
  userId: string,
  opts?: { allowPendingDeletion?: boolean },
) {
  const supabase = await createSupabaseServerClient()
  const cookieStore = await cookies()
  const workspaceId = cookieStore.get('workspace_id')?.value

  let query = supabase
    .from('workspace_members')
    .select(
      `
      role,
      workspace:workspaces (
        id, name, slug, plan, usage_count, usage_limit,
        credits_remaining, credits_monthly,
        storage_used_bytes, storage_limit_bytes,
        deletion_requested_at, scheduled_purge_at,
        brand_voice, industry, logo_url, brand_knowledge,
        stripe_customer_id, stripe_subscription_id
      )
    `
    )
    .eq('user_id', userId)
    .eq('status', 'active')

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId)
  } else {
    query = query.order('created_at', { ascending: true })
  }

  const { data: member, error } = await query.limit(1).single()

  if (error || !member?.workspace) {
    throw new Response(JSON.stringify({ error: 'Workspace not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // workspace_members.workspace_id is a many-to-one foreign key to
  // workspaces.id, so Postgrest returns a SINGLE joined object at runtime.
  // Without real generated types, the untyped Supabase client can't encode
  // this cardinality and may type the join as an array — this defensively
  // unwraps either shape.
  const rawWorkspace = member.workspace as unknown
  const workspaceObj = (Array.isArray(rawWorkspace) ? rawWorkspace[0] : rawWorkspace) as Workspace

  if (workspaceObj.deletion_requested_at && !opts?.allowPendingDeletion) {
    throw new Response(JSON.stringify({
      error:            'workspace_pending_deletion',
      scheduledPurgeAt: workspaceObj.scheduled_purge_at,
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return {
    workspace: workspaceObj,
    role: member.role as string,
  }
}

/** Shape of the workspace fields selected in requireWorkspace() above. */
export interface Workspace {
  id:                     string
  name:                   string
  slug:                   string
  plan:                   string
  usage_count:            number
  usage_limit:            number
  credits_remaining:      number
  credits_monthly:        number
  storage_used_bytes:     number
  storage_limit_bytes:    number
  deletion_requested_at:  string | null
  scheduled_purge_at:     string | null
  brand_voice:            string | null
  industry:               string | null
  logo_url:               string | null
  brand_knowledge:        Record<string, unknown> | null
  stripe_customer_id:     string | null
  stripe_subscription_id: string | null
}

/** Test DB connectivity — used by /api/health */
export async function testConnection(): Promise<boolean> {
  try {
    const admin = createSupabaseAdmin()
    const { error } = await admin.from('workspaces').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}
