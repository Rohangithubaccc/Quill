import { NextRequest } from 'next/server'
import crypto          from 'crypto'
import { z }           from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { encrypt, jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'
import { WEBHOOK_EVENTS }                                     from '@/lib/webhooks'
import { assertSafeUrl, UnsafeUrlError }                      from '@/lib/url-safety'

// ── GET /api/webhooks — list all endpoints ───────────────────────────────────
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner','admin'].includes(role)) return jsonError('Owners and admins only', 403)

  const admin = createSupabaseAdmin()

  const [endpointsRes, deliveriesRes] = await Promise.all([
    admin.from('webhook_endpoints')
      .select('id, url, events, description, is_active, last_fired_at, consecutive_failures, last_failure_at, last_failure_reason, created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),

    // Last 10 deliveries per endpoint for the UI log
    admin.from('webhook_deliveries')
      .select('id, endpoint_id, event_type, status_code, success, duration_ms, fired_at')
      .eq('workspace_id', workspace.id)
      .order('fired_at', { ascending: false })
      .limit(50),
  ])

  // Mask secrets — never returned after creation
  const endpoints = (endpointsRes.data ?? []).map((ep: any) => ({
    ...ep,
    secret: '••••••••',
  }))

  return jsonOk({
    endpoints,
    recentDeliveries: deliveriesRes.data ?? [],
    supportedEvents:  WEBHOOK_EVENTS,
  })
}

// ── POST /api/webhooks — create endpoint ─────────────────────────────────────
const CreateSchema = z.object({
  url:         z.string().url('URL must be a valid HTTPS URL').refine(
    u => u.startsWith('https://'),
    'Webhook URL must use HTTPS',
  ),
  events:      z.array(z.enum(WEBHOOK_EVENTS as [string, ...string[]])).default([]),
  description: z.string().max(100).optional(),
})

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner','admin'].includes(role)) return jsonError('Owners and admins only', 403)

  let body: z.infer<typeof CreateSchema>
  try { body = CreateSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  // SSRF guard: reject URLs that resolve to internal/private/cloud-metadata
  // addresses. Zod's synchronous .refine() above only checks the scheme —
  // this needs a DNS lookup, so it's a separate async check. The
  // `http://localhost` allowance that used to live in the schema above is
  // intentionally gone: this server runs in production, where "localhost"
  // means the production host's own loopback interface, not a developer's
  // laptop. Test webhooks locally with a tunnel (e.g. ngrok) instead.
  try {
    await assertSafeUrl(body.url)
  } catch (e) {
    return jsonError(e instanceof UnsafeUrlError ? e.message : 'Invalid webhook URL', 400)
  }

  const admin = createSupabaseAdmin()

  // Enforce max 10 endpoints per workspace
  const { count } = await admin.from('webhook_endpoints')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace.id)

  if ((count ?? 0) >= 10) {
    return jsonError('Maximum 10 webhook endpoints per workspace. Delete an existing one to add more.', 400)
  }

  // Generate a 32-byte hex secret
  const plainSecret    = crypto.randomBytes(32).toString('hex')
  const encryptedSecret = await encrypt(plainSecret)

  const { data: endpoint, error: insertErr } = await admin
    .from('webhook_endpoints')
    .insert({
      workspace_id: workspace.id,
      url:          body.url,
      events:       body.events,
      description:  body.description ?? null,
      secret:       encryptedSecret,
      is_active:    true,
    })
    .select('id, url, events, description, is_active, created_at')
    .single()

  if (insertErr || !endpoint) {
    console.error('[webhooks/POST] Insert failed:', insertErr)
    return jsonError('Failed to create webhook endpoint', 500)
  }

  // Return plain secret ONCE — never returned again
  return new Response(
    JSON.stringify({
      endpoint: { ...endpoint, secret: '••••••••' },
      secret:   plainSecret,   // ← only time this is returned in plain
      warning:  'Copy this secret now — it will not be shown again. Use it to verify X-Quill-Signature headers.',
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  )
}

// ── PATCH /api/webhooks?id={endpointId} — update ─────────────────────────────
const PatchSchema = z.object({
  is_active:   z.boolean().optional(),
  events:      z.array(z.enum(WEBHOOK_EVENTS as [string, ...string[]])).optional(),
  description: z.string().max(100).nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner','admin'].includes(role)) return jsonError('Owners and admins only', 403)

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return jsonError('Endpoint ID required (?id=...)')

  let body: z.infer<typeof PatchSchema>
  try { body = PatchSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()
  const { error } = await admin.from('webhook_endpoints')
    .update(body)
    .eq('id', id)
    .eq('workspace_id', workspace.id)

  if (error) return dbError('webhooks', error, 'Update failed. Please try again.', 500)
  return jsonOk({ updated: true })
}

// ── DELETE /api/webhooks?id={endpointId} — delete ────────────────────────────
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (!['owner','admin'].includes(role)) return jsonError('Owners and admins only', 403)

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return jsonError('Endpoint ID required (?id=...)')

  const admin = createSupabaseAdmin()
  await admin.from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id)

  return jsonOk({ deleted: true })
}
