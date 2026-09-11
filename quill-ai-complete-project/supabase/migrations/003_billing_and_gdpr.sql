-- ============================================================
-- Quill.AI Migration 003 — Billing Columns + GDPR Tables
-- Run in: Supabase Dashboard → SQL Editor
-- Depends on: 001_initial_schema.sql (must run first)
-- ============================================================

-- ── Safety-net function definitions ───────────────────────────────────────
--
-- Both functions are originally defined in migration 001. They are repeated
-- here with CREATE OR REPLACE so that:
--
--   a) This migration runs safely even if 001 was only partially applied
--      (e.g. tables exist but the function definitions were rolled back).
--   b) Running this migration twice is fully idempotent — OR REPLACE
--      never errors on re-execution.
--   c) The RLS policy on usage_overages below cannot fail with
--      "function does not exist" regardless of execution order.
--
-- If 001 ran cleanly, these two statements are effective no-ops:
-- Postgres replaces the function with an identical definition and
-- leaves all dependent objects (policies, triggers, indexes) intact.

CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id      = auth.uid()
      AND status       = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_workspace_owner_or_admin(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id      = auth.uid()
      AND role         IN ('owner', 'admin')
      AND status       = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── Trial and subscription status columns on workspaces ───────────────────
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS trial_ends_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status  TEXT
    DEFAULT 'trialing'
    CHECK (subscription_status IN (
      'trialing', 'active', 'past_due', 'cancelled', 'incomplete', 'paused'
    ));

-- ── Usage overages — every blocked generation attempt is logged ───────────
CREATE TABLE IF NOT EXISTS usage_overages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  plan         TEXT NOT NULL,
  usage_count  INTEGER NOT NULL,
  usage_limit  INTEGER NOT NULL,
  content_type TEXT,
  industry     TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overages_workspace ON usage_overages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_overages_attempted ON usage_overages(attempted_at DESC);

ALTER TABLE usage_overages ENABLE ROW LEVEL SECURITY;

-- Owners and admins can read blocked-attempt logs for their workspace.
-- is_workspace_owner_or_admin() is guaranteed to exist via the
-- safety-net definitions above.
CREATE POLICY "owners_can_read_overages"
  ON usage_overages FOR SELECT
  USING (is_workspace_owner_or_admin(workspace_id));

-- Service role inserts bypass RLS — no INSERT policy needed.
