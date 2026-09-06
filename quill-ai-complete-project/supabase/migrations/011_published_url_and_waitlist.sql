-- ── Migration 011: published_url, waitlist, and schema clean-ups ─────────────
--
-- Run order: after 010_job_results.sql
-- Run: supabase db push  (or paste into Supabase dashboard SQL editor)
--
-- ── Note on migration 005 numbering ──────────────────────────────────────────
-- Two files were created with the 005 prefix in different sessions:
--   005_stripe_idempotency.sql   — REAL migration (creates stripe_events table)
--   005_email_verification.sql  — CONFIG GUIDE ONLY (no schema changes)
-- Both are safe. The email verification file is a documentation-only file;
-- rename or delete it to avoid confusion in migration tooling.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add published_url to content_pieces ────────────────────────────────────
-- Stores the live URL of the published post (blog URL, LinkedIn post link, etc.)
-- Used by the GSC performance panel to look up keyword rankings.
-- NULL = not yet published or URL not tracked.
ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS published_url TEXT;

-- Index for "show all published pieces with a URL" queries
CREATE INDEX IF NOT EXISTS content_pieces_published_url_idx
  ON content_pieces(workspace_id)
  WHERE published_url IS NOT NULL AND status = 'published';

-- ── 2. Create waitlist table ──────────────────────────────────────────────────
-- Used by the settings page waitlist modal (HubSpot, Mailchimp, Hootsuite, Medium).
-- When a user clicks "Join Waitlist" for an integration not yet built,
-- their email is inserted here.
CREATE TABLE IF NOT EXISTS waitlist (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  provider     TEXT        NOT NULL,
  -- provider values match INTEGRATIONS_META: 'hubspot' | 'mailchimp' | 'hootsuite' | 'medium'
  workspace_id UUID        REFERENCES workspaces(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One entry per email per provider — prevents duplicate signups on repeated clicks
  UNIQUE(email, provider)
);

CREATE INDEX IF NOT EXISTS waitlist_provider_idx ON waitlist(provider);
CREATE INDEX IF NOT EXISTS waitlist_created_idx  ON waitlist(created_at DESC);

-- No RLS needed — this table is only written by authenticated users via their
-- workspace client (anon key + RLS on other tables prevents cross-workspace reads).
-- The insert is fire-and-forget from the browser; we read it externally for marketing.
-- Enable RLS with a permissive insert policy so the browser client can write:
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_users_can_join_waitlist"
  ON waitlist FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Admins/founders read the full waitlist via service_role (bypasses RLS).
-- No SELECT policy needed for the app itself.

-- ── 3. Add published_url to the PATCH API ────────────────────────────────────
-- This migration enables the content/route.ts PATCH to accept published_url.
-- The route already handles it — this comment documents the contract.
--
-- PATCH /api/content/{id}
-- Body: { published_url: "https://yourblog.com/post-slug" }
-- Sets the canonical URL after publishing. The GSC panel reads this field.
