-- ── Migration 040: webhook failure visibility ────────────────────────────────
--
-- Found during a fresh, from-scratch ruthless test pass. Verified the
-- delivery mechanics themselves are genuinely solid — HMAC-SHA256 signing
-- checked directly (recomputes correctly, tamper-detection actually works),
-- safeFetch's redirect re-validation checked directly (re-validates every
-- hop, strips credentials cross-origin, matching what its own comments
-- claim). What's missing is entirely downstream of delivery: after all 5
-- retries are exhausted (deliverWebhook in functions.ts has no onFailure
-- handler), nothing happens. last_fired_at only updates on success and is
-- never touched again once an endpoint starts failing — a customer's
-- integration can break silently for weeks with zero surface anywhere in
-- the product to notice it.
--
-- Run AFTER: 039_fix_fts_index.sql

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failure_reason  TEXT;

ALTER TABLE webhook_endpoints
  ADD CONSTRAINT webhook_endpoints_consecutive_failures_check
  CHECK (consecutive_failures >= 0);

-- Atomic increment/reset, not a JS read-modify-write — matches the same
-- reasoning already applied throughout this project (deduct_credits,
-- reserve_storage, claim_seat_and_create_invite): a single endpoint can
-- legitimately receive multiple different webhook.deliver events
-- (content.published, content.approved, etc.) firing close together, and
-- a naive read-then-write JS pattern on the same counter is exactly the
-- race class this project has repeatedly found real bugs in.

CREATE OR REPLACE FUNCTION record_webhook_failure(
  p_endpoint_id UUID,
  p_reason      TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE webhook_endpoints
  SET consecutive_failures = consecutive_failures + 1,
      last_failure_at      = NOW(),
      last_failure_reason  = p_reason
  WHERE id = p_endpoint_id;
$$;

CREATE OR REPLACE FUNCTION record_webhook_success(
  p_endpoint_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE webhook_endpoints
  SET consecutive_failures = 0,
      last_fired_at        = NOW()
  WHERE id = p_endpoint_id;
$$;

REVOKE EXECUTE ON FUNCTION record_webhook_failure(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION record_webhook_failure(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION record_webhook_success(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION record_webhook_success(UUID) TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT consecutive_failures, last_failure_at, last_failure_reason
--   FROM webhook_endpoints WHERE id = '<any endpoint id>';
