import { NextRequest } from 'next/server'
import { z } from 'zod'
import { buildPrompt, countWords } from '@/lib/utils'
import { getAnthropicClientForWorkspace } from '@/lib/anthropic-byok'
import { getLimiter, checkLimit } from '@/lib/rate-limit'

// Per-IP limiter: 1 demo per IP per 24 hours
const ipLimiter = getLimiter('rl:demo:ip', 1, '24 h')

// Global limiter: 50 demos per clock hour across all IPs.
// The key is time-bucketed (see getHourBucket) so each clock hour gets
// a fresh 50-slot window rather than sharing one static sliding window.
const globalLimiter = getLimiter('rl:demo:global', 50, '1 h')

// ── Schema ────────────────────────────────────────────────────────────────
// honeypot field: bots fill every field; real browsers leave this empty.
// max(0) means any non-empty value is caught and we stream fake content
// back to waste the bot's time without burning Anthropic credits.
const DemoSchema = z.object({
  industry:    z.string().min(1).max(100),
  contentType: z.string().min(1).max(100),
  tone:        z.string().min(1).max(50),
  keyword:     z.string().max(100).default(''),
  wordCount:   z.number().int().min(100).max(600),
  honeypot:    z.string().max(0).optional(),
})

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract the real client IP.
 *
 * Order matters here and got it backwards originally: this checked
 * cf-connecting-ip first, but Vercel doesn't recognize or strip that
 * header (it's Cloudflare's, and this app isn't deployed behind
 * Cloudflare — confirmed against Vercel's own docs, which document
 * x-forwarded-for and x-vercel-forwarded-for specifically as the ones
 * Vercel's edge overwrites to prevent spoofing). A client could set an
 * arbitrary cf-connecting-ip value and it passed through untouched,
 * defeating the whole per-IP limit below. x-forwarded-for goes first now
 * — same header the shared getClientIp() in lib/rate-limit.ts already
 * uses correctly; this route just had its own separate, differently-
 * ordered copy.
 */
function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-vercel-forwarded-for')               ??  // Vercel's own equivalent, same guarantee
    req.headers.get('cf-connecting-ip')                     ??  // only meaningful if actually behind Cloudflare
    req.headers.get('x-real-ip')                            ??
    'unknown'
  )
}

/**
 * Returns a UTC hour bucket string such as "2026-3-11-14".
 * Used as part of the global rate-limit key so each calendar hour gets its
 * own 50-slot bucket. Without this, Upstash's sliding window shares one
 * static key across all time, so busy-hour slots bleed into the next hour
 * and the limit never truly resets.
 */
