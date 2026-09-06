-- ============================================================
-- Quill.AI Migration 002 — Workspace Invites + Full-Text Search
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Full-text search generated column on content_pieces ───────────────────
ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(content, '') || ' ' ||
      coalesce(keyword, '') || ' ' ||
      coalesce(industry, '') || ' ' ||
      coalesce(content_type, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_cp_fts
  ON content_pieces USING GIN(fts);

-- ── Workspace invites table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'editor'
                 CHECK (role IN ('admin', 'editor', 'viewer')),
  token        TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_invites_token     ON workspace_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email     ON workspace_invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_status    ON workspace_invites(status);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_can_manage_invites"
  ON workspace_invites FOR ALL
  USING (is_workspace_owner_or_admin(workspace_id));

-- Allow anyone to read an invite by token (needed for the accept page)
CREATE POLICY "anyone_can_read_invite_by_token"
  ON workspace_invites FOR SELECT
  USING (true);
