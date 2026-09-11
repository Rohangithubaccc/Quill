import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/integrations/[provider]
//
// Disconnects any OAuth or credential-based integration.
// Deletes the row from the integrations table (all encrypted credentials
// are stored in that row, so deletion is a complete wipe).
//
// Supported providers: buffer | linkedin | gsc | wordpress
//
// Permission: any active workspace member can disconnect an integration.
// If you want to restrict to owners/admins only, add a role check below.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_PROVIDERS = new Set([
  'buffer',
  'linkedin',
  'gsc',
  'wordpress',
  'hubspot',
  'mailchimp',
  'hootsuite',
  // 'medium' intentionally removed — found during a ruthless pass that it
  // had no actual connect/callback route behind it anywhere in the app
  // (only 'Medium' as a content *type* option in the generator, an
  // unrelated feature). It was dead weight in this allowlist: harmless
  // since nothing ever created a row with this provider value, but
  // misleading — implies a supported integration that was never built.
])

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params

  // ── Validate provider ──────────────────────────────────────────────────────
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return jsonError(`Unknown provider: ${provider}`, 400)
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  let role: string
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
    role      = result.role ?? 'member'
  } catch (e) {
    return workspaceCatch(e)
  }

  // ── Permission: owners and admins only ─────────────────────────────────────
  // Integrations are workspace-level resources. Restricting disconnect to
  // admins/owners prevents an editor from accidentally breaking publishing
  // workflows for the whole team.
  if (!['owner', 'admin'].includes(role)) {
    return jsonError('Only workspace owners and admins can disconnect integrations', 403)
  }

  const admin = createSupabaseAdmin()

  // ── Verify integration exists ──────────────────────────────────────────────
  const { data: existing, error: fetchErr } = await admin
    .from('integrations')
    .select('id, status')
    .eq('workspace_id', workspace.id)
    .eq('provider', provider)
    .single()

  if (fetchErr || !existing) {
    // Idempotent — treat "already gone" as success
    return jsonOk({ disconnected: true, provider, alreadyGone: true })
  }

  // ── Delete the row (wipes all encrypted credentials) ──────────────────────
  const { error: deleteErr } = await admin
    .from('integrations')
    .delete()
    .eq('workspace_id', workspace.id)
    .eq('provider', provider)

  if (deleteErr) {
    console.error(`[integrations/disconnect] Delete failed for ${provider}:`, deleteErr)
    return jsonError('Failed to disconnect integration — please try again', 500)
  }

  // ── Provider-specific cleanup ──────────────────────────────────────────────
  // Buffer: no server-side token revocation needed (tokens expire naturally).
  // LinkedIn: no revocation endpoint for w_member_social tokens.
  // GSC: could call accounts.google.com/o/oauth2/revoke but not required.
  // WordPress: credentials are just a username/password; deleting row is enough.

  console.log(
    `[integrations/disconnect] ${provider} disconnected for workspace ${workspace.id} by user ${user.id} (${role})`
  )

  return jsonOk({ disconnected: true, provider })
}
