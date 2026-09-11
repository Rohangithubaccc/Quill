-- ── Migration 007: structured brand knowledge base ──────────────────────────
-- Adds a brand_knowledge JSONB column to workspaces so the AI can reference
-- structured product info, competitors to avoid, approved tone examples, and
-- banned phrases. This context is injected into every generation automatically.
--
-- Schema of brand_knowledge JSONB:
-- {
--   "products": [
--     { "name": "...", "description": "...", "differentiators": "..." }
--   ],
--   "competitors":  ["CompanyA", "CompanyB"],
--   "toneExamples": ["Example 1...", "Example 2...", "Example 3..."],
--   "bannedPhrases": ["phrase1", "phrase2"]
-- }
--
-- Run: supabase db push  (or paste into Supabase dashboard SQL editor)

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS brand_knowledge JSONB DEFAULT '{}'::jsonb;
