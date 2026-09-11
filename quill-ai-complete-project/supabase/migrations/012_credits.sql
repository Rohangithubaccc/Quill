-- ── Migration 012: credit-based usage system ─────────────────────────────────
--
-- Replaces the flat pieces-per-month limit with a credit economy.
-- Credit costs per action:
--   Blog Post / LinkedIn Article / YouTube Script / Webinar Script /
--   Podcast Episode Outline: 10 credits (long-form, high token count)
--   Twitter Thread / Instagram Caption / TikTok / Email Newsletter /
--   Ad Copy: 3 credits (short-form)
--   Press Release: 5 credits
--   Repurpose (any type): 5 credits
--   Plagiarism check: 2 credits
--   Humanize: 0 credits (free post-processing)
--
-- Plan allocations:
--   Starter  → 120 credits/month  ($299/mo)
--   Growth   → 400 credits/month  ($599/mo)
--   Agency   → 2000 credits/month ($1,299/mo)
--
-- Run: supabase db push  (or paste into Supabase SQL editor)
-- Run AFTER: 011_published_url_and_waitlist.sql

-- ── 1. Add credit columns to workspaces ───────────────────────────────────────

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS credits_remaining INTEGER NOT NULL DEFAULT 0
    CHECK (credits_remaining >= 0),
  ADD COLUMN IF NOT EXISTS credits_monthly   INTEGER NOT NULL DEFAULT 0
    CHECK (credits_monthly >= 0);

-- ── 2. Backfill from existing usage_limit ────────────────────────────────────
-- Rule: old usage_limit × 10 = new credits_monthly
--   12 pieces (old Starter) → 120 credits
--   30 pieces (old Growth)  → 300 credits  (Growth plan jumps to 400 with new pricing)
-- credits_remaining = credits_monthly - (usage_count × 10), clamped to 0
-- This ensures no workspace is zeroed unexpectedly on deploy.

UPDATE workspaces SET
  credits_monthly   = usage_limit * 10,
  credits_remaining = GREATEST(0, (usage_limit * 10) - (usage_count * 10))
WHERE credits_monthly = 0;   -- only backfill rows not yet set

-- Set correct plan credits for active subscriptions (override backfill for known plans)
UPDATE workspaces SET
  credits_monthly   = 120,
  credits_remaining = GREATEST(0, 120 - (usage_count * 10))
WHERE plan = 'starter' AND credits_monthly != 120;

UPDATE workspaces SET
  credits_monthly   = 400,
  credits_remaining = GREATEST(0, 400 - (usage_count * 10))
WHERE plan = 'growth' AND credits_monthly != 400;

UPDATE workspaces SET
  credits_monthly   = 2000,
  credits_remaining = GREATEST(0, 2000 - (usage_count * 10))
WHERE plan = 'agency' AND credits_monthly != 2000;

UPDATE workspaces SET
  credits_monthly   = 0,
  credits_remaining = 0
WHERE plan = 'cancelled';

-- ── 3. Fast balance-check index ──────────────────────────────────────────────
-- Used every time the generate/repurpose routes check credits_remaining.
CREATE INDEX IF NOT EXISTS workspaces_credits_idx
  ON workspaces(id, credits_remaining, credits_monthly);

-- ── 4. Atomic credit reset function (used by monthly reset cron) ─────────────
-- Must use a Postgres function because Supabase JS .update() cannot
-- set one column to the value of another in the same row.
CREATE OR REPLACE FUNCTION reset_monthly_credits()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE workspaces
  SET
    usage_count       = 0,
    credits_remaining = credits_monthly
  WHERE plan NOT IN ('cancelled');
$$;

-- ── 5. Atomic credit addition function (used by Stripe add-on webhook) ────────
-- Prevents race conditions when two concurrent webhook deliveries both try
-- to add credits simultaneously (at-least-once delivery is Stripe's guarantee).
-- A plain read-then-write would let two concurrent calls both read N, then
-- both write N+100, resulting in N+100 instead of N+200.
CREATE OR REPLACE FUNCTION add_credits(
  p_workspace_id UUID,
  p_credits      INTEGER
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE workspaces
  SET credits_remaining = credits_remaining + p_credits
  WHERE id = p_workspace_id
    AND plan NOT IN ('cancelled');
$$;

-- ── NOTES ─────────────────────────────────────────────────────────────────────
-- usage_count and usage_limit columns are KEPT (not dropped) for:
--   1. Analytics — usage_count is read by the engagement aggregation cron
--   2. Safety — removing columns requires a separate migration after all
--      code that reads them has been deployed and verified
-- These columns will be formally deprecated in a future migration.
