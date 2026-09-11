-- ── Migration 025: Multi-stage approval chains + audit history ─────────────
--
-- Extends the existing single-gate review flow (content_pieces.status:
-- draft/review/needs_revision/approved/rejected/scheduled/published) with
-- an OPTIONAL, per-workspace-configurable ordered chain — e.g.
-- Writer -> Editor -> Brand -> Legal -> Marketing Head -> Publish.
--
-- Backward compatible by design: a workspace with zero configured stages
-- keeps working exactly as before (plain review -> approved). The chain
-- only activates for workspaces that define stages, so existing
-- workspaces aren't forced into a heavier process they didn't ask for.
--
-- Run AFTER: 024_dam.sql
-- Safe to re-run: uses IF NOT EXISTS throughout.

-- ════════════════════════════════════════════════════════════════════════════
-- PART 0: fix a pre-existing bug — 'needs_revision' was never actually
-- allowed by the database
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 009_comments_enhancement.sql documented 'needs_revision' as a
-- valid content_pieces.status value in a comment, and the application's
-- Zod validation (src/app/api/content/route.ts) has accepted it ever
-- since — but the actual CHECK constraint was never updated to match.
-- Confirmed by testing the real rejection flow end-to-end against a real
-- Postgres database rather than only reading the code: the UPDATE
-- statement fails outright with "violates check constraint
-- content_pieces_status_check" the moment anyone actually tries to set
-- this status — meaning the existing single-review-gate "Needs Revision"
-- action (and this migration's own approval-chain rejection flow, which
-- also sets this status) has been silently broken since 009, however
-- long ago that was.

ALTER TABLE content_pieces DROP CONSTRAINT IF EXISTS content_pieces_status_check;
ALTER TABLE content_pieces ADD CONSTRAINT content_pieces_status_check
  CHECK (status = ANY (ARRAY['draft', 'review', 'needs_revision', 'approved', 'scheduled', 'published', 'rejected']));

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: workspace_approval_stages — the configured chain, per workspace
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workspace_approval_stages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stage_index   INTEGER     NOT NULL,
  name          TEXT        NOT NULL,
  required_role TEXT        NOT NULL DEFAULT 'admin'
                  CHECK (required_role IN ('owner', 'admin', 'editor')),
  -- The minimum role that can approve AT this stage. 'owner' can approve
  -- at any stage regardless of this setting — see is_workspace_owner_or_admin
  -- usage in the approval API routes, not enforced at the DB layer here.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, stage_index)
);

CREATE INDEX IF NOT EXISTS idx_was_workspace ON workspace_approval_stages(workspace_id);

ALTER TABLE workspace_approval_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_approval_stages" ON workspace_approval_stages;
CREATE POLICY "members_can_read_approval_stages" ON workspace_approval_stages FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "owners_admins_can_manage_approval_stages" ON workspace_approval_stages;
CREATE POLICY "owners_admins_can_manage_approval_stages" ON workspace_approval_stages FOR ALL
  USING (is_workspace_owner_or_admin(workspace_id))
  WITH CHECK (is_workspace_owner_or_admin(workspace_id));

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: content_pieces gets a pointer into the chain
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS current_stage_index INTEGER;
  -- NULL = not currently in a configured multi-stage chain (either the
  -- workspace has none configured, or the piece hasn't entered review
  -- yet, or it already finished the chain and is now 'approved').

-- ════════════════════════════════════════════════════════════════════════════
-- PART C: approval_history — the audit trail
-- ════════════════════════════════════════════════════════════════════════════
--
-- One row per stage transition. stage_name is denormalized (copied at the
-- time of the action) rather than joined from workspace_approval_stages,
-- so the historical record stays accurate even if stages are later
-- renamed, reordered, or deleted — an audit trail that changes its own
-- past entries when config changes later isn't a real audit trail.

CREATE TABLE IF NOT EXISTS approval_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    UUID        NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stage_index   INTEGER,
  stage_name    TEXT,
  action        TEXT        NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected', 'sent_back')),
  actor_user_id UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ah_content   ON approval_history(content_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ah_workspace ON approval_history(workspace_id, created_at DESC);

ALTER TABLE approval_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_approval_history" ON approval_history;
CREATE POLICY "members_can_read_approval_history" ON approval_history FOR SELECT
  USING (is_workspace_member(workspace_id));

-- No direct INSERT policy for regular members — history rows are only
-- ever written by the approval API routes via the service_role admin
-- client (src/app/api/content/[id]/approval/*), which bypasses RLS. This
-- keeps the audit trail tamper-evident: nothing except that specific,
-- role-checked code path can add an entry.

-- ── Verification queries ─────────────────────────────────────────────────
-- SELECT relrowsecurity FROM pg_class WHERE relname IN ('workspace_approval_stages', 'approval_history');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'content_pieces' AND column_name = 'current_stage_index';
