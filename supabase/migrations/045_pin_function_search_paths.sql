-- ── Migration 045: pin search_path on remaining flagged functions ───────────
--
-- Found in the same live-infrastructure `get_advisors(type: security)` pass
-- as migration 044, a distinct warning class: `function_search_path_mutable`.
-- Every SECURITY DEFINER function added from migration 026 onward already
-- includes `SET search_path = public` (established pattern, followed
-- consistently) — these five predate that convention (001, 003, 010, 020)
-- and were never brought in line with it.
--
-- Real-world risk differs by function:
--   - is_workspace_member / is_workspace_owner_or_admin are SECURITY
--     DEFINER — the actual privilege-escalation-via-search_path-hijack
--     class this linter rule exists for. A role able to CREATE objects in
--     a schema that resolves earlier than `public` in its own search_path
--     could shadow `workspace_members` with an attacker-controlled object,
--     and since these functions run with the definer's privileges, the
--     unqualified reference would resolve to it. Pinning search_path
--     closes that off regardless of the caller's own search_path setting.
--   - update_updated_at / set_updated_at / match_knowledge_chunks are
--     SECURITY INVOKER (the default) — they already run with the caller's
--     own privileges, so the same hijack wouldn't escalate anything. Fixed
--     anyway for consistency with the rest of the schema and to fully
--     clear the advisor output, not because a concrete exploit exists here.
--
-- CREATE OR REPLACE, bodies unchanged from their current live definitions
-- (confirmed via pg_get_functiondef immediately before writing this) —
-- only SET search_path = public is added to each.
--
-- Run AFTER: 044_lock_down_security_definer_rpcs.sql

CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id      = auth.uid()
      AND status       = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION is_workspace_owner_or_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id      = auth.uid()
      AND role         IN ('owner', 'admin')
      AND status       = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

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
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT proname, proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('is_workspace_member','is_workspace_owner_or_admin',
--                      'update_updated_at','set_updated_at','match_knowledge_chunks');
--   -- Each row's proconfig should include 'search_path=public'.
