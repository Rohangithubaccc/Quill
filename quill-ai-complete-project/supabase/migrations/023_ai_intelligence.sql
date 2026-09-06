-- ── Migration 023: AI Intelligence Layer ────────────────────────────────────
--
-- Adds brand-consistency scoring and engagement prediction to the existing
-- quality-scoring pipeline (content_pieces.engagement_score, set by the
-- Haiku call in ai/generate/route.ts) — extending it rather than
-- duplicating it, so generation only pays for one extra scoring call, not
-- three. Posting-time optimization (the third piece of this layer) needs
-- no new column — it's a pure aggregate query over calendar_events +
-- content_pieces that already exist (see /api/analytics/best-times).
--
-- Run AFTER: 022_malware_scan.sql
-- Safe to re-run: uses IF NOT EXISTS throughout.

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS brand_consistency_score       NUMERIC(5,2),
  -- NULL when the workspace has no brand_voice/brand_knowledge configured
  -- (nothing to be consistent WITH) — distinct from a real low score.
  ADD COLUMN IF NOT EXISTS predicted_engagement_tier     TEXT
    CHECK (predicted_engagement_tier IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS predicted_engagement_reasoning TEXT;

-- ── Verification query ────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'content_pieces' AND column_name LIKE '%engagement%' OR column_name LIKE '%brand_consistency%';
