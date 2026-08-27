-- ============================================================
-- Quill.AI Migration 004 — Email Tracking
-- Run in: Supabase Dashboard → SQL Editor
-- Depends on: 003_billing_and_gdpr.sql (must run first)
-- ============================================================
--
-- DEPENDENCY NOTE
-- ───────────────
-- The RLS policy at the bottom of this file calls
-- is_workspace_owner_or_admin(workspace_id). That function is
-- originally defined in 001_initial_schema.sql and is also
-- re-declared (via CREATE OR REPLACE) in 003_billing_and_gdpr.sql.
--
-- Run order: 001 → 002 → 003 → 004
--
-- If you need to run this file on an isolated database (e.g. a
-- fresh staging environment), run 003 first — it contains the
-- safety-net CREATE OR REPLACE for both RLS helper functions.
-- ============================================================

CREATE TABLE IF NOT EXISTS sent_emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email_type   TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_workspace ON sent_emails(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_type_sent ON sent_emails(email_type, sent_at DESC);

-- Internal use only: the cron route and email delivery code insert
-- rows using the service_role key, which bypasses RLS entirely.
-- No INSERT policy is required.
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;

-- Owners and admins can read the email audit log for their workspace.
-- Requires: is_workspace_owner_or_admin() — defined in migration 001
-- and re-declared as a safety-net in migration 003.
CREATE POLICY "owners_can_read_sent_emails"
  ON sent_emails FOR SELECT
  USING (is_workspace_owner_or_admin(workspace_id));
