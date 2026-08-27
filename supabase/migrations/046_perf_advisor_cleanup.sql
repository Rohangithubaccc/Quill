-- ── Migration 046: two small fixes from the live performance advisor scan ───
--
-- Found via get_advisors(type: 'performance') during live-infrastructure
-- testing. Both are small, safe, and unambiguous — bundled together the
-- same way migration 037 bundled its two small schema-only fixes.
--
-- Run AFTER: 045_pin_function_search_paths.sql

-- ── Part 1: one more unindexed FK, same class migration 037 fixed ────────
--
-- content_piece_assets.asset_id (migration 024) was missed by 037's
-- otherwise-exhaustive FK-index sweep — that migration covered ten FK
-- columns but this many-to-many join table wasn't among them.
-- content_piece_assets_content_id_fkey already has its PK-covering index
-- (content_id is the first column of the composite PRIMARY KEY); asset_id
-- alone had nothing, so `DELETE FROM assets WHERE id = ...` has to scan
-- this join table fully to find rows to cascade.

CREATE INDEX IF NOT EXISTS idx_content_piece_assets_asset_id
  ON content_piece_assets(asset_id);

-- ── Part 2: duplicate index on analyzer_cache ─────────────────────────────
--
-- idx_ac_expires (migration 001) and analyzer_cache_expires_idx
-- (migration 017) are identical — same table, same column, same
-- definition — created independently in two different migrations that
-- didn't know about each other. Harmless but pure waste: every INSERT/
-- UPDATE on analyzer_cache maintains both for zero added query benefit.
-- Keeping idx_ac_expires (the older, migration-001 name) and dropping the
-- later duplicate.

DROP INDEX IF EXISTS analyzer_cache_expires_idx;

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT indexname FROM pg_indexes WHERE tablename = 'content_piece_assets';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'analyzer_cache' AND indexdef ILIKE '%expires_at%';
--   -- second query should return exactly one row (idx_ac_expires only)
