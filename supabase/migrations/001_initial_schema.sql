-- ============================================================
-- Quill.AI — Initial Schema Migration
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. workspaces ─────────────────────────────────────────
CREATE TABLE workspaces (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  slug                   TEXT UNIQUE NOT NULL,
  plan                   TEXT NOT NULL DEFAULT 'starter'
                           CHECK (plan IN ('starter','growth','agency','cancelled')),
  usage_count            INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  usage_limit            INTEGER NOT NULL DEFAULT 4  CHECK (usage_limit >= 0),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  brand_voice            TEXT,
  industry               TEXT,
  logo_url               TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_slug          ON workspaces(slug);
CREATE INDEX idx_workspaces_stripe_cust   ON workspaces(stripe_customer_id);
CREATE INDEX idx_workspaces_stripe_sub    ON workspaces(stripe_subscription_id);

-- RLS is enabled here, but the policies themselves (which call
-- is_workspace_member()/is_workspace_owner_or_admin()) are added further
-- down, once workspace_members exists and those functions can be created.
-- A LANGUAGE sql function's body is resolved against the catalog at
-- CREATE FUNCTION time, so it cannot forward-reference a table that's
-- defined later in the same script — RLS on this table stays enabled
-- with zero policies (default-deny) for the few statements in between,
-- which is the safe direction to fail in.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- ── 2. workspace_members ──────────────────────────────────
CREATE TABLE workspace_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'member'
                   CHECK (role IN ('owner','admin','editor','viewer')),
  invited_email  TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','invited','suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_wm_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_wm_user      ON workspace_members(user_id);
CREATE INDEX idx_wm_status    ON workspace_members(status);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- ── Helper functions used by all RLS policies ─────────────
-- Defined here, not at the top of the file: LANGUAGE sql functions are
-- resolved against the catalog at CREATE FUNCTION time, so workspace_members
-- must exist first. (An earlier version of this file defined these before
-- any table existed, which fails on a genuinely fresh database — caught by
-- actually running this migration against Postgres rather than only
-- reading it.)
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_workspace_owner_or_admin(ws_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner','admin')
      AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Now that the functions exist, add the policies for both tables above.

CREATE POLICY "workspace_members_can_read"
  ON workspaces FOR SELECT
  USING (is_workspace_member(id));

CREATE POLICY "workspace_owners_can_update"
  ON workspaces FOR UPDATE
  USING (is_workspace_owner_or_admin(id));

CREATE POLICY "members_can_read_own_workspace_members"
  ON workspace_members FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "owners_can_insert_members"
  ON workspace_members FOR INSERT
  WITH CHECK (is_workspace_owner_or_admin(workspace_id));

CREATE POLICY "owners_can_update_members"
  ON workspace_members FOR UPDATE
  USING (is_workspace_owner_or_admin(workspace_id));

CREATE POLICY "owners_can_delete_members"
  ON workspace_members FOR DELETE
  USING (is_workspace_owner_or_admin(workspace_id));

-- ── 3. content_pieces ─────────────────────────────────────
CREATE TABLE content_pieces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title            TEXT,
  content          TEXT,
  industry         TEXT,
  content_type     TEXT,
  tone             TEXT,
  keyword          TEXT,
  target_audience  TEXT,
  word_count       INTEGER,
  platforms        TEXT[],
  brand_voice      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','review','approved','scheduled','published','rejected')),
  engagement_score NUMERIC(4,2),
  metadata         JSONB DEFAULT '{}',
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cp_workspace   ON content_pieces(workspace_id);
CREATE INDEX idx_cp_created_by  ON content_pieces(created_by);
CREATE INDEX idx_cp_status      ON content_pieces(status);
CREATE INDEX idx_cp_deleted     ON content_pieces(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_cp_created_at  ON content_pieces(created_at DESC);
CREATE INDEX idx_cp_fts         ON content_pieces
  USING GIN(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_pieces_updated_at
  BEFORE UPDATE ON content_pieces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE content_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_content"
  ON content_pieces FOR SELECT
  USING (is_workspace_member(workspace_id) AND deleted_at IS NULL);

CREATE POLICY "members_can_insert_content"
  ON content_pieces FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "members_can_update_content"
  ON content_pieces FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "owners_can_delete_content"
  ON content_pieces FOR DELETE
  USING (is_workspace_owner_or_admin(workspace_id));

-- ── 4. content_versions ───────────────────────────────────
CREATE TABLE content_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id     UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content        TEXT NOT NULL,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(content_id, version_number)
);

CREATE INDEX idx_cv_content_id ON content_versions(content_id);

ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_versions"
  ON content_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content_pieces cp
      WHERE cp.id = content_id
        AND is_workspace_member(cp.workspace_id)
    )
  );

CREATE POLICY "members_can_insert_versions"
  ON content_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM content_pieces cp
      WHERE cp.id = content_id
        AND is_workspace_member(cp.workspace_id)
    )
  );

