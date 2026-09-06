-- ── Migration 038: fix integrations.provider CHECK constraint ───────────────
--
-- Found during a fresh, from-scratch adversarial test pass: the app layer's
-- ALLOWED_PROVIDERS set (src/app/api/integrations/[provider]/route.ts)
-- includes 'linkedin' and 'gsc' alongside 'wordpress', 'buffer', 'hubspot',
-- 'mailchimp', 'hootsuite' — but the integrations_provider_check constraint,
-- unchanged since 001_initial_schema.sql, only ever allowed the latter five.
--
-- This wasn't a hypothetical mismatch. Traced it into the actual production
-- code: src/app/api/integrations/linkedin/callback/route.ts does
--   .from('integrations').upsert({ provider: 'linkedin', ... })
-- and reproduced the failure directly against Postgres:
--   ERROR: new row ... violates check constraint "integrations_provider_check"
-- Same failure for 'gsc'. Real-world effect: a user completes the entire
-- LinkedIn (or GSC) OAuth consent flow, the token exchange succeeds, and the
-- final save silently fails — they land back on Settings with a generic
-- "...store_failed" error and no explanation. Both integrations have been
-- broken end-to-end at the database layer since they were built, invisible
-- to tsc/lint/build because it's a runtime data constraint, not a type
-- error, and never previously tested against a real database.
--
-- 'medium' is deliberately NOT added here — it exists in ALLOWED_PROVIDERS
-- (which only governs the DELETE/disconnect path) but has no actual
-- connect/callback route anywhere in the app; adding it to this constraint
-- would misleadingly imply it's a supported integration. Left as-is; the
-- DELETE route already handles "no row to delete" gracefully regardless.
--
-- Run AFTER: 037_rls_and_fk_indexes.sql

ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check
  CHECK (provider = ANY (ARRAY['wordpress', 'buffer', 'hubspot', 'mailchimp', 'hootsuite', 'linkedin', 'gsc']));

-- ── Verification ──────────────────────────────────────────────────────────
--   INSERT INTO integrations (workspace_id, provider, status, config)
--   VALUES ('<any workspace id>', 'linkedin', 'connected', '{}');  -- now succeeds
