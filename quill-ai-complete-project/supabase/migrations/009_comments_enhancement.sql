-- ── Migration 009: comments enhancement — inline anchoring + resolution ──────
-- Adds metadata (JSONB) for inline selection anchoring and @mentions,
-- and resolved_at for the resolution workflow.
--
-- Run: supabase db push  (or paste into Supabase dashboard SQL editor)

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS metadata    JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- metadata schema (stored as JSONB, all fields optional):
-- {
--   "selectionOffset": 142,           -- char offset in content where selection starts
--   "selectionText":   "key insight",  -- highlighted passage the comment is anchored to (max 200 chars)
--   "mentions":        ["user@example.com"]  -- array of mentioned workspace member emails
-- }

-- ── content_pieces.status extended values ────────────────────────────────────
-- The status column is TEXT with no CHECK constraint, so no ALTER needed.
-- Document the full set of allowed values here for reference:
--
--   'draft'          — AI-generated, not yet submitted for review
--   'review'         — submitted to the review queue
--   'needs_revision' — reviewer marked as needing changes (amber)
--   'approved'       — reviewer approved; ready to schedule/publish
--   'rejected'       — reviewer rejected
--   'scheduled'      — linked to a calendar_event with a future scheduled_at
--   'published'      — confirmed published to a destination platform

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookup for "unresolved comments on this piece" — used in review UI
-- to show the comment count badge and drive the approval gate.
CREATE INDEX IF NOT EXISTS comments_content_unresolved_idx
  ON comments(content_id)
  WHERE resolved_at IS NULL;

-- General-purpose index on content_id for ordered comment list fetches
CREATE INDEX IF NOT EXISTS comments_content_created_idx
  ON comments(content_id, created_at ASC);
