-- ── Migration 035: atomic claim for the content-purge cron ──────────────────
--
-- Found during load-testing under concurrent real traffic (item 4 of this
-- session's list): /api/cron/purge-deleted-content did a plain SELECT of
-- due rows, then — for each workspace — listed Storage files, computed
-- bytesReleased from whatever hadn't been removed yet, called
-- release_storage(), and only THEN deleted the content_pieces rows.
--
-- Reproduced with two real concurrent invocations against a seeded
-- workspace (storage_used_bytes = 5,000,000; 500,000 bytes of due
-- content). Both invocations listed the same not-yet-removed files
-- before either had removed them, both computed bytesReleased = 500,000,
-- and both called release_storage(workspace, 500000) — final
-- storage_used_bytes landed at 4,000,000, not the correct 4,500,000.
-- The DELETE itself was never the problem (Postgres DELETE ... WHERE id
-- IN (...) is naturally idempotent — the loser just matches 0 rows, which
-- is why last session's raw test result looked like "both succeeded"
-- with no obvious corruption). The corruption is silent: a workspace's
-- tracked storage usage drifts below its real usage every time this
-- overlaps, which only ever expands the workspace's effective quota,
-- never shrinks it — the kind of bug that has no user-visible symptom
-- until a storage quota check somewhere else stops matching reality.
--
-- Fix: same shape as every other atomic fix this project has needed
-- (026 credits, 027 storage, 034 seats) — claim the rows atomically
-- BEFORE computing anything derived from them, so bytesReleased can
-- never be computed twice for the same bytes. Unlike a straight
-- SELECT-then-DELETE reorder (delete first, cleanup storage after),
-- this preserves retry-on-failure: if Storage cleanup throws for a
-- workspace, the claim self-expires after PURGE_CLAIM_STALE_MINUTES so
-- tomorrow's run picks the same rows back up instead of leaking storage
-- forever.
--
-- Run AFTER: 034_atomic_seat_claim.sql

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS purge_claimed_at TIMESTAMPTZ;

-- Claims are short-lived: a real run's storage listing + removal is
-- expected to finish well inside this window. If it doesn't (crash,
-- timeout, cold Storage API), the claim goes stale and becomes eligible
-- for a fresh claim on the next run — same self-healing timeout pattern
-- as the maxDuration=60 the route itself already runs under.
CREATE INDEX IF NOT EXISTS idx_cp_purge_claimed
  ON content_pieces(purge_claimed_at)
  WHERE purge_claimed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_content_for_purge(
  p_retention_days      INT DEFAULT 30,
  p_stale_claim_minutes INT DEFAULT 10
)
RETURNS TABLE(id UUID, workspace_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE content_pieces cp
  SET purge_claimed_at = NOW()
  WHERE cp.deleted_at IS NOT NULL
    AND cp.deleted_at <= NOW() - (p_retention_days || ' days')::INTERVAL
    AND (
      cp.purge_claimed_at IS NULL
      OR cp.purge_claimed_at <= NOW() - (p_stale_claim_minutes || ' minutes')::INTERVAL
    )
  RETURNING cp.id, cp.workspace_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_content_for_purge(INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION claim_content_for_purge(INT, INT) TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
-- Two concurrent calls against the same due rows should return disjoint
-- (in practice: one full, one empty) result sets, never overlapping ids:
--   SELECT * FROM claim_content_for_purge();
