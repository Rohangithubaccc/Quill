/**
 * src/lib/buffer.ts
 *
 * Buffer API client with automatic token refresh.
 *
 * Buffer access tokens expire after ~60 days. This module handles:
 *   1. Retrieving and decrypting stored credentials from Supabase
 *   2. Proactively refreshing tokens that are within 5 minutes of expiry
 *   3. Reactively refreshing on 401 responses (one retry per request)
 *   4. Surfacing a user-friendly BufferAuthError when refresh fails, so
 *      callers can redirect the user to Settings → reconnect.
 *
 * All Buffer API calls in this app should go through bufferFetch() rather
 * than calling fetch() directly, so token refresh is handled transparently.
 */

import { createSupabaseAdmin } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────

export interface BufferCredentials {
  access_token:  string
  refresh_token: string
  expires_at:    number    // Unix timestamp in milliseconds
  profiles:      string[]  // Buffer profile IDs
}

/**
 * Thrown when:
 *   a) A 401 response is received and the token refresh also fails, or
 *   b) No Buffer integration exists for the workspace.
 *
 * The UI layer should catch this and show a banner linking to /settings.
 */
export class BufferAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BufferAuthError'
  }
}

// ── Token expiry threshold ────────────────────────────────────────────────
// If a token expires within this many milliseconds we proactively refresh
// before making any API call, rather than waiting for a 401.
const PROACTIVE_REFRESH_THRESHOLD_MS = 5 * 60 * 1000  // 5 minutes

// Buffer tokens last ~60 days = 5_184_000 seconds
const DEFAULT_EXPIRES_IN_SECONDS = 5_184_000

// ── getBufferCredentials ──────────────────────────────────────────────────

/**
 * Fetches the Buffer integration record for a workspace from Supabase,
 * decrypts the stored config, and returns the credentials.
 *
 * Handles both storage formats:
 *   - New format: config.encrypted_config (JSON blob with refresh_token)
 *   - Legacy format: config.encrypted_token (single access_token string)
 *
 * Throws BufferAuthError if no connected integration is found.
 */
export async function getBufferCredentials(workspaceId: string): Promise<BufferCredentials> {
  const admin = createSupabaseAdmin()

  const { data: integration, error } = await admin
    .from('integrations')
    .select('config, status')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'buffer')
    .single()

  if (error || !integration || integration.status !== 'connected') {
    throw new BufferAuthError(
      'Buffer is not connected. Please connect it in Settings → Integrations.'
    )
  }

  const config = integration.config as Record<string, unknown>

  if (config.encrypted_config) {
    // ── New format ───────────────────────────────────────────────────────
    // Decrypt the JSON blob that contains access_token, refresh_token,
    // expires_at, and profiles.
    try {
      const decrypted = await decrypt(config.encrypted_config as string)
      const creds     = JSON.parse(decrypted) as BufferCredentials

      // Validate the blob has the fields we need
      if (!creds.access_token || !creds.refresh_token) {
        throw new Error('Incomplete credentials in encrypted_config')
      }

      return creds
    } catch (parseErr) {
      console.error('[Buffer] Failed to decrypt/parse encrypted_config:', parseErr)
      throw new BufferAuthError(
        'Your Buffer connection has expired. Please reconnect in Settings.'
      )
    }
  }

  if (config.encrypted_token) {
    // ── Legacy format ────────────────────────────────────────────────────
    // Accounts connected before the refresh_token migration only have an
    // access_token. We can still call the API but cannot auto-refresh.
    // expires_at defaults to 0 so the token is always considered "unknown".
    const accessToken = await decrypt(config.encrypted_token as string)
    const rawProfiles = (config.profiles as Array<{ id: string }> | undefined) ?? []
    return {
      access_token:  accessToken,
      refresh_token: '',          // not available for legacy accounts
      expires_at:    0,           // unknown — we'll discover expiry on 401
      profiles:      rawProfiles.map((p) => p.id),
    }
  }

  throw new BufferAuthError(
    'Buffer credentials are missing or corrupted. Please reconnect in Settings.'
  )
}

// ── refreshBufferToken ────────────────────────────────────────────────────

/**
 * Exchanges a refresh_token for a new access_token via Buffer's OAuth2
 * endpoint, then persists the updated credentials to Supabase.
 *
 * Returns the new access_token on success.
 * Throws BufferAuthError if the refresh request fails (the user must
 * reconnect via the OAuth flow).
 */
