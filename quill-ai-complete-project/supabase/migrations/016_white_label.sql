-- ── Migration 016: white-label and custom domains (Agency tier) ───────────────
--
-- Adds branding override columns to workspaces and a domains table for
-- custom domain configuration via Vercel's Projects API.
--
-- Access restrictions:
--   - white_label_enabled can only be set to true by the Stripe webhook
--     when plan = 'agency', or manually by the workspace owner.
--   - The domains table RLS policy enforces plan = 'agency' at the DB level.
--
-- Run AFTER: 015_webhooks.sql

-- ── Branding overrides on workspaces ─────────────────────────────────────────
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS brand_primary_color TEXT    DEFAULT '#6c63ff',
  -- Hex color that replaces Quill.AI purple in white-label PDF exports
  ADD COLUMN IF NOT EXISTS brand_company_name  TEXT,
  -- Replaces "Quill.AI" in PDF headers, page titles, emails (null = 'Quill.AI')
  ADD COLUMN IF NOT EXISTS white_label_enabled BOOLEAN NOT NULL DEFAULT false;
  -- Master switch. Only meaningful for plan = 'agency'.

-- ── Custom domains ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS domains (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain           TEXT        NOT NULL,
  -- e.g. 'content.theiragency.com' — must be a subdomain, not a root domain
  status           TEXT        NOT NULL DEFAULT 'pending',
  -- 'pending' → 'verifying' → 'active' | 'failed'
  vercel_domain_id TEXT,
  -- The domain name as registered in Vercel (same as domain, used as identifier)
  verification_txt TEXT,
  -- TXT record value for DNS verification (shown to user in settings)
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(workspace_id),   -- one custom domain per workspace
  UNIQUE(domain)          -- a domain can only be registered to one workspace
);

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;

-- Only agency plan workspace owners can manage custom domains
CREATE POLICY "agency_owners_manage_domains"
  ON domains FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.workspace_id = domains.workspace_id
        AND wm.user_id      = auth.uid()
        AND wm.role         = 'owner'
        AND wm.status       = 'active'
        AND w.plan          = 'agency'
    )
  );

CREATE INDEX IF NOT EXISTS domains_workspace_idx ON domains(workspace_id);
CREATE INDEX IF NOT EXISTS domains_status_idx    ON domains(status) WHERE status != 'active';

-- updated_at trigger
DROP TRIGGER IF EXISTS domains_updated_at ON domains;
CREATE TRIGGER domains_updated_at
  BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Note: set_updated_at() was created in migration 010_job_results.sql.
-- If running this migration standalone, add:
-- CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
