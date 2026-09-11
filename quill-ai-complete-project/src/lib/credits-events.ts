// ── Cross-component credits refresh ──────────────────────────────────────
//
// Sidebar.tsx fetches workspace credits once on mount and again on
// workspace switch — there's no shared context or state manager anywhere
// in this app, so every page holds its own independent copy of workspace
// data. That means any credit-consuming action taken from a *different*
// page (generate, image gen, bulk repurpose — all live in generator/page.tsx)
// leaves the Sidebar showing a stale balance until the next full
// navigation remounts it. Confirmed in production: a real generation that
// the DB showed deducted 3 credits (120 → 117) still displayed
// "120 of 120 left" in the sidebar afterwards.
//
// A window CustomEvent is the smallest fix that actually closes this gap
// for every current and future credit-consuming action, without a larger
// refactor to a shared context provider that would touch every page
// reading workspace data (Sidebar, generator, dashboard, UpgradeModal).
// If a real shared workspace context gets built later for other reasons,
// this can be retired in favor of it — until then, this is intentionally
// the minimal fix, not a placeholder for a bigger one.
const CREDITS_CHANGED_EVENT = 'quill:credits-changed'

// Call this immediately after any action that the backend has confirmed
// deducted (or refunded) credits — not optimistically before the request,
// and not on failure paths.
export function notifyCreditsChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
}

// Returns an unsubscribe function, matching the cleanup-function
// convention every other useEffect in this codebase already follows.
export function onCreditsChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CREDITS_CHANGED_EVENT, callback)
  return () => window.removeEventListener(CREDITS_CHANGED_EVENT, callback)
}
