-- ── Migration 028: GDPR/DPDP account deletion (soft-delete, 30-day grace) ────
--
-- Fixes the "Critical — found, not fixed" item from the pre-launch risk
-- audit: Settings called /api/gdpr/export and /api/gdpr/delete while
-- displaying "GDPR / DPDP Act 2023 compliant" to real users, but neither
-- route existed anywhere in the codebase.
--
-- Deletion semantics (confirmed with product owner before building):
--   - Soft-delete with a 30-day grace period, not instant hard delete.
--   - An active Stripe subscription blocks the request — the owner must
--     cancel billing first, deletion does NOT auto-cancel it for them.
--   - Only the workspace owner can request deletion.
--   - Cancellable any time before the purge date.
--
-- Almost every workspace-scoped table already has
-- `workspace_id ... REFERENCES workspaces(id) ON DELETE CASCADE` (checked
-- every migration, not assumed) — so the actual purge, once the grace
-- period elapses, is a single `DELETE FROM workspaces`. The two tables
-- that intentionally use ON DELETE SET NULL instead (generation_logs,
-- waitlist) hold anonymized analytics / low-sensitivity signup data, not
-- personal content — left as-is on purpose, not an oversight.
--
-- Run AFTER: 027_storage_quota.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS throughout.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_purge_at    TIMESTAMPTZ;

-- Used by the daily purge cron (src/app/api/cron/purge-deleted-workspaces)
-- to cheaply find due workspaces without scanning the whole table. Partial
-- index — only rows actually pending deletion are indexed, which is a
-- tiny fraction of all workspaces in practice.
CREATE INDEX IF NOT EXISTS idx_workspaces_scheduled_purge
  ON workspaces(scheduled_purge_at)
  WHERE scheduled_purge_at IS NOT NULL;

-- ── Verification queries ─────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'workspaces' AND column_name LIKE '%deletion%' OR column_name LIKE '%purge%';
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_workspaces_scheduled_purge';
