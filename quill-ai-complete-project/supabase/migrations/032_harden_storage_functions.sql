-- ── Migration 032: validate input on reserve_storage / release_storage ──────
--
-- Found auditing my own code from this session with the same rigor as
-- everything else: reserve_storage(workspace_id, p_bytes) does
-- `storage_used_bytes + p_bytes <= storage_limit_bytes` with no check
-- that p_bytes is non-negative. A negative value always satisfies that
-- comparison, so it always "succeeds" — and silently reduces
-- storage_used_bytes instead of increasing it.
--
-- Confirmed empirically: called reserve_storage(ws, -5000000) against a
-- workspace legitimately holding 5,000,000 bytes — it returned
-- success=true and zeroed the counter. No real file was removed.
--
-- NOT currently exploitable through the app: every actual call site
-- (DAM upload, KB upload, DALL-E image, PDF export — checked all four)
-- passes file.size or buffer.length, both real byte counts that can't be
-- negative by construction in JS. This is a latent gap, not a proven
-- live exploit — but a SQL function reachable by service_role shouldn't
-- depend entirely on every future caller getting that right by
-- convention. Same principle as the migration 030 fix, applied here
-- before a new code path (not RLS-reachable, so lower urgency, but the
-- same class of "don't trust the caller" gap).
--
-- Run AFTER: 031_fix_invite_leak.sql

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
  IF p_bytes < 0 THEN
    SELECT storage_used_bytes, storage_limit_bytes INTO v_used, v_limit
    FROM workspaces WHERE id = p_workspace_id;
    RETURN QUERY SELECT false, COALESCE(v_used, 0), COALESCE(v_limit, 0);
    RETURN;
  END IF;

  UPDATE workspaces
  SET storage_used_bytes = storage_used_bytes + p_bytes
  WHERE id = p_workspace_id
    AND storage_used_bytes + p_bytes <= storage_limit_bytes
  RETURNING storage_used_bytes, storage_limit_bytes INTO v_used, v_limit;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_used, v_limit;
  ELSE
    SELECT storage_used_bytes, storage_limit_bytes INTO v_used, v_limit
    FROM workspaces WHERE id = p_workspace_id;
    RETURN QUERY SELECT false, COALESCE(v_used, 0), COALESCE(v_limit, 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION release_storage(
  p_workspace_id UUID,
  p_bytes        BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_bytes < 0 THEN
    RETURN; -- silently a no-op, matching how every caller already treats
             -- this function as best-effort (always wrapped in .catch(()=>{}))
  END IF;

  UPDATE workspaces
  SET storage_used_bytes = GREATEST(0, storage_used_bytes - p_bytes)
  WHERE id = p_workspace_id;
END;
$$;

-- ── Verification ──────────────────────────────────────────────────────────
-- SELECT * FROM reserve_storage('<any-existing-workspace-id>', -1);
-- Expect: success=false, values unchanged — not a silent balance reduction.
