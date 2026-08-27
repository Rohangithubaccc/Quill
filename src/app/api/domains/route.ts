import { NextRequest } from 'next/server'
import { z }           from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

const VERCEL_API = 'https://api.vercel.com'
function vercelHeaders() {
  return { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`, 'Content-Type': 'application/json' }
}

const DomainSchema = z.object({
  domain: z.string()
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/, 'Must be a valid domain name (e.g. content.youragency.com)')
    .refine(d => !d.endsWith(process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'quill.ai'), 'Cannot register a Quill.AI subdomain'),
})

// POST /api/domains — register custom domain (Agency plan only)
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (role !== 'owner') return jsonError('Only workspace owners can configure custom domains', 403)
  if (workspace.plan !== 'agency') return jsonError('Custom domains are available on the Agency plan only. Upgrade at Settings → Billing.', 403)
  if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) return jsonError('Domain configuration not set up — contact support', 503)

  let body: z.infer<typeof DomainSchema>
  try { body = DomainSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()
  const { data: existing } = await admin.from('domains').select('domain').eq('workspace_id', workspace.id).single()
  if (existing) return jsonError(`Workspace already has domain (${existing.domain}). Delete it first.`, 409)

  // Register with Vercel
  const vercelRes  = await fetch(`${VERCEL_API}/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains`, {
    method: 'POST', headers: vercelHeaders(), body: JSON.stringify({ name: body.domain }),
  })
  const vercelData = await vercelRes.json()
  if (!vercelRes.ok) {
    console.error('[domains] Vercel error:', vercelData)
    if (vercelData.error?.code === 'domain_already_in_use') return jsonError('Domain already registered in Vercel — contact support if you own it.', 409)
    return jsonError('Failed to register domain: ' + (vercelData.error?.message ?? 'unknown'), 500)
  }

  const txtRecord  = (vercelData.verification ?? []).find((v: any) => v.type === 'TXT')
  const verificationTxt    = txtRecord?.value    ?? null
  const verificationDomain = txtRecord?.domain   ?? `_vercel.${body.domain}`

  const { error: insertErr } = await admin.from('domains').insert({
    workspace_id: workspace.id, domain: body.domain, status: 'pending',
    vercel_domain_id: vercelData.name ?? body.domain, verification_txt: verificationTxt,
  })
  if (insertErr) return jsonError('Domain registered but DB save failed — contact support', 500)

  return new Response(JSON.stringify({
    domain: body.domain, status: 'pending', verificationTxt, verificationDomain,
    instructions: [
      `Add a TXT record to your DNS:`,
      `  Name: ${verificationDomain}`,
      `  Value: ${verificationTxt ?? '(see Vercel dashboard)'}`,
      `Then click "Verify DNS" in settings. SSL is auto-provisioned (5–30 mins).`,
    ],
  }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}

// GET /api/domains — fetch current domain
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const admin  = createSupabaseAdmin()

  const { data: domainRow } = await admin.from('domains')
    .select('id, domain, status, verification_txt, error_message, created_at')
    .eq('workspace_id', workspace.id).single()

  if (!domainRow) return jsonOk({ domain: null })

  // Verify action: check with Vercel if DNS is configured
  if (action === 'verify' && process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) {
    const checkRes = await fetch(
      `${VERCEL_API}/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domainRow.domain)}`,
      { headers: vercelHeaders() }
    )
    if (checkRes.ok) {
      const checkData = await checkRes.json()
      // No 'verification' field = domain is verified
      const isVerified = !checkData.verification || checkData.verification.length === 0
      const newStatus  = isVerified ? 'active' : 'pending'

      if (newStatus !== domainRow.status) {
        await admin.from('domains').update({ status: newStatus }).eq('id', domainRow.id)
      }
      return jsonOk({ domain: { ...domainRow, status: newStatus }, verified: isVerified })
    }
  }

  return jsonOk({ domain: domainRow })
}

// DELETE /api/domains — remove custom domain
export async function DELETE(_req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (role !== 'owner') return jsonError('Only workspace owners can remove custom domains', 403)

  const admin = createSupabaseAdmin()
  const { data: domainRow } = await admin.from('domains').select('id, domain').eq('workspace_id', workspace.id).single()
  if (!domainRow) return jsonOk({ deleted: true, alreadyGone: true })

  if (process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) {
    await fetch(`${VERCEL_API}/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${encodeURIComponent(domainRow.domain)}`,
      { method: 'DELETE', headers: vercelHeaders() }
    ).catch(e => console.warn('[domains/DELETE] Vercel removal failed:', e))
  }

  await admin.from('domains').delete().eq('id', domainRow.id)
  return jsonOk({ deleted: true, domain: domainRow.domain })
}
