-- ── Migration 014: AI header image generation ────────────────────────────────
--
-- Adds columns to content_pieces to store the generated header image URL
-- and the DALL-E prompt used to generate it (for regeneration/audit trail).
--
-- Image cost: 5 credits per generation (added to src/lib/credits.ts).
-- Storage path: images/{workspace_id}/{content_id}-{timestamp}.png
-- Bucket: brand-assets (already exists, used for logo uploads)
--
-- Run AFTER: 013_add_credits_function.sql

ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS header_image_url    TEXT,
  ADD COLUMN IF NOT EXISTS header_image_prompt TEXT;

-- Index for "find all published pieces with a header image" (used in WP publish)
CREATE INDEX IF NOT EXISTS content_pieces_header_image_idx
  ON content_pieces(workspace_id, header_image_url)
  WHERE header_image_url IS NOT NULL;
