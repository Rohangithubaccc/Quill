-- ── Migration 006: repurposing lineage columns ──────────────────────────────
-- Adds parent_id so repurposed pieces link back to the original content_piece,
-- and repurpose_type to record what kind of transformation was performed.
-- Run: supabase db push  (or paste into Supabase dashboard SQL editor)

-- parent_id: UUID FK back to the source content_piece.
-- ON DELETE SET NULL keeps the repurposed piece even if the original is deleted.
ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS parent_id UUID
    REFERENCES content_pieces(id) ON DELETE SET NULL;

-- Fast index for "show all repurposed versions of this piece" queries
CREATE INDEX IF NOT EXISTS content_pieces_parent_id_idx
  ON content_pieces(parent_id)
  WHERE parent_id IS NOT NULL;

-- repurpose_type records which transformation produced this piece.
-- NULL = original (not a repurpose). Possible values:
--   'linkedin_thread' | 'twitter_thread' | 'email_newsletter'
--   'instagram_caption' | 'social_variations'
ALTER TABLE content_pieces
  ADD COLUMN IF NOT EXISTS repurpose_type TEXT;
