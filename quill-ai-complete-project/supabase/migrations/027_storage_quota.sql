-- ── Migration 027: per-workspace storage quota ──────────────────────────────
--
-- Flagged in the pre-launch risk audit (setup guide, "Medium — found, not
-- fixed"): no per-workspace storage quota exists anywhere in the app, for
-- any plan tier. DAM alone allows up to 200MB/file with zero cap tied to a
-- workspace's subscription — a sustained heavy (or malicious) workspace
-- could run real Supabase Storage costs with no ceiling.
--
-- Three real storage-writing surfaces exist (checked the code, not assumed):
--   - src/app/api/assets/route.ts               (DAM images/videos)
--   - src/app/api/knowledge-base/upload/route.ts (KB documents)
--   - src/inngest/functions.ts (image-generation)(DALL-E header images)
-- Logo upload is intentionally excluded — 2MB cap, one file per workspace,
-- upsert-overwritten, so it cannot grow. PDF export is also excluded —
-- small text PDFs, flagged as a known minor gap, not fixed here.
--
-- Run AFTER: 026_atomic_credits.sql
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE throughout.
-- The backfill UPDATEs are idempotent (they recompute from source tables
-- each time, not increment).

-- ── Columns ──────────────────────────────────────────────────────────────
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS storage_used_bytes  BIGINT NOT NULL DEFAULT 0
    CHECK (storage_used_bytes >= 0),
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT NOT NULL DEFAULT 5368709120; -- 5GB, starter default

-- ── Backfill limits by plan ──────────────────────────────────────────────
-- Same three-tier shape as PLAN_CREDITS (src/lib/credits.ts), but sized
-- independently — storage cost isn't proportional to generation volume.
-- These are a starting assumption, not derived from any existing constant.
-- Single source of truth going forward: PLAN_STORAGE_LIMITS in
-- src/lib/storage-quota.ts (keep both in sync if you change one).
UPDATE workspaces SET storage_limit_bytes = 5368709120   WHERE plan = 'starter';    --   5 GB
UPDATE workspaces SET storage_limit_bytes = 26843545600  WHERE plan = 'growth';     --  25 GB
UPDATE workspaces SET storage_limit_bytes = 214748364800 WHERE plan = 'agency';     -- 200 GB
UPDATE workspaces SET storage_limit_bytes = 5368709120   WHERE plan = 'cancelled';  --   5 GB (existing files stay readable, no new ones fit)

-- ── Backfill actual usage from what's already stored ─────────────────────
-- Workspaces that existed before this migration may already have DAM
-- assets, KB documents, and DALL-E header images — starting everyone at 0
-- would silently under-count real usage on day one, the exact "looks
-- fine, is quietly wrong" shape this whole audit has been finding.
--
-- header_image_url has no tracked byte size anywhere (DALL-E images were
-- never recorded against a file_size_bytes column), so it's approximated
-- at a flat 2MB per generated image — a real 1792x1024 standard-quality
-- PNG from DALL-E 3 typically lands in the 1-3MB range. Good enough for a
-- quota gate; not precise enough to bill against.
WITH usage AS (
  SELECT workspace_id, SUM(file_size_bytes) AS bytes FROM assets GROUP BY workspace_id
  UNION ALL
  SELECT workspace_id, SUM(file_size_bytes) AS bytes FROM knowledge_documents GROUP BY workspace_id
  UNION ALL
  SELECT workspace_id, COUNT(*) * 2097152 AS bytes
  FROM content_pieces
  WHERE header_image_url IS NOT NULL
  GROUP BY workspace_id
),
totals AS (
  SELECT workspace_id, SUM(bytes) AS total_bytes FROM usage GROUP BY workspace_id
)
UPDATE workspaces w
SET storage_used_bytes = COALESCE(t.total_bytes, 0)
FROM totals t
WHERE w.id = t.workspace_id;

-- ── reserve_storage ───────────────────────────────────────────────────────
-- Atomically checks AND reserves in one statement — same pattern as
-- deduct_credits() (migration 026): the WHERE clause on the same UPDATE
-- that does the addition means Postgres row-locks for the duration, so
-- concurrent uploads to the same workspace can't both pass a stale
-- pre-upload check and jointly blow past the limit.
--
-- Called BEFORE the actual Storage .upload() — unlike credits (deducted
-- only after the AI call succeeds, since that cost is incurred no matter
-- what), the storage cost doesn't exist yet at this point, so blocking
-- here means a doomed upload never happens, instead of failing cleanup
-- after the fact.
CREATE OR REPLACE FUNCTION reserve_storage(
  p_workspace_id UUID,
  p_bytes        BIGINT
)
RETURNS TABLE(success BOOLEAN, new_used_bytes BIGINT, limit_bytes BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used  BIGINT;
  v_limit BIGINT;
BEGIN
  UPDATE workspaces
  SET storage_used_bytes = storage_used_bytes + p_bytes
  WHERE id = p_workspace_id
    AND storage_used_bytes + p_bytes <= storage_limit_bytes
  RETURNING storage_used_bytes, storage_limit_bytes INTO v_used, v_limit;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_used, v_limit;
  ELSE
    -- Either the workspace doesn't exist, or the limit was already at/near
    -- capacity at the moment this ran (which may differ from what an
    -- earlier application-side estimate saw, by design — that's the race
    -- this function exists to close). Report current used/limit either way
    -- so the caller can show an accurate "X of Y used" message.
    SELECT storage_used_bytes, storage_limit_bytes INTO v_used, v_limit
    FROM workspaces WHERE id = p_workspace_id;
    RETURN QUERY SELECT false, COALESCE(v_used, 0), COALESCE(v_limit, 0);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION reserve_storage(UUID, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION reserve_storage(UUID, BIGINT) TO service_role;

-- ── release_storage ──────────────────────────────────────────────────────
-- Compensating action for: (a) a reservation whose upload/DB-insert failed
-- after reserve_storage() already succeeded, and (b) deleting an existing
-- asset/document (frees the space back up).
--
-- GREATEST(0, ...) floors at zero instead of going negative if it's ever
-- called twice for the same bytes (e.g. a retried delete) — silently
-- capping is the safer failure mode for an accounting counter than an
-- error that blocks the delete from completing.
CREATE OR REPLACE FUNCTION release_storage(
  p_workspace_id UUID,
  p_bytes        BIGINT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE workspaces
  SET storage_used_bytes = GREATEST(0, storage_used_bytes - p_bytes)
  WHERE id = p_workspace_id;
$$;

REVOKE EXECUTE ON FUNCTION release_storage(UUID, BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION release_storage(UUID, BIGINT) TO service_role;

-- ── Verification queries ─────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname IN ('reserve_storage', 'release_storage');
-- SELECT plan, storage_limit_bytes, storage_used_bytes FROM workspaces LIMIT 10;
