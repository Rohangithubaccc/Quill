-- ── Migration 026: atomic deduct_credits() — closes a real race condition ──
--
-- migration 013_add_credits_function.sql already correctly solved this
-- exact problem for ADDING credits (Stripe webhooks), with a comment
-- explaining the race in detail. That fix was never applied to the
-- DEDUCTION side — every credit-charging route in this app (ai/generate,
-- ai/repurpose, ai/image, ai/bulk-repurpose, content/[id]/plagiarism)
-- reads credits_remaining into a JS variable, computes the new value by
-- subtracting in application code, then writes that computed value back.
--
-- Under concurrent requests to the same workspace (two team members
-- generating at once, or any retry/parallel call), this undercounts:
--   Request A reads credits_remaining = 100, computes 100 - 5 = 95
--   Request B reads credits_remaining = 100 (before A writes), computes 95
--   Both write 95 → workspace was charged for one generation, not two
--
-- This is a real financial/business-logic bug, not a theoretical one —
-- every one of those five routes has it, all in the direction that costs
-- real Anthropic/OpenAI spend without corresponding revenue.
--
-- Run AFTER: 025_approval_chains.sql
-- Safe to re-run: uses CREATE OR REPLACE / IF NOT EXISTS throughout.

-- ── deduct_credits ────────────────────────────────────────────────────────
-- Atomically checks AND deducts in one statement — the WHERE clause on
-- the same UPDATE that does the subtraction means Postgres row-locks for
-- the duration, so a concurrent second call sees the already-decremented
-- balance, not the stale pre-deduction one. This closes both the
-- undercounting bug above AND a related, subtler one: two concurrent
-- requests both passing an application-side "is there enough balance?"
-- check (both reading the same pre-deduction value) and both proceeding,
-- which could drive credits_remaining negative under load. A conditional
-- UPDATE can't do that — the second call's WHERE clause simply won't
-- match once the first has already spent the balance down.
--
-- Also increments usage_count in the same atomic statement, for the same
-- reason — that counter had the identical race.
CREATE OR REPLACE FUNCTION deduct_credits(
  p_workspace_id UUID,
  p_amount       INTEGER
)
RETURNS TABLE(success BOOLEAN, new_balance INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  UPDATE workspaces
  SET credits_remaining = credits_remaining - p_amount,
      usage_count       = usage_count + 1
  WHERE id = p_workspace_id
    AND credits_remaining >= p_amount
  RETURNING credits_remaining INTO v_balance;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_balance;
  ELSE
    -- Either the workspace doesn't exist, or the balance was
    -- insufficient at the moment this ran (which may differ from what
    -- an earlier application-side check saw, by design — that's the
    -- race this function exists to close). Report the current balance
    -- either way so the caller can show an accurate error.
    SELECT credits_remaining INTO v_balance FROM workspaces WHERE id = p_workspace_id;
    RETURN QUERY SELECT false, COALESCE(v_balance, 0);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION deduct_credits(UUID, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION deduct_credits(UUID, INTEGER) TO service_role;

-- ── increment_asset_used_count ───────────────────────────────────────────
-- Same class of bug, much lower stakes (a display counter, not billing) —
-- fixed the same way while already in here. src/app/api/assets/[id]/use/
-- route.ts previously did the identical read-then-write in JS.
CREATE OR REPLACE FUNCTION increment_asset_used_count(p_asset_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE assets SET used_count = used_count + 1 WHERE id = p_asset_id;
$$;

REVOKE EXECUTE ON FUNCTION increment_asset_used_count(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION increment_asset_used_count(UUID) TO service_role;

-- ── Verification queries ─────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname IN ('deduct_credits', 'increment_asset_used_count');