export async function refreshBufferToken(
  workspaceId:  string,
  refreshToken: string
): Promise<string> {
  if (!refreshToken) {
    throw new BufferAuthError(
      'Your Buffer connection has expired. Please reconnect in Settings.'
    )
  }

  const res = await fetch('https://api.bufferapp.com/1/oauth2/token.json', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     process.env.BUFFER_CLIENT_ID!,
      client_secret: process.env.BUFFER_CLIENT_SECRET!,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[Buffer] Token refresh failed:', res.status, errText)
    throw new BufferAuthError(
      'Your Buffer connection has expired. Please reconnect in Settings.'
    )
  }

  const tokens = await res.json() as {
    access_token:  string
    refresh_token?: string
    expires_in?:   number
  }

  if (!tokens.access_token) {
    throw new BufferAuthError(
      'Your Buffer connection has expired. Please reconnect in Settings.'
    )
  }

  // Buffer may or may not rotate the refresh_token — keep the existing one
  // if a new one wasn't issued.
  const newRefreshToken = tokens.refresh_token ?? refreshToken
  const newExpiresAt    = Date.now() + (tokens.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000

  // Persist the updated credentials to Supabase so the next request uses
  // the new access_token without hitting the refresh endpoint again.
  const admin = createSupabaseAdmin()

  // Fetch the current config to merge non-token fields (profiles, etc.)
  const { data: current } = await admin
    .from('integrations')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'buffer')
    .single()

  const existingConfig = (current?.config as Record<string, unknown>) ?? {}

  // Decrypt the current encrypted_config to get profiles before re-encrypting
  let profiles: string[] = []
  try {
    if (existingConfig.encrypted_config) {
      const oldCreds = JSON.parse(await decrypt(existingConfig.encrypted_config as string)) as BufferCredentials
      profiles = oldCreds.profiles ?? []
    }
  } catch { /* if decrypt fails, profiles stay empty */ }

  const newEncryptedConfig = await encrypt(JSON.stringify({
    access_token:  tokens.access_token,
    refresh_token: newRefreshToken,
    token_type:    'Bearer',
    expires_at:    newExpiresAt,
    profiles,
  }))

  await admin
    .from('integrations')
    .update({
      config: {
        ...existingConfig,
        encrypted_config: newEncryptedConfig,
      },
    })
    .eq('workspace_id', workspaceId)
    .eq('provider', 'buffer')

  console.log(`[Buffer] Token refreshed for workspace ${workspaceId}, expires ${new Date(newExpiresAt).toISOString()}`)

  return tokens.access_token
}

// ── bufferFetch ───────────────────────────────────────────────────────────

/**
 * Makes an authenticated request to the Buffer API with automatic token
 * refresh. Drop-in replacement for fetch() for all Buffer API endpoints.
 *
 * Flow:
 *   1. Load credentials from Supabase (getBufferCredentials)
 *   2. If token expires within 5 minutes, refresh proactively
 *   3. Make the request with Authorization: Bearer {access_token}
 *   4. If response is 401, attempt one refresh then retry the request
 *   5. If retry also returns 401, throw BufferAuthError
 *   6. For all other non-ok responses, throw with Buffer's error message
 *
 * @param workspaceId  The workspace whose Buffer credentials to use
 * @param path         Buffer API path, e.g. '/1/updates/create.json'
 * @param options      Standard RequestInit (method, body, etc.) — do NOT
 *                     include an Authorization header; this function adds it
 */
export async function bufferFetch(
  workspaceId: string,
  path:        string,
  options:     RequestInit = {}
): Promise<Response> {
  const BASE_URL = 'https://api.bufferapp.com'

  // ── Step 1: Load credentials ───────────────────────────────────────────
  let creds = await getBufferCredentials(workspaceId)

  // ── Step 2: Proactive refresh ──────────────────────────────────────────
  // If expires_at is known (non-zero) and the token is within the threshold,
  // refresh now to avoid a 401 mid-request.
  if (creds.expires_at > 0 && creds.expires_at < Date.now() + PROACTIVE_REFRESH_THRESHOLD_MS) {
    console.log(`[Buffer] Proactively refreshing token for workspace ${workspaceId}`)
    const newToken = await refreshBufferToken(workspaceId, creds.refresh_token)
    creds = { ...creds, access_token: newToken }
  }

  // ── Step 3: Make the request ───────────────────────────────────────────
  const makeRequest = (accessToken: string): Promise<Response> =>
    fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    })

  let response = await makeRequest(creds.access_token)

  // ── Step 4: Reactive refresh on 401 ───────────────────────────────────
  if (response.status === 401) {
    console.log(`[Buffer] 401 received for workspace ${workspaceId} — attempting token refresh`)

    let newAccessToken: string
    try {
      newAccessToken = await refreshBufferToken(workspaceId, creds.refresh_token)
    } catch (refreshErr) {
      // Refresh failed — the user must reconnect
      throw new BufferAuthError(
        'Your Buffer connection has expired. Please reconnect in Settings.'
      )
    }

    // ── Step 5: Retry once with the new token ────────────────────────────
    response = await makeRequest(newAccessToken)

    if (response.status === 401) {
      throw new BufferAuthError(
        'Your Buffer connection has expired. Please reconnect in Settings.'
      )
    }
  }

  // ── Step 6: Surface Buffer error messages ──────────────────────────────
  if (!response.ok) {
    let message = `Buffer API error: HTTP ${response.status}`
    try {
      const errBody = await response.clone().json() as { message?: string; error?: string }
      message = errBody.message ?? errBody.error ?? message
    } catch { /* keep default message if body isn't JSON */ }
    throw new Error(message)
  }

  return response
}
