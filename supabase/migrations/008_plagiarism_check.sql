-- ── Migration 008: plagiarism + AI detection result columns ─────────────────
-- Stores the last Originality.ai scan result on each content_piece so we
-- never re-charge for the same piece within 24 hours, and results persist
-- across sessions without a separate table.
--
-- Run: supabase db push  (or paste into Supabase dashboard SQL editor)

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS plagiarism_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plagiarism_score        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ai_detection_score      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS plagiarism_report_url   TEXT;

-- Column semantics:
--   plagiarism_score:    0–100  (100 = fully original, 0 = entirely plagiarised)
--   ai_detection_score:  0–100  (100 = definitely AI-written, 0 = human-written)
--   plagiarism_report_url: direct link to the Originality.ai scan report
--   plagiarism_checked_at: UTC timestamp of last scan — used for 24-h cooldown
--
-- These two scores are INDEPENDENT dimensions. Content can be AI-written AND
-- original (not copied from anywhere), or human-written AND plagiarised.
