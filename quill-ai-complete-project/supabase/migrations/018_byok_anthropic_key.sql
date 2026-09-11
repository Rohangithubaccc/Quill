-- ── Migration 018: BYOK (Bring Your Own Key) columns on workspaces ───────────
--
-- Lets a workspace owner supply their own Anthropic API key so generation
-- calls run against the customer's own Anthropic account instead of
-- Quill.AI's platform key. Hybrid model: the platform key remains the
-- default for every workspace; BYOK is strictly opt-in via
-- use_own_anthropic_key, so adding a key does not silently switch billing.
--
-- The key itself is never stored in plaintext — it's encrypted with the
-- same AES-256-GCM helper (src/lib/utils.ts: encrypt()/decrypt()) already
-- used for WordPress, Buffer, LinkedIn, and GSC integration credentials.
--
-- Run AFTER: 017_missing_tables_and_storage.sql
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: workspaces columns
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS anthropic_api_key_encrypted TEXT,
  -- encrypt(apiKey) ciphertext — same "iv:ciphertext" hex format as other
  -- integration credentials. NULL when no BYOK key has been added.
  ADD COLUMN IF NOT EXISTS use_own_anthropic_key BOOLEAN NOT NULL DEFAULT false,
  -- Explicit opt-in switch. A workspace can have a validated key on file
  -- (anthropic_api_key_encrypted IS NOT NULL) while this stays false —
  -- e.g. immediately after removing/pausing BYOK without deleting the key.
  ADD COLUMN IF NOT EXISTS anthropic_key_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anthropic_key_last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anthropic_key_last_error TEXT,
  ADD COLUMN IF NOT EXISTS anthropic_key_last_error_at TIMESTAMPTZ;
  -- Populated by recordByokError() (src/lib/anthropic-byok.ts) when a BYOK
  -- call fails (e.g. customer's key was revoked). Surfaced in
  -- Settings → API Keys so the owner knows generation silently fell back
  -- to the platform key rather than failing the request outright.

-- Never expose the ciphertext (or per-workspace error detail) through the
-- workspace select used across the app (src/lib/supabase/server.ts:
-- requireWorkspace()) — that query intentionally does not include these
-- columns. Only src/lib/anthropic-byok.ts and the
-- /api/workspace/byok route below should ever SELECT
-- anthropic_api_key_encrypted.

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: BYOK usage log (optional audit trail — mirrors generation_logs)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tracks whether each generation ran on the platform key or the
-- workspace's own key, so cost dashboards and support can tell them apart.
-- INSERT-only, written from the same call sites as generation_logs.

CREATE TABLE IF NOT EXISTS byok_usage_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  used_byok    BOOLEAN     NOT NULL,
  -- true  = ran on the workspace's own Anthropic key
  -- false = fell back to the platform key (BYOK key missing/invalid/error)
  fallback_reason TEXT,
  -- NULL when used_byok = true; e.g. 'no_key', 'decrypt_failed', 'auth_error'
  -- when used_byok = false but the workspace has use_own_anthropic_key = true
  route        TEXT        NOT NULL,
  -- e.g. 'ai/generate', 'ai/humanize', 'ai/repurpose', 'analyzer/trends'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE byok_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_own_byok_usage_log"
  ON byok_usage_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = byok_usage_log.workspace_id
        AND user_id      = auth.uid()
        AND status       = 'active'
    )
  );

CREATE INDEX IF NOT EXISTS byok_usage_log_workspace_time_idx
  ON byok_usage_log(workspace_id, created_at DESC);

-- ── Verification queries ─────────────────────────────────────────────────
--
-- 1. Confirm the new workspaces columns exist:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'workspaces' AND column_name LIKE 'anthropic_key%'
--       OR column_name LIKE 'anthropic_api_key%' OR column_name = 'use_own_anthropic_key';
--
-- 2. Confirm byok_usage_log exists with RLS enabled:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'byok_usage_log';
