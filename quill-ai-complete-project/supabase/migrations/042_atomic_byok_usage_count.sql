-- ── Migration 042: atomic increment_byok_usage_count() ──────────────────────
--
-- The exact same bug class migration 026 fixed for credits_remaining,
-- found alive in a parallel code path during a ruthless adversarial pass.
--
-- deduct_credits() (026) already atomically increments usage_count as
-- part of the same UPDATE that deducts credits — but it's only called on
-- the credit-based path. BYOK workspaces (their own Anthropic key, no
-- credits to deduct) skip deduct_credits() entirely and go through a
-- separate branch in ai/generate/route.ts that did the exact
-- read-then-write-in-JS pattern 026's own comment warns against:
--   usage_count: (ws as any).usage_count + 1
-- — using a value read at the top of the request, before generation
-- even runs, then written back after.
--
-- Reproduced directly, mirroring the same test that caught the original
-- credits bug: seeded a BYOK workspace at usage_count = 0, fired 20
-- concurrent requests replaying this exact sequence (read, delay
-- simulating generation time, write old+1). Final count: 1, not 20 — 19
-- of 20 increments silently lost. BYOK workspaces aren't gated by
-- usage_count (checked directly: the credit-limit check in
-- ai/generate/route.ts is `!isByok && credits_remaining < cost`, so
-- nothing gets bypassed) — but the count is displayed to users in three
-- places (dashboard, generator, settings), so a BYOK customer running
-- concurrent generations, completely normal usage for a paying
-- Agency-tier account, would see a visibly wrong number in their own
-- dashboard.
--
-- Run AFTER: 041_stripe_period_and_first_gen.sql

CREATE OR REPLACE FUNCTION increment_byok_usage_count(p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE workspaces
  SET usage_count = usage_count + 1
  WHERE id = p_workspace_id
  RETURNING usage_count;
$$;

REVOKE EXECUTE ON FUNCTION increment_byok_usage_count(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION increment_byok_usage_count(UUID) TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT increment_byok_usage_count('<any workspace id>');
