-- ── Migration 013: atomic add_credits + reset_monthly_credits functions ────────
--
-- These Postgres functions are called by:
--   add_credits()           ← Stripe webhook (checkout.session.completed)
--   reset_monthly_credits() ← Monthly reset cron (/api/cron/reset-usage)
--
-- Both are idempotent and SECURITY DEFINER (run as postgres, bypass RLS).
-- They are only callable from routes using the service_role key.
--
-- Run AFTER: 012_credits.sql
-- Run: supabase db push  (or paste into Supabase SQL editor)

-- ── add_credits ───────────────────────────────────────────────────────────────
-- Atomically adds p_credits to credits_remaining for a workspace.
--
-- WHY: Stripe delivers webhooks with at-least-once semantics + concurrent
-- delivery is possible. A read-then-write in application code would cause:
--   Thread A reads credits_remaining = 50, computes 50 + 100 = 150
--   Thread B reads credits_remaining = 50 (before A writes), computes 150
--   Both write 150 → user only gets 100 credits instead of 200
--
-- This single SQL UPDATE is atomic at the Postgres level — no race.
-- The stripe_events idempotency table (migration 005) is the second
-- line of defence that prevents double-delivery entirely.
CREATE OR REPLACE FUNCTION add_credits(
  p_workspace_id UUID,
  p_credits      INTEGER
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE workspaces
  SET credits_remaining = credits_remaining + p_credits
  WHERE id    = p_workspace_id
    AND plan NOT IN ('cancelled');
$$;

-- ── reset_monthly_credits ─────────────────────────────────────────────────────
-- Resets credits_remaining to credits_monthly for all active workspaces,
-- and zeroes usage_count for the new billing period.
--
-- WHY a function: Supabase JS .update() cannot SET one column to the value
-- of another in the same row. This SQL: SET credits_remaining = credits_monthly
-- requires a function call or raw SQL.
CREATE OR REPLACE FUNCTION reset_monthly_credits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE workspaces
  SET
    usage_count       = 0,
    credits_remaining = credits_monthly
  WHERE plan NOT IN ('cancelled');
$$;

-- ── Grant execute to service_role only ───────────────────────────────────────
-- anon and authenticated roles should NOT be able to call these directly.
REVOKE EXECUTE ON FUNCTION add_credits(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reset_monthly_credits()    FROM PUBLIC;

GRANT  EXECUTE ON FUNCTION add_credits(UUID, INTEGER) TO service_role;
GRANT  EXECUTE ON FUNCTION reset_monthly_credits()    TO service_role;
