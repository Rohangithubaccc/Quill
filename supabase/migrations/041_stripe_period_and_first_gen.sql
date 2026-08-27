-- ── Migration 041: subscription period tracking + first-generation flag ─────
--
-- Two unrelated schema additions from the same round of ruthless testing,
-- bundled since both are small.
--
-- Run AFTER: 040_webhook_failure_tracking.sql

-- ── Part 1: subscription period tracking ─────────────────────────────────
--
-- Found: customer.subscription.updated fires for far more than plan
-- changes and renewals — a customer updating their payment method,
-- toggling cancel_at_period_end via the Customer Portal, a metadata
-- change, pause/resume collection all trigger this exact same event
-- type. The webhook handler reset credits_remaining to full
-- unconditionally on every one of them (comment: "reset to full on plan
-- change or renewal" — but nothing actually checked either condition).
-- Concretely: a customer who'd used 80% of their monthly credits and
-- simply updated an expiring card got a silent, free full refill.
--
-- Fix (in application code, this column is what makes it possible):
-- store the subscription's current_period_start so the webhook handler
-- can compare the incoming value against what's already on record and
-- only reset credits when the period has genuinely rolled over, rather
-- than trusting that "this event type fired" implies it.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS stripe_current_period_start TIMESTAMPTZ;

-- ── Part 2: workspace-level first-generation tracking ────────────────────
--
-- Found: the "Your first piece is ready!" celebration was tracked via
-- localStorage keyed by user id, not anything in the database. A user
-- switching devices, browsers, or clearing site data would see it again
-- on an account that's been active for months — and per the original
-- roadmap doc's own framing ("Workspace setup 2/3 complete" banner,
-- first content as one of the tracked milestones), this is meant to be
-- a workspace-level onboarding milestone, not a per-browser one anyway.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS first_generation_celebrated_at TIMESTAMPTZ;

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT stripe_current_period_start, first_generation_celebrated_at
--   FROM workspaces WHERE id = '<any workspace id>';
