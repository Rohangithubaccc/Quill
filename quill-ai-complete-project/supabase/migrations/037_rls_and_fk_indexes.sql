-- ── Migration 037: stripe_events RLS + missing FK indexes ───────────────────
--
-- Found during a full quality-check pass, not a load-test session. Two
-- unrelated fixes bundled here since both are small, schema-only, and
-- came out of the same review.
--
-- Run AFTER: 036_atomic_email_dedup.sql

-- ── Part 1: stripe_events had no RLS at all ──────────────────────────────
--
-- This table is only ever touched by service_role (the webhook handler
-- uses createSupabaseAdmin(), which bypasses RLS by role attribute, not
-- by policy) — nothing about its intended access pattern needs
-- anon/authenticated to reach it directly. But Supabase's platform-level
-- default grants (GRANT ALL ON TABLES TO anon, authenticated,
-- service_role, applied automatically at project creation, outside any
-- migration file) mean that without RLS, ANY logged-in user of ANY
-- workspace can query this table directly via the client API and see
-- every Stripe event_id/event_type processed for every workspace on the
-- platform, not just their own. Confirmed empirically: seeded a row,
-- queried it as an ordinary authenticated user with no special
-- privileges, got the row back.
--
-- The data itself isn't sensitive (no amounts, no card details — just an
-- idempotency ledger), but it's still an unrestricted read of internal
-- system state that should never be reachable from the public API
-- surface. Fixed by enabling RLS with zero policies: RLS defaults to
-- deny-all once enabled, and since nothing legitimate ever reads this
-- table as anon/authenticated, zero policies is correct, not incomplete.
-- service_role continues to work exactly as before (RLS never applies to
-- it regardless of policies).

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicitly revoke the broad grants too, rather
-- than relying on "zero policies" alone to be the only thing standing
-- between this table and the public API. Matches the same
-- REVOKE-then-selectively-GRANT pattern already used in
-- 030_fix_rls_privilege_escalation.sql.
REVOKE ALL ON stripe_events FROM anon, authenticated;

-- ── Part 2: FK columns with no covering index ────────────────────────────
--
-- Ten FK columns had no index. Most are "who did this" audit columns
-- (created_by / uploaded_by / actor_user_id / invited_by) that are
-- queried far less often than by workspace_id (which is indexed) — low
-- priority, added here for completeness rather than urgency.
--
-- generation_logs.content_id is the one that actually matters: its FK
-- action is ON DELETE SET NULL, which — same as CASCADE — requires
-- Postgres to locate every matching row when the referenced
-- content_pieces row is deleted. Without an index that's a full
-- sequential scan of generation_logs (which logs every single AI
-- generation call, plausibly one of the largest tables in the schema
-- over time) on every content deletion — both user-driven deletes and
-- the purge-deleted-content cron (035_purge_claim.sql) hit this
-- routinely, not as an edge case.

CREATE INDEX IF NOT EXISTS idx_generation_logs_content_id  ON generation_logs(content_id);
CREATE INDEX IF NOT EXISTS idx_approval_history_actor      ON approval_history(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_asset_folders_created_by    ON asset_folders(created_by);
CREATE INDEX IF NOT EXISTS idx_assets_uploaded_by          ON assets(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by        ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_content_versions_created_by ON content_versions(created_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_uploaded_by  ON knowledge_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_usage_overages_user_id      ON usage_overages(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_deletion_req_by  ON workspaces(deletion_requested_by);
-- workspace_invites.invited_by is the one other CASCADE (not SET NULL)
-- among these ten — same scan-on-delete exposure, triggered when a user
-- who has ever sent an invite is deleted.
CREATE INDEX IF NOT EXISTS idx_workspace_invites_invited_by ON workspace_invites(invited_by);

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'stripe_events'; -- t
--   SELECT indexname FROM pg_indexes WHERE tablename = 'generation_logs';
