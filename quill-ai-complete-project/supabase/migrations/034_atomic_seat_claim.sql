-- ── Migration 034: atomic seat claim for team invites ────────────────────────
--
-- Found during the Campaigns/Calendar/Team-management feature-logic
-- review: POST /api/workspace/invites called getSeatsUsed() (a plain
-- SELECT count across workspace_members + workspace_invites) to check
-- capacity, then INSERTed the new invite as a separate, later statement.
-- Same class of race already fixed for credits (026), storage (027), and
-- Stripe events (034... this one) — two near-simultaneous invite requests
-- for the same workspace at 4 of 5 seats could both read hasCapacity=true
-- before either INSERT lands, landing the workspace at 6 of 5.
--
-- Fix: the same shape as every other atomic fix this session — do the
-- check AND the write as one atomic unit instead of two separate
-- round-trips. Unlike credits/storage (a single counter column, fixed
-- with a conditional UPDATE), seat usage is a COUNT across two different
-- tables, so there's no single column to conditionally increment —
-- instead this locks the workspace row for the duration of the check,
-- which serializes concurrent claims for the same workspace exactly the
-- way a conditional UPDATE's row lock does.
--
-- Run AFTER: 033_performance_events_aggregation.sql

CREATE OR REPLACE FUNCTION claim_seat_and_create_invite(
  p_workspace_id UUID,
  p_invited_by   UUID,
  p_email        TEXT,
  p_role         TEXT,
  p_seat_limit   INT
)
RETURNS TABLE(
  success       BOOLEAN,
  invite_id     UUID,
  invite_token  TEXT,
  invite_expires_at TIMESTAMPTZ,
  active_count  INT,
  pending_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active  INT;
  v_pending INT;
  v_id      UUID;
  v_token   TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  -- Locks this workspace's row for the rest of the function — a
  -- concurrent call for the SAME workspace_id blocks here until this
  -- transaction commits, at which point it sees the just-inserted invite
  -- in its own count. Different workspaces never contend with each other
  -- (each locks its own row only).
  PERFORM 1 FROM workspaces WHERE id = p_workspace_id FOR UPDATE;

  SELECT count(*) INTO v_active
  FROM workspace_members
  WHERE workspace_id = p_workspace_id AND status = 'active';

  SELECT count(*) INTO v_pending
  FROM workspace_invites
  WHERE workspace_id = p_workspace_id AND status = 'pending' AND expires_at > NOW();

  IF v_active + v_pending >= p_seat_limit THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ, v_active, v_pending;
    RETURN;
  END IF;

  -- token/expires_at/status/id all use the table's own DEFAULTs (migration
  -- 002) — same as the plain .insert() this replaces, which didn't pass
  -- them explicitly either.
  INSERT INTO workspace_invites (workspace_id, invited_by, email, role)
  VALUES (p_workspace_id, p_invited_by, p_email, p_role)
  RETURNING id, token, expires_at INTO v_id, v_token, v_expires;

  RETURN QUERY SELECT true, v_id, v_token, v_expires, v_active, v_pending + 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_seat_and_create_invite(UUID, UUID, TEXT, TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION claim_seat_and_create_invite(UUID, UUID, TEXT, TEXT, INT) TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
-- SELECT * FROM claim_seat_and_create_invite('<ws-id>', '<user-id>', 'test@example.com', 'editor', 5);
