import { inngest } from './client'
import { countWords } from '@/lib/utils'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getAIClientForWorkspace } from '@/lib/ai-byok'
import { storageLimitMessage } from '@/lib/storage-quota'
import { OPERATION_CREDITS } from '@/lib/credits'

// ─────────────────────────────────────────────────────────────────────────────
// AI client resolution
// Server-side only — this file is never bundled for the browser. Each job
// resolves its own client via getAIClientForWorkspace() so BYOK
// workspaces run their async jobs (bulk repurpose, etc.) on their own
// provider and model too.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Helper: upsert a job_results row and return its id
// ─────────────────────────────────────────────────────────────────────────────

async function createJob(
  admin: ReturnType<typeof createSupabaseAdmin>,
  jobType: string,
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const { data, error } = await admin
    .from('job_results')
    .insert({
      job_type:     jobType,
      workspace_id: workspaceId,
      payload,
      status:       'running',
      result:       null,
    })
    .select('id')
    .single()

  if (error || !data?.id) throw new Error(`Failed to create job record: ${error?.message}`)
  return data.id
}

async function completeJob(
  admin: ReturnType<typeof createSupabaseAdmin>,
  jobId: string,
  result: unknown
): Promise<void> {
  await admin
    .from('job_results')
    .update({
      status:     'complete',
      result,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
}

async function failJob(
  admin: ReturnType<typeof createSupabaseAdmin>,
  jobId: string,
  errorMessage: string
): Promise<void> {
  await admin
    .from('job_results')
    .update({
      status:     'failed',
      error:      errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 1: Bulk Repurpose
//
// Event:   quill/content.repurpose.bulk
// Payload: { contentId, workspaceId, userId, repurposeTypes: string[] }
//
// Takes one source blog post and generates all selected repurpose variants
// (up to 5) sequentially. Each variant is saved as a new content_pieces row.
// A job_results row tracks overall progress so the client can poll.
//
// Why Inngest beats SSE for this:
//   - SSE requires the browser tab to stay open; Inngest runs server-side
//   - Each step.run() has its own retry budget (3 attempts by default)
//   - Inngest persists state between steps — a cold Vercel restart doesn't
//     lose partially-completed work
// ─────────────────────────────────────────────────────────────────────────────

export const bulkRepurpose = inngest.createFunction(
  {
    id:      'bulk-repurpose',
    name:    'Bulk Repurpose Content',
    // Retry failed steps up to 3 times with exponential back-off
    retries: 3,
  },
  { event: 'quill/content.repurpose.bulk' },
  async ({ event, step }) => {
    const { contentId, workspaceId, userId, repurposeTypes } = event.data as {
      contentId:      string
      workspaceId:    string
      userId:         string
      repurposeTypes: string[]
    }

    const admin = createSupabaseAdmin()

    // ── Step 1: Fetch source content ──────────────────────────────────────
    const source = await step.run('fetch-source', async () => {
      const { data, error } = await admin
        .from('content_pieces')
        .select('id, content, title, industry, content_type, tone, keyword')
        .eq('id', contentId)
        .eq('workspace_id', workspaceId)
        .single()

      if (error || !data) throw new Error(`Source content not found: ${error?.message}`)
      return data
    })

    if (!source?.content) throw new Error('Source content body is empty')

    // ── Step 2: Create job tracking row ──────────────────────────────────
    const jobId = await step.run('create-job', async () => {
      return createJob(admin, 'bulk_repurpose', workspaceId, {
        contentId,
        repurposeTypes,
        totalSteps: repurposeTypes.length,
      })
    })

    // ── Steps 3…N: One step per repurpose type ────────────────────────────
    // Using a named step per type means Inngest can retry individual
    // failures without re-running the ones that already succeeded.
    const results: Array<{ type: string; pieceId: string | null; error?: string }> = []

    for (const rType of repurposeTypes) {
      const result = await step.run(`repurpose-${rType}`, async () => {
        // Everything for this type — the Anthropic call AND the insert —
        // is inside one try/catch. Found during the ruthless review: the
        // insert failure below was already caught and turned into a
        // per-type error result so the loop keeps going, but the
        // Anthropic call right above it wasn't — an exhausted-retries
        // failure on type 3 of 5 threw uncaught, which halts the whole
        // function. Types 4-5 never even get attempted, complete-job
        // never runs, and the job sits stuck — despite the user having
        // paid credits for all 5 and types 1-2 having genuinely
        // succeeded. Same failure handling for both failure modes now.
        try {
          // Shared prompt builder — imported at runtime to avoid circular deps
          const { default: buildRepurposePromptFn } = await import('@/lib/repurpose-prompts')

          const prompt = buildRepurposePromptFn(rType, source.content, {
            industry:    source.industry    ?? 'General',
            contentType: source.content_type ?? 'Blog Post',
            tone:        source.tone        ?? 'Professional',
            keyword:     source.keyword     ?? '',
            title:       source.title       ?? 'Untitled',
          })

          // Call the resolved provider — not streamed because we're running server-side
          const { client: ai, model } = await getAIClientForWorkspace(workspaceId, 'inngest/bulk-repurpose')
          const msg = await ai.createCompletion({
            model,
            // 6000, not 2048 — same fix as the single-repurpose route
            // (same underlying prompt logic, just batched).
            maxTokens: 6000,
            messages:  [{ role: 'user', content: prompt }],
          })

          const text = msg.text
          if (!text) throw new Error(`Empty response from provider for repurpose type: ${rType}`)

          const wordCount = countWords(text)

          // Insert the new repurposed content piece
          const { data: piece, error: insertErr } = await admin
            .from('content_pieces')
            .insert({
              workspace_id:   workspaceId,
              created_by:     userId,
              parent_id:      contentId,   // FK to source — add to schema if not present
              repurpose_type: rType,
              content:        text,
              word_count:     wordCount,
              status:         'draft',
              title:          `${rType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${source.title}`,
              content_type:   rType,
              industry:       source.industry ?? null,
              tone:           source.tone     ?? null,
              keyword:        source.keyword  ?? null,
            })
            .select('id')
            .single()

          if (insertErr) {
            console.error(`[bulk-repurpose] Insert failed for ${rType}:`, insertErr)
            return { type: rType, pieceId: null as string | null, error: insertErr.message as string | undefined }
          }

          return { type: rType, pieceId: piece?.id ?? null, error: undefined as string | undefined }
        } catch (err) {
          // Anthropic call failed (rate limit, empty response, exhausted
          // Inngest's own per-step retries, etc.) — record it exactly
          // like an insert failure and let the loop continue rather than
          // throwing, which would abort every remaining type.
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[bulk-repurpose] Generation failed for ${rType}:`, message)
          return { type: rType, pieceId: null as string | null, error: message as string | undefined }
        }
      })

      results.push(result as { type: string; pieceId: string | null; error?: string })
    }

    // ── Refund credits for whatever didn't actually get produced ─────────
    // The workspace was charged CREDITS_PER_TYPE (5, OPERATION_CREDITS.repurpose
    // in lib/credits.ts) per requested type upfront, before this job ran
    // (bulk-repurpose/route.ts — "does not deduct credits" itself, by
    // design). If some types failed above, this is the first point where
    // that's actually known, so it's the right place to make it right —
    // matches the atomic pattern from migration 026/027, just via
    // add_credits() (migration 013) instead of a conditional check, since
    // this is strictly additive with no limit to respect.
    const failedCount = results.filter(r => r.error).length
    if (failedCount > 0) {
      await step.run('refund-failed-types', async () => {
        const refundAmount = failedCount * OPERATION_CREDITS.repurpose
        const { error: refundErr } = await admin.rpc('add_credits', {
          p_workspace_id: workspaceId,
          p_credits:      refundAmount,
        })
        if (refundErr) {
          // Don't fail the whole job over a refund bookkeeping error —
          // log loudly so it's findable, but the user's successfully
          // generated pieces (if any) still need to reach complete-job.
          console.error(`[bulk-repurpose] Refund of ${refundAmount} credits failed for workspace ${workspaceId}:`, refundErr.message)
        } else {
          console.log(`[bulk-repurpose] Refunded ${refundAmount} credits to workspace ${workspaceId} for ${failedCount} failed type(s)`)
        }
      })
    }

    // ── Final step: mark job complete ────────────────────────────────────
    await step.run('complete-job', async () => {
      await completeJob(admin, jobId, {
        pieces:       results,
        completedAt:  new Date().toISOString(),
      })
    })

    return { jobId, pieces: results }
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 4: Reliable Webhook Delivery (Fix 3)
//
// Event:   quill/webhook.deliver
// Payload: { endpointId, workspaceId, eventName, payload, encryptedSecret }
//
// Replaces the old fire-and-forget direct HTTP dispatch with Inngest-backed
// delivery that retries up to 5 times with exponential backoff.
//
// Retry schedule (automatic — Inngest handles this):
//   Attempt 1: immediate
//   Attempt 2: ~30 seconds
//   Attempt 3: ~2 minutes
//   Attempt 4: ~8 minutes
//   Attempt 5: ~25 minutes
//
// 4xx (non-429): permanent failure — don't retry (endpoint is rejecting us)
// 5xx or 429:    temporary failure — retry
// ─────────────────────────────────────────────────────────────────────────────

export const deliverWebhook = inngest.createFunction(
  {
    id:      'deliver-webhook',
    name:    'Deliver Webhook',
    retries: 5,
    // Surface persistent failures instead of the previous silent-forever
    // behavior — found during a ruthless adversarial pass that
    // last_fired_at only ever updated on success, so a broken endpoint
    // had zero visibility anywhere in the product. Mirrors the
    // onFailure pattern already established in asyncImageGeneration
    // below: the callback's `event` argument is a FAILURE WRAPPER, not
    // the original triggering event — the real payload is nested at
    // failureEvent.data.event.data.
    onFailure: async ({ event: failureEvent, error }) => {
      const originalData = failureEvent.data.event.data as { endpointId: string }
      const admin = createSupabaseAdmin()
      await Promise.resolve(
        admin.rpc('record_webhook_failure', {
          p_endpoint_id: originalData.endpointId,
          p_reason:      (error?.message ?? 'Unknown error').slice(0, 500),
        })
      ).catch(e => console.error('[deliver-webhook] Failure tracking update failed:', e))
    },
  },
  { event: 'quill/webhook.deliver' },
  async ({ event, step, attempt }) => {
    const {
      endpointId,
      workspaceId,
      eventName,
      payload,
      encryptedSecret,
    } = event.data as {
      endpointId:      string
      workspaceId:     string
      eventName:       string
      payload:         Record<string, unknown>
      encryptedSecret: string
    }

    const admin = createSupabaseAdmin()

    // ── Step 1: Verify endpoint still exists and is active ─────────────────
    const endpoint = await step.run('fetch-endpoint', async () => {
      const { data } = await admin
        .from('webhook_endpoints')
        .select('id, url, is_active')
        .eq('id', endpointId)
        .single()
      return data
    })

    // Silently succeed if endpoint was deleted or deactivated since event was queued
    if (!endpoint || !endpoint.is_active) {
      return { skipped: true, reason: 'endpoint_deleted_or_inactive' }
    }

    // ── Step 2: Deliver with signature ────────────────────────────────────
    const deliveryResult = await step.run('deliver', async () => {
      const { deliverToEndpoint } = await import('@/lib/webhooks')

      const payloadStr = JSON.stringify(payload)
      const start      = Date.now()

      let statusCode   = 0
      let responseBody = ''
      let success      = false

      try {
        const result = await deliverToEndpoint(
          endpoint.url,
          payloadStr,
          encryptedSecret,
          eventName,
          attempt + 1
        )
        statusCode   = result.statusCode
        responseBody = result.responseBody
        success      = result.success
      } catch (err: any) {
        responseBody = err.name === 'TimeoutError' || err.name === 'AbortError'
          ? 'Timed out after 15 seconds'
          : (err.message ?? 'Network error')
      }

      const durationMs = Date.now() - start

      // Log every attempt (including retries) to webhook_deliveries
      await Promise.resolve(admin.from('webhook_deliveries').insert({
        endpoint_id:   endpointId,
        workspace_id:  workspaceId,
        event_type:    eventName,
        payload,
        status_code:   statusCode || null,
        response_body: responseBody || null,
        success,
        duration_ms:   durationMs,
      })).catch(e => console.error('[webhook] Delivery log failed:', e.message))

      return { statusCode, responseBody, success, durationMs }
    })

    // ── Retry decision ─────────────────────────────────────────────────────
    // 4xx (except 429): permanent — don't retry (throw non-retriable error)
    // 429 or 5xx or network error: throw so Inngest retries
    if (!deliveryResult.success) {
      const code = deliveryResult.statusCode
      if (code >= 400 && code < 500 && code !== 429) {
        // Permanent failure — endpoint is rejecting us (wrong URL, auth error, etc.)
        // Return without throwing so Inngest marks as complete (not retried)
        console.error(
          `[webhook] Permanent failure for endpoint ${endpointId}: HTTP ${code}. ` +
          `Not retrying. Owner should check the endpoint URL and auth.`
        )
        return { success: false, permanent: true, statusCode: code }
      }
      // Temporary failure — throw so Inngest retries with backoff
      throw new Error(
        `Webhook delivery failed (attempt ${attempt + 1}): ` +
        `HTTP ${deliveryResult.statusCode || 'network_error'} — ${deliveryResult.responseBody}`
      )
    }

    // ── Step 3: Update last_fired_at on success ────────────────────────────
    await step.run('update-last-fired', async () => {
      // record_webhook_success also resets consecutive_failures to 0 —
      // a delivery succeeding means whatever was wrong is resolved, so
      // any lingering failure badge in the UI should clear immediately
      // rather than wait for a human to notice and dismiss it.
      await Promise.resolve(admin.rpc('record_webhook_success', { p_endpoint_id: endpointId }))
        .catch(e => console.error('[deliver-webhook] Success tracking update failed:', e))
    })

    return {
      success:    true,
      statusCode: deliveryResult.statusCode,
      durationMs: deliveryResult.durationMs,
      attempt:    attempt + 1,
    }
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION 5: Async Image Generation (Fix 8)
//
// Event:   quill/image.generate
// Payload: { contentId, workspaceId, userId, creditCost }
//
// Routes DALL-E 3 generation through Inngest to handle OpenAI's
// 7 images/minute rate limit at Tier 1. The concurrency: { limit: 5 }
// setting ensures no more than 5 simultaneous DALL-E calls globally,
// staying safely within the OpenAI limit with headroom for burst.
//
// Client flow:
//   POST /api/ai/image → { async: true, jobId }
//   poll GET /api/jobs/{jobId} every 3s → { status: 'complete', result: { imageUrl } }
// ─────────────────────────────────────────────────────────────────────────────

export const asyncImageGeneration = inngest.createFunction(
  {
    id:   'image-generation',
    name: 'AI Image Generation',
    retries: 3,
    // Refund credits if all retries fail
    onFailure: async ({ event: failureEvent, error }) => {
      // The onFailure callback's `event` argument is a FAILURE WRAPPER, not
      // the original triggering event. Verified against the real type in
      // inngest/types.d.ts:
      //   FailureEventPayload<P> = { name: ..., data: { function_id, run_id,
      //                                                  error, event: P } }
      // So the original triggering event's data is nested at:
      //   failureEvent.data.event.data
      const originalData = failureEvent.data.event.data as { workspaceId: string; creditCost: number; contentId?: string }
      const { workspaceId, creditCost } = originalData
      const admin = createSupabaseAdmin()

      // Atomic refund using the add_credits Postgres function.
      // Wrapped in Promise.resolve() — the query builder is a thenable,
      // not a real Promise, and has no .catch() of its own.
      await Promise.resolve(admin.rpc('add_credits', {
        p_workspace_id: workspaceId,
        p_credits:      creditCost,
      })).catch(e => console.error('[image-generation] Credit refund failed:', e))

      // Mark job as failed
      if (originalData.contentId) {
        await Promise.resolve(
          admin.from('job_results').update({
            status:     'failed',
            error:      error.message ?? 'Image generation failed after 3 attempts',
            updated_at: new Date().toISOString(),
          })
            .eq('workspace_id', workspaceId)
            .eq('job_type', 'image_generation')
            .eq('status', 'running')
        ).catch(e => console.error('[image-generation] Job failure update failed:', e))
      }
    },
    // Global concurrency limit: max 5 simultaneous DALL-E calls across ALL workspaces.
    // All image events share the 'dalle3-global' key → one shared 5-slot pool.
    // 5 concurrent × ~10s avg generation time = ~30 images/minute max throughput,
    // well within OpenAI Tier 1 (7 images/minute soft limit with burst allowance).
    concurrency: {
      limit: 5,
      key:   '"dalle3-global"',
    },
  },
  { event: 'quill/image.generate' },
  async ({ event, step }) => {
    const { contentId, workspaceId, userId, creditCost } = event.data as {
      contentId:   string
      workspaceId: string
      userId:      string
      creditCost:  number
    }

    const admin = createSupabaseAdmin()

    // ── Step 1: Create job_results row for client polling ──────────────────
    const jobId = await step.run('create-job', async () => {
      const { data, error } = await admin
        .from('job_results')
        .insert({
          job_type:     'image_generation',
          workspace_id: workspaceId,
          payload:      { contentId },
          status:       'running',
          result:       null,
        })
        .select('id')
        .single()
      if (error) throw new Error('Failed to create job: ' + error.message)
      return data!.id as string
    })

    // ── Step 2: Fetch content piece for prompt building ────────────────────
    const piece = await step.run('fetch-piece', async () => {
      const { data, error } = await admin
        .from('content_pieces')
        .select('id, title, industry, content_type')
        .eq('id', contentId)
        .eq('workspace_id', workspaceId)
        .single()
      if (error || !data) throw new Error('Content piece not found')
      return data
    })

    // ── Step 3: Call DALL-E 3 ─────────────────────────────────────────────
    // Inngest retries this step on 429 or network failures automatically.
    const { dalleUrl, imagePrompt } = await step.run('call-dalle', async () => {
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

      const INDUSTRY_VISUAL_HINTS: Record<string, string> = {
        'Tech & SaaS':   'clean minimal tech workspace, soft blue ambient lighting, modern laptops',
        'Healthcare':    'bright modern medical setting, white clinical environment, soft natural light',
        'Finance':       'professional glass office building, financial district, subtle data visualization',
        'E-commerce':    'modern product photography aesthetic, clean white background, lifestyle shot',
        'Marketing':     'vibrant creative agency office, color mood board, collaborative energy',
        'Education':     'bright modern learning space, open books, warm natural light',
        'Real Estate':   'contemporary architecture exterior, golden hour lighting',
        'Legal':         'modern law office, clean professional setting, leather and wood tones',
        'Food & Bev':    'warm restaurant ambiance, artisan food photography, soft bokeh background',
      }

      const visualHint  = INDUSTRY_VISUAL_HINTS[piece.industry ?? ''] ??
        'professional modern business setting, clean aesthetic, editorial quality'

      const prompt = [
        `Professional editorial header photograph for a ${piece.content_type ?? 'Blog Post'} titled: "${piece.title ?? 'Untitled'}".`,
        `Visual context: ${visualHint}.`,
        `Style: wide-format 16:9 editorial photography, cinematic composition, shallow depth of field, soft natural lighting.`,
        `IMPORTANT: absolutely no text, letters, words, typography, or writing anywhere in the image. No faces. No logos.`,
      ].join(' ')

      const response = await openai.images.generate({
        model:           'dall-e-3',
        prompt,
        size:            '1792x1024',
        quality:         'standard',
        response_format: 'url',
        n:               1,
      })

      // response.data is typed as optional (data?: Array<Image>) in the
      // installed openai SDK's ImagesResponse interface.
      const url = response.data?.[0]?.url ?? ''
      if (!url) throw new Error('DALL-E returned empty URL')
      return { dalleUrl: url, imagePrompt: prompt }
    })

    // ── Step 4: Download + upload to Supabase Storage ─────────────────────
    // DALL-E URLs expire in ~1 hour — must re-upload immediately.
    const publicUrl = await step.run('upload-to-storage', async () => {
      const downloadRes = await fetch(dalleUrl, { signal: AbortSignal.timeout(20_000) })
      if (!downloadRes.ok) throw new Error(`DALL-E download failed: HTTP ${downloadRes.status}`)

      const buffer      = Buffer.from(await downloadRes.arrayBuffer())
      const storagePath = `images/${workspaceId}/${contentId}-${Date.now()}.png`

      // Reserve quota BEFORE touching Storage — same atomic function as
      // the DAM/KB upload routes (migration 027_storage_quota.sql). The
      // real byte size is only known post-download here (unlike a direct
      // file upload where file.size is known upfront), but that's still
      // before the Storage write, which is what matters.
      const { data: reserveResult } = await admin.rpc('reserve_storage', {
        p_workspace_id: workspaceId,
        p_bytes:        buffer.length,
      })
      const reserve = reserveResult?.[0]
      if (!reserve?.success) {
        throw new Error(storageLimitMessage(reserve?.new_used_bytes ?? 0, reserve?.limit_bytes ?? 0))
      }

      const { error: uploadErr } = await admin.storage
        .from('brand-assets')
        .upload(storagePath, buffer, {
          contentType:  'image/png',
          cacheControl: '31536000',
          upsert:       false,
        })
      if (uploadErr) {
        await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspaceId, p_bytes: buffer.length })).catch(() => {})
        throw new Error('Storage upload failed: ' + uploadErr.message)
      }

      const { data: urlData } = admin.storage
        .from('brand-assets')
        .getPublicUrl(storagePath)

      return urlData.publicUrl
    })

    // ── Step 5: Persist + complete job (parallel) ─────────────────────────
    await step.run('finalize', async () => {
      await Promise.all([
        // Save image URL on the content piece
        admin.from('content_pieces').update({
          header_image_url:    publicUrl,
          header_image_prompt: imagePrompt,
        }).eq('id', contentId),

        // Mark job complete so polling client sees the result
        admin.from('job_results').update({
          status:     'complete',
          result:     { imageUrl: publicUrl, contentId },
          updated_at: new Date().toISOString(),
        }).eq('id', jobId),
      ])
    })

    return { jobId, imageUrl: publicUrl, contentId }
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Base document processing
// Extracts text → chunks → embeds → stores. Triggered by
// POST /api/knowledge-base/upload immediately after the raw file lands in
// Supabase Storage. Runs async because PDF parsing + embedding a
// multi-page document can comfortably exceed a serverless function's
// request timeout.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CHUNKS_PER_DOCUMENT = 300
// Caps cost/latency/payload-size for pathological uploads (e.g. someone
// uploading a 1000-page book). ~300 chunks × ~800 words is roughly a
// 200,000-word document — generous for brand guides, product docs, and
// whitepapers, the intended use case.

export const processKnowledgeDocument = inngest.createFunction(
  {
    id:      'process-knowledge-document',
    name:    'Process Knowledge Base Document',
    retries: 2,
    onFailure: async ({ event: failureEvent, error }) => {
      // Same FailureEventPayload shape as asyncImageGeneration above — the
      // original event's data is nested at failureEvent.data.event.data.
      const { documentId } = failureEvent.data.event.data as { documentId: string }
      const admin = createSupabaseAdmin()
      await Promise.resolve(
        admin.from('knowledge_documents').update({
          status:        'failed',
          error_message: (error.message ?? 'Processing failed').slice(0, 500),
        }).eq('id', documentId),
      ).catch(e => console.error('[knowledge-base] failure-state update failed:', e))
    },
  },
  { event: 'quill/knowledge.document.process' },
  async ({ event, step }) => {
    const { documentId, workspaceId, storagePath, fileType } = event.data as {
      documentId:   string
      workspaceId:  string
      storagePath:  string
      fileType:     'pdf' | 'docx' | 'txt'
    }

    const admin = createSupabaseAdmin()

    // ── Step 1: download + extract text in one step ────────────────────────
    // Deliberately NOT split into separate "download" and "extract" steps:
    // Inngest persists each step's return value as JSON between steps, and
    // a raw file Buffer doesn't belong in that state — only the extracted
    // text (a string) does.
    const text = await step.run('download-and-extract', async () => {
      const { extractText } = await import('@/lib/knowledge-base')
      const { scanForMalware } = await import('@/lib/malware-scan')
      const { data, error } = await admin.storage.from('knowledge-base').download(storagePath)
      if (error || !data) throw new Error('Failed to download file: ' + (error?.message ?? 'not found'))
      const buffer = Buffer.from(await data.arrayBuffer())

      // Scan BEFORE parsing — no reason to run a potentially-malicious
      // file through the PDF/DOCX parser if VirusTotal already knows it's
      // bad. Skipped gracefully if VIRUSTOTAL_API_KEY isn't configured;
      // fails the document (not the whole job) on an actual detection.
      const scan = await scanForMalware(buffer, storagePath)
      await admin.from('knowledge_documents').update({
        scan_status: scan.scanned ? (scan.clean ? 'clean' : 'flagged') : 'skipped',
        scan_detail: scan.detail ?? null,
      }).eq('id', documentId)

      if (scan.scanned && !scan.clean) {
        throw new Error(scan.detail ?? 'This file was flagged by malware scanning and was not processed.')
      }

      const extracted = await extractText(buffer, fileType)
      if (!extracted.trim()) throw new Error('No extractable text found in this file')
      return extracted
    })

    // ── Step 1b: scan for common prompt-injection patterns ──────────────────
    // Flags, never blocks — see src/lib/prompt-injection.ts for why. This
    // content will be retrieved and injected into generation prompts
    // automatically later with no human in the loop at that moment, so
    // surfacing it now, at upload time, is the point where a human can
    // actually see and act on it.
    await step.run('scan-for-injection', async () => {
      const { scanForInjectionPatterns } = await import('@/lib/prompt-injection')
      const result = scanForInjectionPatterns(text)
      if (result.flagged) {
        await admin.from('knowledge_documents').update({
          flagged_content: true,
          flagged_reasons: result.matches,
        }).eq('id', documentId)
      }
    })

    // ── Step 2: chunk + embed ───────────────────────────────────────────────
    const chunks = await step.run('chunk-and-embed', async () => {
      const { chunkText, embedTexts } = await import('@/lib/knowledge-base')
      const rawChunks = chunkText(text).slice(0, MAX_CHUNKS_PER_DOCUMENT)
      const embeddings = await embedTexts(rawChunks)
      return rawChunks.map((content, i) => ({ content, embedding: embeddings[i] }))
    })

    // ── Step 3: store chunks + mark document ready ──────────────────────────
    await step.run('store-chunks', async () => {
      if (chunks.length > 0) {
        const { error: insertErr } = await admin.from('knowledge_chunks').insert(
          chunks.map((c, i) => ({
            document_id:  documentId,
            workspace_id: workspaceId,
            chunk_index:  i,
            content:      c.content,
            embedding:    c.embedding,
          })),
        )
        if (insertErr) throw new Error('Failed to store chunks: ' + insertErr.message)
      }

      await admin.from('knowledge_documents').update({
        status:      'ready',
        chunk_count: chunks.length,
      }).eq('id', documentId)
    })

    return { documentId, chunkCount: chunks.length }
  },
)
