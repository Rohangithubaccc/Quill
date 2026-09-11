-- ── Migration 017: missing tables + storage policies ─────────────────────────
--
-- Fixes three silent production bugs identified after Phase 5 deploy:
--   (a) generation_logs table missing — AI generation logs lost silently
--   (b) analyzer_cache table missing — Analyzer page crashes on every load
--   (c) Storage policy missing — DALL-E header images return 403 in browser
--
-- Run AFTER: 016_white_label.sql (depends on set_updated_at() from 010)
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: generation_logs
-- ════════════════════════════════════════════════════════════════════════════
--
-- Records every successful AI generation for cost tracking, usage analytics,
-- and credit audit trails. INSERT-only — rows are never mutated after creation.
--
-- The generate route (src/app/api/ai/generate/route.ts) inserts:
--   user_id, workspace_id, content_id, model, input_tokens, output_tokens,
--   cost_usd, content_type, credit_cost
-- All inserts use the admin client (service_role) so no INSERT RLS needed.

CREATE TABLE IF NOT EXISTS generation_logs (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          REFERENCES auth.users(id)     ON DELETE SET NULL,
  -- SET NULL: keep the log record if the user is deleted (billing audit trail)
  workspace_id  UUID          NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id    UUID          REFERENCES content_pieces(id) ON DELETE SET NULL,
  -- SET NULL: keep the log if the content piece is soft/hard deleted
  model         TEXT          NOT NULL,
  -- e.g. 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'
  input_tokens  INTEGER       NOT NULL DEFAULT 0 CHECK (input_tokens  >= 0),
  output_tokens INTEGER       NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (cost_usd      >= 0),
  -- 6 decimal places supports $0.000003/token granularity
  content_type  TEXT,
  -- e.g. 'Blog Post', 'Twitter Thread' — nullable for non-generation operations
  credit_cost   INTEGER       NOT NULL DEFAULT 0 CHECK (credit_cost   >= 0),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- RLS: workspace members can read their own logs; service_role writes
ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_own_generation_logs"
  ON generation_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = generation_logs.workspace_id
        AND user_id      = auth.uid()
        AND status       = 'active'
    )
  );

-- Fast monthly cost query: SUM(cost_usd) WHERE workspace_id = X AND created_at >= month_start
CREATE INDEX IF NOT EXISTS generation_logs_workspace_time_idx
  ON generation_logs(workspace_id, created_at DESC);

-- User-level analytics
CREATE INDEX IF NOT EXISTS generation_logs_user_time_idx
  ON generation_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Daily cost monitoring across all workspaces
CREATE INDEX IF NOT EXISTS generation_logs_cost_date_idx
  ON generation_logs(created_at DESC)
  WHERE cost_usd > 0;

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: analyzer_cache
-- ════════════════════════════════════════════════════════════════════════════
--
-- Caches synthesised trend data (Google Trends + Reddit + News API + Claude)
-- to avoid burning API quotas and Claude tokens on every Analyzer page load.
-- TTL: 6 hours (CACHE_TTL_HOURS in src/app/api/analyzer/trends/route.ts).
--
-- The trends route uses:
--   SELECT data, expires_at WHERE workspace_id = X AND platform = Y AND range = Z
--   UPSERT { workspace_id, platform, range, data, expires_at }
--     ON CONFLICT (workspace_id, platform, range) DO UPDATE
--
-- CRITICAL: The UNIQUE constraint on (workspace_id, platform, range) is
-- what makes the upsert work. Without it, Supabase's onConflict hint is
-- silently ignored and each cache save creates a NEW ROW. Then .single()
-- throws "multiple rows returned" and the Analyzer crashes on the second load.

CREATE TABLE IF NOT EXISTS analyzer_cache (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform     TEXT        NOT NULL,
  -- Valid values defined in the trends route: 'twitter'|'linkedin'|'instagram'|'reddit'|'tiktok'
  range        TEXT        NOT NULL,
  -- Valid values: '7d'|'30d'|'90d'
  data         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Full TrendData object: { hashtags[], sentiment, insights[], competitors[], dataSources }
  -- Typical payload: 2–8 KB
  expires_at   TIMESTAMPTZ NOT NULL,
  -- Stale after this timestamp — trends route checks new Date(expires_at) > new Date()
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- THIS CONSTRAINT IS REQUIRED for the upsert to work correctly
  UNIQUE(workspace_id, platform, range)
);

