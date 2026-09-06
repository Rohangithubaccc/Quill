// ─────────────────────────────────────────────────────────────────────────────
// Credit costs — single source of truth.
// Every API route that deducts credits imports from here.
// NEVER hardcode credit values in route files.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTENT_TYPE_CREDITS: Record<string, number> = {
  // ── Long-form (high token count) — 10 credits ─────────────────────────────
  'Blog Post':                    10,
  'LinkedIn Article':             10,
  'YouTube Script':               10,
  'Webinar Script':               10,
  'Podcast Episode Outline':      10,

  // ── Short-form (low token count) — 3 credits ──────────────────────────────
  'Twitter Thread':               3,
  'Instagram Caption':            3,
  'TikTok/Reels Hook + Script':   3,
  'Email Newsletter':             3,
  'Ad Copy':                      3,

  // ── Mid-form — 5 credits ───────────────────────────────────────────────────
  'Press Release':                5,
} as const

export const OPERATION_CREDITS = {
  repurpose:         5,
  plagiarism_check:  2,
  humanize:          0,   // free — post-processing, no new generation
  image_generation:  5,   // DALL-E 3 header image (~$0.04/image at 1792×1024)
} as const

export const PLAN_CREDITS: Record<string, number> = {
  starter:   120,
  growth:    400,
  agency:    2000,
  cancelled: 0,
}

export const PLAN_PRICES: Record<string, string> = {
  starter: '$299/mo',
  growth:  '$599/mo',
  agency:  '$1,299/mo',
}

export const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  growth:  'Growth',
  agency:  'Agency',
}

// getCreditCost — returns credits for a given operation
export function getCreditCost(
  contentType: string,
  operation: 'generate' | 'repurpose' | 'plagiarism_check' | 'humanize' | 'image_generation' = 'generate'
): number {
  if (operation !== 'generate') return OPERATION_CREDITS[operation]
  return CONTENT_TYPE_CREDITS[contentType] ?? 5
}

export function getUpgradeMessage(
  creditsRemaining: number,
  creditCost: number,
  currentPlan: string
): string {
  const next = currentPlan === 'starter' ? 'Growth' : currentPlan === 'growth' ? 'Agency' : null
  const base = `This action needs ${creditCost} credits but you only have ${creditsRemaining} remaining.`
  if (next) return `${base} Upgrade to ${next} for more credits, or buy a credit top-up pack.`
  return `${base} Purchase a credit top-up pack to continue.`
}
