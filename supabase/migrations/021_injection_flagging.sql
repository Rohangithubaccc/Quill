-- ── Migration 021: prompt-injection flagging on knowledge_documents ────────
--
-- Adds visibility (not blocking — see src/lib/prompt-injection.ts for why)
-- into whether an uploaded document's extracted text matched common,
-- unsophisticated prompt-injection patterns. Documents still process and
-- get retrieved normally either way; this just surfaces a warning so a
-- human can look at what got flagged and decide.
--
-- Run AFTER: 020_knowledge_base.sql
-- Safe to re-run: uses IF NOT EXISTS throughout.

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS flagged_content BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_reasons TEXT[];
  -- e.g. {'instruction override', 'fake role marker'} — the pattern
  -- labels that matched, shown as-is in Settings so the reviewer knows
  -- roughly what tripped it without needing to open the source document.

CREATE INDEX IF NOT EXISTS idx_kd_flagged ON knowledge_documents(workspace_id, flagged_content) WHERE flagged_content = true;

-- ── Verification query ────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'knowledge_documents' AND column_name LIKE 'flagged%';
