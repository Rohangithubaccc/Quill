import crypto             from 'crypto'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { decrypt }         from '@/lib/utils'
import { safeFetch } from '@/lib/url-safety'

// ─────────────────────────────────────────────────────────────────────────────
// Webhook dispatcher — Inngest-backed for reliable delivery with retries
//
// Architecture:
//   dispatchWebhook() → sends quill/webhook.deliver event to Inngest →
//   deliverWebhook Inngest function → HTTP POST to endpoint (3 retries)
//
// Public API is identical to the previous version. Callers don't change.
// Only the internals changed: direct HTTP → Inngest event → retried delivery.
//
// Retry schedule (Inngest exponential backoff):
//   Attempt 1: immediate
//   Attempt 2: ~30 seconds after failure
//   Attempt 3: ~2 minutes after failure
//   Attempt 4: ~8 minutes after failure
//   Attempt 5: ~25 minutes after failure
// ─────────────────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'content.generated'
  | 'content.approved'
  | 'content.rejected'
  | 'content.stage_advanced'
  | 'content.published'
  | 'usage.limit_warning'

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'content.generated',
  'content.approved',
  'content.rejected',
  'content.stage_advanced',
  'content.published',
  'usage.limit_warning',
]

export interface WebhookPayload {
  event:        WebhookEvent
  workspace_id: string
  timestamp:    string
  data:         Record<string, unknown>
  api_version:  '2025-01'
}

// ── Public entry point — always fire-and-forget, never throws ─────────────────
export function dispatchWebhook(
  workspaceId: string,
  event:       WebhookEvent,
  data:        Record<string, unknown>
): void {
  _dispatch(workspaceId, event, data).catch(err =>
    console.error('[webhook] dispatch error (non-fatal):', err)
  )
}

async function _dispatch(
  workspaceId: string,
  event:       WebhookEvent,
  data:        Record<string, unknown>
): Promise<void> {
  const admin = createSupabaseAdmin()

  // Fetch active endpoints subscribed to this event
  const { data: endpoints, error } = await admin
    .from('webhook_endpoints')
    .select('id, url, events, secret')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)

  if (error) {
    console.error('[webhook] Failed to fetch endpoints:', error.message)
    return
  }
  if (!endpoints?.length) return

  const matching = endpoints.filter(ep =>
    !ep.events?.length || (ep.events as string[]).includes(event)
  )
  if (!matching.length) return

  const payload: WebhookPayload = {
    event,
    workspace_id: workspaceId,
    timestamp:    new Date().toISOString(),
    data,
    api_version:  '2025-01',
  }

  // Import Inngest client dynamically to avoid circular deps
  const { inngest } = await import('@/inngest/client')

  // Send one Inngest event per matching endpoint.
  // Inngest handles retries, concurrency, and delivery logging.
  await Promise.allSettled(
    matching.map(ep =>
      inngest.send({
        name: 'quill/webhook.deliver',
        data: {
          endpointId:      ep.id,
          workspaceId,
          eventName:       event,
          payload,
          encryptedSecret: ep.secret,   // decrypted inside the Inngest function
        },
      })
    )
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct delivery helper — used by the Inngest function (not by callers).
// Exported so the Inngest function can import it without duplicating logic.
// ─────────────────────────────────────────────────────────────────────────────

export async function deliverToEndpoint(
  url:             string,
  payloadStr:      string,
  encryptedSecret: string,
  event:           string,
  attemptNumber:   number
): Promise<{ statusCode: number; responseBody: string; success: boolean }> {
  const secret    = await decrypt(encryptedSecret)
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('hex')

  // safeFetch re-validates on every redirect hop, not just this initial
  // URL — see the comment on it in lib/url-safety.ts for why that
  // distinction is the actual fix, not just belt-and-suspenders.
  const res = await safeFetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'X-Quill-Signature': `sha256=${signature}`,
      'X-Quill-Event':     event,
      'X-Quill-Version':   '2025-01',
      'X-Quill-Attempt':   String(attemptNumber),
      'User-Agent':        'Quill.AI-Webhooks/1.0',
    },
    body:   payloadStr,
    signal: AbortSignal.timeout(15_000),
  })

  const statusCode   = res.status
  const responseBody = (await res.text()).substring(0, 500)
  const success      = statusCode >= 200 && statusCode < 300

  return { statusCode, responseBody, success }
}
