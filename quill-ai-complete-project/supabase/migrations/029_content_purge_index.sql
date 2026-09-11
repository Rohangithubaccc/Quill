-- ── Migration 029: index for the soft-deleted-content purge cron ────────────
--
-- Closes a real gap, not a hypothetical one: content_pieces.deleted_at
-- (migration 001) makes deletion soft — the row and its header_image_url
-- (a real Storage file) persist indefinitely. There was no mechanism to
-- ever actually reclaim that space, so the storage quota (migration 027)
-- was correct to keep counting it — but nothing existed to eventually
-- free it either. See src/app/api/cron/purge-deleted-content for the
-- actual purge job this index supports.
--
-- The existing idx_cp_deleted (migration 001) only covers
-- `WHERE deleted_at IS NULL` — the opposite of what this cron needs
-- (`WHERE deleted_at IS NOT NULL AND deleted_at <= <cutoff>`), so it does
-- nothing for this query. A separate partial index, not a replacement.
--
-- Run AFTER: 028_gdpr_deletion.sql
-- Safe to re-run: CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_cp_deleted_pending_purge
  ON content_pieces(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── Verification ──────────────────────────────────────────────────────────
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_cp_deleted_pending_purge';