function getHourBucket(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`
}

// ── POST handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {

  // ── 1. Request size guard ──────────────────────────────────────────────
  // Reject oversized payloads before reading the body. 2 KB is more than
  // enough for the five demo fields; anything larger is abnormal.
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > 2048) {
    return new Response(
      JSON.stringify({ error: 'request_too_large' }),
      { status: 413, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 2. Origin validation ───────────────────────────────────────────────
  // Accept requests that originate from our own domain, or requests with
  // no Origin header (direct curl/server-to-server in dev). Reject
  // cross-origin requests so scripts running from other domains cannot
  // silently exhaust the global 50/hr slot.
  //
  // If NEXT_PUBLIC_URL is not set we skip validation entirely (fail open)
  // so local dev without the env var continues to work. Production must
  // always configure NEXT_PUBLIC_URL.
  const origin  = req.headers.get('origin')  ?? ''
  const referer = req.headers.get('referer') ?? ''
  const host    = process.env.NEXT_PUBLIC_URL ?? ''

  if (host) {
    const isAllowedOrigin =
      origin.startsWith(host)  ||
      referer.startsWith(host) ||
      // No Origin = direct request (curl, server-to-server, browser dev tools).
      // Allow in development only — production browsers always send Origin.
      (process.env.NODE_ENV === 'development' && !origin)

    if (!isAllowedOrigin && origin !== '') {
      return new Response(
        JSON.stringify({ error: 'forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  // ── 3. IP extraction ───────────────────────────────────────────────────
  const ip = getIP(req)

  // Block requests where the IP is indeterminate — this prevents a class
  // of abuse where the proxy chain is stripped or forged to appear absent.
  if (ip === 'unknown') {
    return new Response(
      JSON.stringify({ error: 'demo_limit_reached' }),
      {
        status:  429,
        headers: {
          'Content-Type':          'application/json',
          'Retry-After':           '86400',
          'X-RateLimit-Limit':     '1',
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  // ── 4. Per-IP rate limit: 1 demo per 24 hours ─────────────────────────
  const { success: ipOk } = await checkLimit(ipLimiter, ip)
  if (!ipOk) {
    return new Response(
      JSON.stringify({ error: 'demo_limit_reached' }),
      {
        status:  429,
        headers: {
          'Content-Type':          'application/json',
          'Retry-After':           '86400',   // 24 hours
          'X-RateLimit-Limit':     '1',
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  // ── 5. Global rate limit: 50 demos per clock hour ─────────────────────
  // Including the current UTC hour in the key ensures each hour gets an
  // independent 50-slot bucket rather than a shared rolling window.
  const bucketKey = `demo:global:${getHourBucket()}`
  const { success: globalOk } = await checkLimit(globalLimiter, bucketKey)
  if (!globalOk) {
    return new Response(
      JSON.stringify({ error: 'demo_limit_reached' }),
      {
        status:  429,
        headers: {
          'Content-Type':          'application/json',
          'Retry-After':           '3600',    // try again next hour
          'X-RateLimit-Limit':     '50',
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  // ── 6. Parse & validate body ───────────────────────────────────────────
  let body: z.infer<typeof DemoSchema>
  try {
    body = DemoSchema.parse(await req.json())
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof z.ZodError ? e.errors[0].message : 'Invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── 7. Honeypot check ─────────────────────────────────────────────────
  // If the hidden honeypot field was filled in, this is almost certainly a
  // bot. Return a convincing-looking fake SSE stream so automated scrapers
  // stall waiting for content that never comes, burning their time rather
  // than our Anthropic credits.
  if (body.honeypot) {
    const encoder = new TextEncoder()
    const fakeStream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 800))
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text', text: '.' })}\n\n`)
          )
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', wordCount: 8 })}\n\n`)
        )
        controller.close()
      },
    })
    return new Response(fakeStream, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      },
    })
  }

  // ── 8. Structured log ─────────────────────────────────────────────────
  // JSON-structured so log aggregators (Axiom, Logtail, CloudWatch) can
  // index and filter on individual fields.
  console.log(JSON.stringify({
    event:       'demo_generation',
    ip,
    origin,
    industry:    body.industry,
    contentType: body.contentType,
    wordCount:   body.wordCount,
    timestamp:   new Date().toISOString(),
    bucket:      getHourBucket(),
  }))

  // ── 9. Build prompt ────────────────────────────────────────────────────
  const prompt = buildPrompt({
    industry:    body.industry,
    contentType: body.contentType,
    tone:        body.tone,
    keyword:     body.keyword,
    audience:    'Marketing professionals',
    wordCount:   body.wordCount,
    brandVoice:  '',
    platforms:   [],
  })

  // ── 10. Stream from Anthropic — max_tokens capped at 800 for cost control
  // No workspace context on this public route, so this always resolves to
  // the platform key — routed through the same helper as every other AI
  // call site for consistency (and so BYOK plumbing has one entry point).
  const { client: anthropic } = await getAnthropicClientForWorkspace(null, 'demo/generate')
  const stream = anthropic.messages.stream({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages:   [{ role: 'user', content: prompt }],
  })

  // ── 11. Return SSE stream (no DB writes — ephemeral) ──────────────────
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let wordCount = 0
      let fullText  = ''

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text
            fullText  += text
            wordCount  = countWords(fullText)

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
            )
          }
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', wordCount })}\n\n`)
        )
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Generation failed' })}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}
