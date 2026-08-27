// ─────────────────────────────────────────────────────────────────────────────
// Storage quota — single source of truth for plan limits.
// Every route that reserves storage imports from here. NEVER hardcode a
// byte limit in a route file.
//
// Pairs with migration 027_storage_quota.sql, which holds the atomic
// reserve_storage()/release_storage() functions this is meant to be used
// alongside. If you change a limit here, also update the backfill values
// in that migration (existing workspaces aren't re-touched by this file
// alone — it only governs new reserve_storage() calls going forward).
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_STORAGE_LIMITS: Record<string, number> = {
  starter:   5   * 1024 * 1024 * 1024,   //   5 GB
  growth:    25  * 1024 * 1024 * 1024,   //  25 GB
  agency:    200 * 1024 * 1024 * 1024,   // 200 GB
  cancelled: 5   * 1024 * 1024 * 1024,   //   5 GB — existing files stay readable, no new ones fit
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}MB`
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(0)}KB`
  return `${bytes}B`
}

/** Standard 402 error body for a reserve_storage() failure. */
export function storageLimitMessage(usedBytes: number, limitBytes: number): string {
  return `Storage limit reached (${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} used). ` +
    `Delete unused assets or documents, or upgrade your plan, to free up space.`
}
