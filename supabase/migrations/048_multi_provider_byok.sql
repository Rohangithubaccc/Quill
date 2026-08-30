-- ── Migration 048: multi-provider BYOK ───────────────────────────────────────
--
-- Generalizes BYOK from "bring your own Anthropic key" to "bring your own
-- key for any provider that speaks either the Anthropic Messages API or the
-- OpenAI-compatible chat-completions protocol." The latter covers OpenAI
-- itself, Google Gemini (official OpenAI-compatible endpoint at
-- generativelanguage.googleapis.com/v1beta/openai/), NVIDIA NIM, Groq,
-- Together AI, Fireworks, DeepSeek, Mistral, OpenRouter, and self-hosted
-- endpoints (vLLM, Ollama) — i.e. the large majority of commercially
-- available LLM APIs, without needing bespoke code per brand.
--
-- The database has zero real customers/workspaces yet (pre-launch), so this
-- is a clean replace rather than a data-preserving migration — no UPDATE
-- statements moving old values into new columns, because there is nothing
-- to move.
--
-- Every reference to the old columns was inventoried before dropping them:
-- src/app/api/workspace/byok/route.ts, src/lib/anthropic-byok.ts (both
-- rewritten alongside this migration), and a documentation comment in
-- src/app/api/gdpr/export/route.ts (text updated, no code change needed).
-- migration 018 itself is left untouched, per this project's append-only
-- migration convention — it's superseded here, not edited.
--
-- Run AFTER: 047_rls_performance_and_redundancy_cleanup.sql

ALTER TABLE workspaces
  DROP COLUMN IF EXISTS anthropic_api_key_encrypted,
  DROP COLUMN IF EXISTS use_own_anthropic_key,
  DROP COLUMN IF EXISTS anthropic_key_added_at,
  DROP COLUMN IF EXISTS anthropic_key_last_validated_at,
  DROP COLUMN IF EXISTS anthropic_key_last_error,
  DROP COLUMN IF EXISTS anthropic_key_last_error_at;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS use_own_ai_key             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS byok_provider               TEXT,
  ADD COLUMN IF NOT EXISTS byok_api_key_encrypted      TEXT,
  ADD COLUMN IF NOT EXISTS byok_base_url               TEXT,
  ADD COLUMN IF NOT EXISTS byok_model                  TEXT,
  ADD COLUMN IF NOT EXISTS byok_key_added_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_key_last_validated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS byok_key_last_error         TEXT,
  ADD COLUMN IF NOT EXISTS byok_key_last_error_at      TIMESTAMPTZ;

-- 'anthropic' uses the native Messages API (fixed endpoint, no base_url).
-- 'openai_compatible' is the generic path — covers every provider listed
-- above via a caller-supplied base_url. This CHECK plus the one below are
-- the actual mechanism behind "no error should be flagged" for whichever
-- model a customer brings: anthropic_byok_route no longer hard-validates
-- one specific key prefix (see the accompanying application-code rewrite);
-- the database only enforces that the *shape* of what's stored is
-- internally consistent, not which brand it came from.
ALTER TABLE workspaces ADD CONSTRAINT byok_provider_check
  CHECK (byok_provider IS NULL OR byok_provider IN ('anthropic', 'openai_compatible'));

-- openai_compatible requires a base_url (that's what makes it work for any
-- provider); anthropic must NOT set one (it always targets Anthropic's own
-- fixed endpoint — a stray base_url there would silently do nothing, which
-- is worse than not allowing it to be set at all).
ALTER TABLE workspaces ADD CONSTRAINT byok_base_url_matches_provider
  CHECK (
    byok_provider IS NULL
    OR (byok_provider = 'openai_compatible' AND byok_base_url IS NOT NULL)
    OR (byok_provider = 'anthropic' AND byok_base_url IS NULL)
  );

-- Track which provider a request actually used, for observability — the
-- existing byok_usage_log table (migration 018) already has workspace_id/
-- used_byok/fallback_reason/route; provider is the one genuinely new signal
-- worth capturing per-call now that there's more than one possible provider.
ALTER TABLE byok_usage_log
  ADD COLUMN IF NOT EXISTS provider TEXT;

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'workspaces' AND column_name LIKE 'byok_%'
--   OR column_name = 'use_own_ai_key';
--   -- Expect: use_own_ai_key, byok_provider, byok_api_key_encrypted,
--   -- byok_base_url, byok_model, byok_key_added_at,
--   -- byok_key_last_validated_at, byok_key_last_error, byok_key_last_error_at
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'workspaces' AND column_name LIKE 'anthropic_%';
--   -- Expect: zero rows — old columns fully removed.
