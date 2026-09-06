-- ── Migration 024: Digital Asset Management (DAM) ───────────────────────────
--
-- A searchable, folder-organized library for images and videos that get
-- reused across content pieces and campaigns — separate from:
--   - the single workspace logo (src/app/api/upload/logo/route.ts),
--     which stays as its own simple field, not migrated into this
--   - Knowledge Base documents (PDF/DOCX/TXT for retrieval, migration 020),
--     which are for the AI to read, not assets to embed in published content
--
-- Run AFTER: 023_ai_intelligence.sql
-- Safe to re-run: uses IF NOT EXISTS throughout.

-- ════════════════════════════════════════════════════════════════════════════
-- PART A: asset_folders — nestable organization
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS asset_folders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_folder_id UUID        REFERENCES asset_folders(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  created_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_af_workspace ON asset_folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_af_parent    ON asset_folders(parent_folder_id);

ALTER TABLE asset_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_folders" ON asset_folders;
CREATE POLICY "members_can_read_folders" ON asset_folders FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_insert_folders" ON asset_folders;
CREATE POLICY "members_can_insert_folders" ON asset_folders FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_update_folders" ON asset_folders;
CREATE POLICY "members_can_update_folders" ON asset_folders FOR UPDATE
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_delete_folders" ON asset_folders;
CREATE POLICY "members_can_delete_folders" ON asset_folders FOR DELETE
  USING (is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════════
-- PART B: assets
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id       UUID        REFERENCES asset_folders(id) ON DELETE SET NULL,
  uploaded_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT        NOT NULL,
  asset_type      TEXT        NOT NULL CHECK (asset_type IN ('image', 'video')),
  storage_path    TEXT        NOT NULL,
  mime_type       TEXT        NOT NULL,
  file_size_bytes INTEGER,
  width           INTEGER,       -- images only, null for video
  height          INTEGER,       -- images only, null for video
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  used_count      INTEGER     NOT NULL DEFAULT 0,
  -- incremented whenever this asset is attached to a content piece or
  -- campaign (src/app/api/assets/[id]/use/route.ts) — surfaces "most
  -- reused" assets in the library UI without a separate join query.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace ON assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assets_folder    ON assets(folder_id);
CREATE INDEX IF NOT EXISTS idx_assets_type      ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_tags       ON assets USING GIN(tags);
-- Full-text search on name, same tsvector-index pattern already used for
-- content_pieces (migration 001) — reused here for asset search-by-name.
CREATE INDEX IF NOT EXISTS idx_assets_name_fts  ON assets USING GIN(to_tsvector('english', name));

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_assets" ON assets;
CREATE POLICY "members_can_read_assets" ON assets FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_insert_assets" ON assets;
CREATE POLICY "members_can_insert_assets" ON assets FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_update_assets" ON assets;
CREATE POLICY "members_can_update_assets" ON assets FOR UPDATE
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "members_can_delete_assets" ON assets;
CREATE POLICY "members_can_delete_assets" ON assets FOR DELETE
  USING (is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════════
-- PART C: link assets to content pieces (optional, many-to-many)
-- ════════════════════════════════════════════════════════════════════════════
--
-- A content piece can reference multiple assets (e.g. a header image plus
-- inline images); an asset can be reused across many content pieces —
-- that reuse is the whole point of a DAM over one-off per-piece uploads.

CREATE TABLE IF NOT EXISTS content_piece_assets (
  content_id UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
  asset_id   UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (content_id, asset_id)
);

ALTER TABLE content_piece_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_can_read_content_piece_assets" ON content_piece_assets;
CREATE POLICY "members_can_read_content_piece_assets" ON content_piece_assets FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM content_pieces cp WHERE cp.id = content_id AND is_workspace_member(cp.workspace_id))
  );

DROP POLICY IF EXISTS "members_can_insert_content_piece_assets" ON content_piece_assets;
CREATE POLICY "members_can_insert_content_piece_assets" ON content_piece_assets FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM content_pieces cp WHERE cp.id = content_id AND is_workspace_member(cp.workspace_id))
  );

DROP POLICY IF EXISTS "members_can_delete_content_piece_assets" ON content_piece_assets;
CREATE POLICY "members_can_delete_content_piece_assets" ON content_piece_assets FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM content_pieces cp WHERE cp.id = content_id AND is_workspace_member(cp.workspace_id))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- PART D: storage bucket
-- ════════════════════════════════════════════════════════════════════════════
--
-- Public, matching the existing brand-assets bucket precedent — assets in
-- this library are meant to be embedded in published content, so they
-- need directly-servable URLs.

INSERT INTO storage.buckets (id, name, public)
VALUES ('dam-assets', 'dam-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ── Verification queries ─────────────────────────────────────────────────
-- SELECT relrowsecurity FROM pg_class WHERE relname IN ('assets', 'asset_folders', 'content_piece_assets');
-- SELECT id, public FROM storage.buckets WHERE id = 'dam-assets';