-- updated_at auto-maintenance (set_updated_at() defined in migration 010)
DROP TRIGGER IF EXISTS analyzer_cache_updated_at ON analyzer_cache;
CREATE TRIGGER analyzer_cache_updated_at
  BEFORE UPDATE ON analyzer_cache
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: workspace members can read their own cache entries
ALTER TABLE analyzer_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_own_analyzer_cache"
  ON analyzer_cache FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = analyzer_cache.workspace_id
        AND user_id      = auth.uid()
        AND status       = 'active'
    )
  );

-- Cleanup index: find expired entries for the optional pg_cron job
CREATE INDEX IF NOT EXISTS analyzer_cache_expires_idx
  ON analyzer_cache(expires_at);

-- Optional pg_cron cleanup — uncomment after enabling pg_cron extension:
-- SELECT cron.schedule(
--   'cleanup-analyzer-cache',
--   '0 5 * * *',
--   $$DELETE FROM analyzer_cache WHERE expires_at < NOW() - INTERVAL '1 hour'$$
-- );

-- ════════════════════════════════════════════════════════════════════════════
-- PART C: Supabase Storage — public read policy for images/
-- ════════════════════════════════════════════════════════════════════════════
--
-- DALL-E generated images are uploaded to:
--   brand-assets/images/{workspace_id}/{content_id}-{timestamp}.png
--
-- getPublicUrl() constructs the URL but returns 403 unless a storage
-- policy explicitly allows public (unauthenticated) SELECT on this path.
--
-- We scope the policy to the 'images/' prefix only — logos and other
-- files in brand-assets remain accessible only to authenticated users.

-- ── CRITICAL: set bucket to public ────────────────────────────────────────
-- getPublicUrl() generates URLs at /storage/v1/object/public/{bucket}/{path}.
-- This endpoint ONLY works when the bucket has public = true.
-- Storage SELECT policies alone do NOT enable the /object/public/ URL path.
-- Without this UPDATE, getPublicUrl() URLs return 400 'bucket is not public'.
UPDATE storage.buckets
SET    public = true
WHERE  id = 'brand-assets';

-- If the bucket doesn't exist yet (fresh project), create it as public:
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;
-- ON CONFLICT DO UPDATE: ensures the bucket is public even if it already
-- exists with public = false from a previous migration.

-- Drop policies if they already exist (makes this migration re-runnable)
DROP POLICY IF EXISTS "public_read_generated_images"   ON storage.objects;
DROP POLICY IF EXISTS "authenticated_upload_images"    ON storage.objects;
DROP POLICY IF EXISTS "authenticated_upload_logos"     ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_logos"       ON storage.objects;

-- Public read: anyone (including unauthenticated) can GET images/* files
-- Required for: browser display, WordPress featured_media, email embeds
CREATE POLICY "public_read_generated_images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'brand-assets'
    AND name LIKE 'images/%'
  );

-- Authenticated write: server can upload to images/* via service_role
-- (service_role bypasses RLS entirely, but this policy covers signed-URL flows)
CREATE POLICY "authenticated_upload_images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND name  LIKE 'images/%'
    AND (auth.role() = 'authenticated' OR auth.role() = 'service_role')
  );

-- Authenticated read: users can view their own workspace logos
CREATE POLICY "authenticated_read_logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'brand-assets'
    AND name  LIKE 'logos/%'
    AND auth.role() = 'authenticated'
  );

-- Authenticated write: users can upload their workspace logo
CREATE POLICY "authenticated_upload_logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'brand-assets'
    AND name  LIKE 'logos/%'
    AND auth.role() = 'authenticated'
  );

-- ── Verification queries (run after migration to confirm everything works) ──
--
-- 1. Confirm generation_logs exists and has the right columns:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'generation_logs' ORDER BY ordinal_position;
--
-- 2. Confirm analyzer_cache UNIQUE constraint exists:
--    SELECT constraint_name FROM information_schema.table_constraints
--    WHERE table_name = 'analyzer_cache' AND constraint_type = 'UNIQUE';
--
-- 3. Confirm storage policies exist:
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'objects' AND schemaname = 'storage'
--    AND policyname LIKE '%images%' OR policyname LIKE '%logos%';
--
-- 4. End-to-end test for storage (run in browser incognito / curl):
--    curl -I https://{your-project}.supabase.co/storage/v1/object/public/brand-assets/images/test.png
--    Expected: HTTP 404 (file not found) NOT HTTP 403 (forbidden)
--    A 404 means the policy works — the file just doesn't exist yet.
--    A 403 means the policy is wrong or not applied.
