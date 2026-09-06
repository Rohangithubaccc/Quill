-- ── Migration 019: Campaigns ──────────────────────────────────────────────
--
-- Introduces "Campaign" as a first-class object that groups multiple
-- content pieces (across content types and platforms) under one
-- initiative — e.g. "Diwali 2026", "Series A Announcement", "Q3 Product
-- Launch". This is what turns Quill.AI from "generate one post at a time"
-- into "plan → create → approve → schedule → measure" as a connected
-- workflow, using tables that already exist (content_pieces,
-- calendar_events, content review/approval status) rather than
-- duplicating them.
--
-- Run AFTER: 018_byok_anthropic_key.sql
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: campaigns table
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS campaigns (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  description  TEXT,
  goal         TEXT,
  -- Free-text initiative tag, e.g. 'Product Launch', 'Seasonal', 'Funding
  -- Announcement', 'Hiring'. Intentionally not an enum — companies invent
  -- new campaign types constantly and a CHECK constraint would just get
  -- migrated around every few months.
  status       TEXT        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','active','completed','archived')),
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status    ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates      ON campaigns(start_date, end_date);

-- update_updated_at() already exists (created in 001_initial_schema.sql,
-- reused by content_pieces) — reuse it here rather than redefining it.
DROP TRIGGER IF EXISTS campaigns_updated_at ON campaigns;
CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Reuses is_workspace_member() / is_workspace_owner_or_admin(), both
-- defined in 001_initial_schema.sql and already used by every other
-- workspace-scoped table — same tenant-isolation guarantee as everything
-- else, nothing new to audit.
DROP POLICY IF EXISTS "members_can_read_campaigns" ON campaigns;
CREATE POLICY "members_can_read_campaigns"
  ON campaigns FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_insert_campaigns" ON campaigns;
CREATE POLICY "members_can_insert_campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_update_campaigns" ON campaigns;
CREATE POLICY "members_can_update_campaigns"
  ON campaigns FOR UPDATE
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "owners_admins_can_delete_campaigns" ON campaigns;
CREATE POLICY "owners_admins_can_delete_campaigns"
  ON campaigns FOR DELETE
  USING (is_workspace_owner_or_admin(workspace_id));

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: link content_pieces to campaigns
-- ════════════════════════════════════════════════════════════════════════════
--
-- Nullable and ON DELETE SET NULL — a piece is never required to belong
-- to a campaign, and deleting a campaign never deletes its content.

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cp_campaign ON content_pieces(campaign_id);

-- ── Verification queries ─────────────────────────────────────────────────
--
-- 1. Confirm campaigns exists with RLS enabled:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'campaigns';
--
-- 2. Confirm content_pieces.campaign_id was added:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'content_pieces' AND column_name = 'campaign_id';