-- ── 5. calendar_events ────────────────────────────────────
CREATE TABLE calendar_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id   UUID REFERENCES content_pieces(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  platform     TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('draft','scheduled','published','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ce_workspace     ON calendar_events(workspace_id);
CREATE INDEX idx_ce_scheduled_at  ON calendar_events(scheduled_at);
CREATE INDEX idx_ce_content_id    ON calendar_events(content_id);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_calendar"
  ON calendar_events FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "members_can_insert_calendar"
  ON calendar_events FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "members_can_update_calendar"
  ON calendar_events FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "members_can_delete_calendar"
  ON calendar_events FOR DELETE
  USING (is_workspace_member(workspace_id));

-- ── 6. comments ───────────────────────────────────────────
CREATE TABLE comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (length(body) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_content_id ON comments(content_id);
CREATE INDEX idx_comments_user_id    ON comments(user_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_comments"
  ON comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content_pieces cp
      WHERE cp.id = content_id
        AND is_workspace_member(cp.workspace_id)
    )
  );

CREATE POLICY "members_can_insert_comments"
  ON comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM content_pieces cp
      WHERE cp.id = content_id
        AND is_workspace_member(cp.workspace_id)
    )
  );

CREATE POLICY "authors_can_delete_own_comments"
  ON comments FOR DELETE
  USING (auth.uid() = user_id);

-- ── 7. integrations ───────────────────────────────────────
CREATE TABLE integrations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL
                 CHECK (provider IN ('wordpress','buffer','hubspot','mailchimp','hootsuite')),
  config       JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'disconnected'
                 CHECK (status IN ('connected','disconnected','error')),
  connected_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, provider)
);

CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_integrations"
  ON integrations FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "owners_can_manage_integrations"
  ON integrations FOR ALL
  USING (is_workspace_owner_or_admin(workspace_id));

-- ── 8. performance_events ─────────────────────────────────
CREATE TABLE performance_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
               CHECK (event_type IN ('view','click','share','like','comment','conversion')),
  platform   TEXT,
  metadata   JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pe_content_id   ON performance_events(content_id);
CREATE INDEX idx_pe_occurred_at  ON performance_events(occurred_at DESC);
CREATE INDEX idx_pe_event_type   ON performance_events(event_type);

ALTER TABLE performance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_performance"
  ON performance_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM content_pieces cp
      WHERE cp.id = content_id
        AND is_workspace_member(cp.workspace_id)
    )
  );

-- Public insert (tracking pixel — no auth required)
CREATE POLICY "anyone_can_insert_events"
  ON performance_events FOR INSERT
  WITH CHECK (true);

-- ── 9. generation_logs ────────────────────────────────────
CREATE TABLE generation_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id   UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  content_id     UUID REFERENCES content_pieces(id) ON DELETE SET NULL,
  model          TEXT NOT NULL,
  input_tokens   INTEGER DEFAULT 0,
  output_tokens  INTEGER DEFAULT 0,
  cost_usd       NUMERIC(10,6) DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gl_workspace   ON generation_logs(workspace_id);
CREATE INDEX idx_gl_user        ON generation_logs(user_id);
CREATE INDEX idx_gl_created_at  ON generation_logs(created_at DESC);

ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_can_read_logs"
  ON generation_logs FOR SELECT
  USING (is_workspace_owner_or_admin(workspace_id));

-- Service role inserts — no policy needed (service_role bypasses RLS)

-- ── 10. analyzer_cache ────────────────────────────────────
CREATE TABLE analyzer_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  range        TEXT NOT NULL,
  data         JSONB NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, platform, range)
);

CREATE INDEX idx_ac_workspace  ON analyzer_cache(workspace_id);
CREATE INDEX idx_ac_expires    ON analyzer_cache(expires_at);

ALTER TABLE analyzer_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_cache"
  ON analyzer_cache FOR SELECT
  USING (is_workspace_member(workspace_id));

-- ── 11. waitlist ──────────────────────────────────────────
CREATE TABLE waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  provider   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public insert — no RLS needed
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_can_join_waitlist"
  ON waitlist FOR INSERT
  WITH CHECK (true);

-- ── Storage bucket (run via Supabase dashboard or CLI) ────
-- supabase storage create brand-assets --public false
-- Add policy: workspace members can upload/read their own folder
