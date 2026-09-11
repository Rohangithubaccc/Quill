// ── Shared rate limiting — fails open, never crashes the route ─────────────
//
// Upstash Redis is an OPTIONAL integration (per the setup guide — a
// workspace can run without it). That means every call site here MUST
// degrade to "allow the request" if Redis isn't configured or isn't
// reachable, rather than throwing. An earlier version of this pattern,
// duplicated across several routes, called `.limit()` directly with no
// guard: `@upstash/redis` throws a TypeError when constructed without a
// url/token the moment you actually call it (confirmed by testing it
// directly, not assumed) — which meant /api/ai/generate and three other
// routes would 500 on every single request for anyone who skipped the
// "optional" Upstash setup step. Rate limiting failing open is standard,
// correct practice: a broken rate limiter should never become an outage
// for legitimate traffic.
//
// Usage:
//   const limiter = getLimiter('rl:signup:ip', 5, '1 h')
//   const { success, reset } = await checkLimit(limiter, ip)
//   if (!success) return 429 with Retry-After computed from `reset`

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null
  if (!_redis) {
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  }
  return _redis
}

const _limiterCache = new Map<string, Ratelimit>()

// window: Upstash's duration string format, e.g. '1 m', '1 h', '24 h'.
// Returns null if Redis isn't configured — callers must treat null as
// "rate limiting unavailable, allow the request" (see checkLimit below,
// or handle it directly for the Promise.all-multiple-limiters case).
export function getLimiter(prefix: string, limit: number, window: `${number} ${'ms' | 's' | 'm' | 'h' | 'd'}`): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null

  const cacheKey = `${prefix}:${limit}:${window}`
  let limiter = _limiterCache.get(cacheKey)
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window), prefix })
    _limiterCache.set(cacheKey, limiter)
  }
  return limiter
}

export interface LimitResult {
  success:   boolean
  reset:     number   // epoch ms — only meaningful when success is false
  remaining: number   // requests left in the current window; 0 when unlimited (Redis unavailable)
}

// Wraps limiter.limit(key) with both guards: null limiter (not configured)
// and a runtime failure (misconfigured credentials, Upstash outage) both
// fail open rather than blocking the request.
export async function checkLimit(limiter: Ratelimit | null, key: string): Promise<LimitResult> {
  if (!limiter) return { success: true, reset: 0, remaining: 0 }
  try {
    const result = await limiter.limit(key)
    return { success: result.success, reset: result.reset, remaining: result.remaining }
  } catch (err) {
    console.error('[rate-limit] Redis call failed, failing open:', err)
    return { success: true, reset: 0, remaining: 0 }
  }
}

// Extracts the caller's IP the same way every route in this codebase
// already does, in one place instead of duplicated per-route.
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1'
}

// Standard 429 response shape, shared so every route returns the same
// format instead of ad hoc JSON.
export function rateLimitResponse(message: string, reset: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
      },
    },
  )
}
