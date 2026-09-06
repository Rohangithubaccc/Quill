import { NextRequest } from 'next/server'
import { requireUser, requireWorkspace, createSupabaseAdmin } from '@/lib/supabase/server'
import { decrypt, workspaceCatch } from '@/lib/utils'
import { jsonError, jsonOk } from '@/lib/utils'

// GET /api/integrations/buffer/status
//
// Returns the current health of the Buffer integration for the workspace.
// Called by the Settings page on load to decide whether to show a
// "token expiring soon" warning banner and Reconnect button.
//
// Response shape:
// {
//   connected:    boolean
//   tokenExpired: boolean           // true if expiry is within 7 days
//   expiresAt:    string | null     // ISO timestamp, or null if unknown
//   profiles: {
//     id:      string
//     name:    string
//     service: string               // 'twitter', 'linkedin', etc.
//   }[]
// }

// Tokens expiring within this window are treated as "needs attention".
// 7 days gives the user time to reconnect before content scheduling breaks.
const WARNING_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

export async function GET(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  // ── Workspace ──────────────────────────────────────────────────────────
  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) { return workspaceCatch(e) }

  // ── Fetch integration record ───────────────────────────────────────────
  const admin = createSupabaseAdmin()

  const { data: integration } = await admin
    .from('integrations')
    .select('status, config, connected_at')
    .eq('workspace_id', workspace.id)
    .eq('provider', 'buffer')
    .single()

  // Not connected at all
  if (!integration || integration.status !== 'connected') {
    return jsonOk({
      connected:    false,
      tokenExpired: false,
      expiresAt:    null,
      profiles:     [],
    })
  }

  const config = integration.config as Record<string, unknown>

  // ── Determine token expiry ─────────────────────────────────────────────
  let expiresAt:    string | null = null
  let tokenExpired: boolean       = false

  if (config.encrypted_config) {
    // New format: decrypt the JSON blob and read expires_at
    try {
      const creds = JSON.parse(await decrypt(config.encrypted_config as string)) as {
        access_token:  string
        refresh_token: string
        expires_at:    number
        profiles:      string[]
      }

      if (creds.expires_at && creds.expires_at > 0) {
        expiresAt    = new Date(creds.expires_at).toISOString()
        // "Expired" means expiry is within the 7-day warning window
        tokenExpired = creds.expires_at < Date.now() + WARNING_THRESHOLD_MS
      }
    } catch (err) {
      // Decryption failure means credentials are corrupted → treat as expired
      console.error('[Buffer status] Failed to decrypt encrypted_config:', err)
      tokenExpired = true
    }
  } else if (config.encrypted_token) {
    // Legacy format: no expiry metadata available.
    // We don't know when this token was issued so we can't show an expiry time.
    // Mark as "not expired" by default — the user will see a 401 in practice
    // when the token expires and can reconnect then.
    expiresAt    = null
    tokenExpired = false
  } else {
    // Neither format — credentials are missing
    tokenExpired = true
  }

  // ── Build profile list ─────────────────────────────────────────────────
  // Profile metadata is stored unencrypted in config.profiles for display.
  type StoredProfile = { id: string; service: string; username: string }
  const storedProfiles = (config.profiles as StoredProfile[] | undefined) ?? []

  const profiles = storedProfiles.map((p) => ({
    id:      p.id,
    name:    p.username,
    service: p.service,
  }))

  return jsonOk({
    connected:    true,
    tokenExpired,
    expiresAt,
    profiles,
  })
}
