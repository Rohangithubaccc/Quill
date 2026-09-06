-- ── Migration 020: AI Knowledge Base (PDF/DOCX/TXT upload + retrieval) ──────
--
-- Lets a workspace upload documents (brand guidelines, product docs, case
-- studies) that get chunked and embedded, then retrieved at generation
-- time so Claude writes using actual company knowledge instead of only
-- the free-text brand_voice field. Complements the existing structured
-- brand_knowledge (JSONB: products/competitors/tone examples/banned
-- phrases) rather than replacing it — that stays for precise, curated
-- facts; this is for everything too long to hand-type into a form field.
--
-- Run AFTER: 019_campaigns.sql
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING throughout.

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: pgvector
-- ════════════════════════════════════════════════════════════════════════════
--
-- Supabase ships pgvector by default — this is a normal CREATE EXTENSION,
-- not a special Supabase-only step.

CREATE EXTENSION IF NOT EXISTS vector;

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: knowledge_documents — one row per uploaded file
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  filename        TEXT        NOT NULL,
  file_type       TEXT        NOT NULL CHECK (file_type IN ('pdf', 'docx', 'txt')),
  storage_path    TEXT        NOT NULL,
  -- path within the private 'knowledge-base' storage bucket
  file_size_bytes INTEGER,
  status          TEXT        NOT NULL DEFAULT 'processing'
                    CHECK (status IN ('processing', 'ready', 'failed')),
  error_message   TEXT,
  chunk_count     INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kd_workspace ON knowledge_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kd_status    ON knowledge_documents(status);

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_documents" ON knowledge_documents;
CREATE POLICY "members_can_read_documents"
  ON knowledge_documents FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_insert_documents" ON knowledge_documents;
CREATE POLICY "members_can_insert_documents"
  ON knowledge_documents FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_delete_documents" ON knowledge_documents;
CREATE POLICY "members_can_delete_documents"
  ON knowledge_documents FOR DELETE
  USING (is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════════
-- PART C: knowledge_chunks — embedded text chunks used for retrieval
-- ════════════════════════════════════════════════════════════════════════════
--
-- workspace_id is denormalized here (also derivable via document_id) so the
-- retrieval query below can filter by workspace directly, without a join,
-- on the same indexed column the vector index is built alongside.
--
-- embedding is vector(1536) — OpenAI text-embedding-3-small's native
-- dimension. Quill.AI already requires OPENAI_API_KEY for DALL-E 3, so
-- this reuses that key rather than requiring a third AI provider account.

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID        NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_index  INTEGER     NOT NULL,
  content      TEXT        NOT NULL,
  embedding    vector(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kc_document  ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kc_workspace ON knowledge_chunks(workspace_id);

-- ivfflat approximate-nearest-neighbor index for cosine similarity search.
-- Safe to create before any rows exist; Supabase/pgvector will use it as
-- data accumulates. lists=100 is a reasonable default up to ~1M rows —
-- fine for a per-workspace knowledge base at any realistic scale.
CREATE INDEX IF NOT EXISTS idx_kc_embedding
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_chunks" ON knowledge_chunks;
CREATE POLICY "members_can_read_chunks"
  ON knowledge_chunks FOR SELECT
  USING (is_workspace_member(workspace_id));

-- No direct INSERT/UPDATE/DELETE policies for chunks — they're only ever
-- written by the Inngest processing job via the service_role admin client,
-- which bypasses RLS. Deleting the parent knowledge_documents row cascades
-- and removes its chunks automatically.

-- ════════════════════════════════════════════════════════════════════════════
-- PART D: match_knowledge_chunks() — the retrieval function
-- ════════════════════════════════════════════════════════════════════════════
--
-- The Supabase JS client has no built-in way to express a pgvector `<=>`
-- (cosine distance) ORDER BY, so retrieval goes through this Postgres
-- function via admin.rpc('match_knowledge_chunks', {...}) instead of
-- .select(). SECURITY DEFINER + explicit workspace filter inside the
-- function body — never trust a caller-supplied workspace_id alone, but
-- since this is only ever called from server-side routes that already
-- resolved the caller's own workspace via requireWorkspace(), passing it
-- through is safe here (same trust boundary as every other admin-client
-- query in this codebase).
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_workspace_id UUID,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    knowledge_chunks.id,
    knowledge_chunks.document_id,
    knowledge_chunks.content,
    1 - (knowledge_chunks.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks
  WHERE knowledge_chunks.workspace_id = match_workspace_id
    AND knowledge_chunks.embedding IS NOT NULL
  ORDER BY knowledge_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PART E: storage bucket
-- ════════════════════════════════════════════════════════════════════════════
--
-- Private (public = false) — raw uploaded documents may contain sensitive
-- company information. Unlike brand-assets, nothing here is ever served
-- via a public URL; upload and download both go through server routes
-- using the service_role admin client, which bypasses RLS/storage
-- policies entirely. No storage.objects policies are needed as a result.

INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-base', 'knowledge-base', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── Verification queries ─────────────────────────────────────────────────
--
-- 1. Confirm pgvector is enabled:
--    SELECT extname FROM pg_extension WHERE extname = 'vector';
--
-- 2. Confirm match_knowledge_chunks exists:
--    SELECT proname FROM pg_proc WHERE proname = 'match_knowledge_chunks';
--
-- 3. Confirm the knowledge-base bucket exists and is private:
--    SELECT id, public FROM storage.buckets WHERE id = 'knowledge-base';
