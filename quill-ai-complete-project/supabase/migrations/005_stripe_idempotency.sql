-- ============================================================
-- Quill.AI Migration 005 — Stripe Webhook Idempotency
-- Run in: Supabase Dashboard → SQL Editor
-- Depends on: 001_initial_schema.sql (must run first)
-- ============================================================
--
-- PURPOSE
-- ───────
-- Stripe delivers webhooks with at-least-once semantics. The same
-- event_id can arrive multiple times due to:
--   • Stripe retrying after a non-2xx response from our handler
--   • Network timeouts causing Stripe to retry a successfully
--     delivered event before our 200 was received
--   • Manual retries triggered via the Stripe Dashboard
--
-- This table records every event_id we have successfully processed.
-- The webhook handler checks this table before doing any work.
-- If the event_id is already present, the handler returns 200
-- immediately without touching any business data.
--
-- DESIGN DECISIONS
-- ────────────────
-- • event_id is the Stripe event identifier (e.g. evt_1ABC...),
--   used as the PRIMARY KEY so duplicate inserts fail fast.
-- • We insert AFTER successfully processing, not before. This means
--   a crash mid-handler leaves the event unrecorded, so Stripe will
--   retry it — which is the correct failure mode.
-- • No RLS is needed. This table is only accessed by the service_role
--   key inside the webhook API route.
-- • Rows older than 90 days are cleaned up weekly by a cron job
--   (/api/cron/cleanup-stripe-events) to prevent unbounded growth.
--   Stripe only retries events for up to 3 days, so 90 days is
--   a conservative but safe retention window.
-- ============================================================

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT        PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index used by the weekly cleanup cron to find and delete old rows
-- efficiently without a full table scan.
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed
  ON stripe_events(processed_at DESC);

-- No RLS — this table is only ever touched by the service_role key.
-- Enabling RLS with no policies would block all access, including
-- service_role, which is not the intended behaviour.
-- Leave RLS disabled intentionally.
