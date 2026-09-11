-- ── Migration 036: atomic claim for notification-email dedup ────────────────
--
-- Found during the same load-testing pass as migration 035: three call
-- sites do a plain "have we already sent this?" SELECT against
-- sent_emails, then send the email, then INSERT a row to remember it —
-- the exact check-then-act shape already fixed this session for credits
-- (026), storage (027), Stripe events, and seats (034).
--
--   - /api/cron/linkedin-token-reminder — dedup window: rolling 7 days
--   - /api/email/trial-reminder, trial-ending branch — dedup window: today
--   - /api/email/trial-reminder, usage-80% branch  — dedup window: this month
--
-- Reproduced for the LinkedIn cron with two real concurrent invocations
-- against a seeded workspace: both connections evaluated the "already
-- sent this week?" SELECT as empty before either had inserted, so both
-- would have gone on to call the Resend API — final sent_emails count
-- for that (workspace, email_type) key was 2, not 1.
--
-- Why not just a UNIQUE constraint on (workspace_id, email_type)? The
-- three call sites have three different dedup windows (rolling 7-day,
-- calendar-day, calendar-month), and the usage-80% email is expected to
-- recur every month by design — a table-wide permanent uniqueness
-- constraint would silently stop that email from ever sending again
-- after the first month. The window has to stay a runtime parameter,
-- which rules out a plain unique index + ON CONFLICT.
--
-- Fix: a single atomic RPC per attempt, mirroring reserve_storage /
-- release_storage's reserve-then-release-on-failure shape. A
-- transaction-scoped advisory lock keyed on (workspace_id, email_type)
-- serializes concurrent claims for that exact pair without needing a
-- schema constraint; the check and the INSERT happen inside the same
-- function call (and therefore the same DB connection/transaction),
-- which matters here because Supabase is PostgREST over HTTP — a lock
-- taken in one .rpc() call and released in a separate later call has no
-- guarantee of hitting the same underlying connection, so the lock must
-- be acquired AND released within one function invocation.
--
-- Run AFTER: 035_purge_claim.sql

CREATE OR REPLACE FUNCTION claim_email_send(
  p_workspace_id UUID,
  p_email_type   TEXT,
  p_window_start TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Scoped to this transaction only (auto-released on commit/rollback,
  -- i.e. when this function returns) — serializes concurrent claims for
  -- the same (workspace, email_type) pair; different pairs never contend.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_email_type, 0));

  IF EXISTS (
    SELECT 1 FROM sent_emails
    WHERE workspace_id = p_workspace_id
      AND email_type   = p_email_type
      AND sent_at      >= p_window_start
  ) THEN
    RETURN NULL; -- already sent within the window — caller should skip
  END IF;

  INSERT INTO sent_emails (workspace_id, email_type)
  VALUES (p_workspace_id, p_email_type)
  RETURNING id INTO v_id;

  RETURN v_id; -- caller now owns this send; on send failure it should
               -- DELETE this row (by id) so a future run can retry
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_email_send(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION claim_email_send(UUID, TEXT, TIMESTAMPTZ) TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
-- Two concurrent calls with identical arguments should return exactly one
-- non-null id between them:
--   SELECT claim_email_send('<ws-id>', 'trial_ending_3d', NOW() - INTERVAL '1 day');
