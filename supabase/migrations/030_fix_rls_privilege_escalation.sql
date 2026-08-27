-- ── Migration 030: close RLS privilege-escalation holes ──────────────────────
--
-- Found during a full adversarial review, empirically proven against a real
-- database, not inferred from reading policy definitions. Every one of these
-- was reachable by any authenticated member with nothing but the standard
-- browser Supabase client — no API route, no server code, involved at all.
--
-- ROOT CAUSE: RLS UPDATE/INSERT/DELETE policies across this schema use a
-- USING clause to scope which ROWS a member can touch (e.g. "is a member of
-- this workspace"), but specify no WITH CHECK and no column-level grants.
-- Postgres RLS is row-level, not column-level — a policy that lets someone
-- touch a row at all lets them touch every column on it, and Supabase's
-- default authenticated role gets broad table-level DML grants unless a
-- project explicitly restricts them. Nothing in migrations 001-029 did.
--
-- CONFIRMED EXPLOITS (real psql session, RLS enforced, not simulated):
--   1. Any workspace owner/admin could directly UPDATE workspaces.plan,
--      credits_remaining, storage_used_bytes, storage_limit_bytes,
--      deletion_requested_at, scheduled_purge_at — bypassing Stripe
--      billing, the storage quota system (migration 027), and the GDPR
--      deletion owner-only + password-verification checks (migration 028)
--      entirely.
--   2. Any workspace ADMIN (not owner) could UPDATE workspace_members.role
--      to promote themselves to 'owner' and demote the real owner to
--      'viewer' — full workspace takeover, empirically proven both
--      directions in one test.
--   3. Any workspace EDITOR (the lowest role with write access) could
--      directly UPDATE content_pieces.status to 'approved' and clear
--      current_stage_index — completely bypassing the multi-stage
--      approval chain feature (migration 025) with zero audit trail,
--      since approval_history rows are only written by the API route,
--      never by this raw update.
--   4. Any member could UPDATE assets.file_size_bytes on their own
--      upload before deleting it — the delete route reads this column to
--      know how much quota to release, so shrinking it first and then
--      deleting via the real route effectively resets storage_used_bytes
--      toward zero while every real file stays exactly where it was.
--
-- THE FIX: every write in this entire codebase (checked exhaustively —
-- grepped every .ts/.tsx file in src/app) already goes through
-- admin.from(...) using the service_role client, which bypasses RLS
-- entirely by design. There are exactly TWO real exceptions:
--   - settings/page.tsx saveBrand() updates workspaces directly from the
--     browser (name, industry, brand_voice, brand_knowledge only)
--   - settings/page.tsx waitlist signup, an intentionally-open public form
-- Everything else gets its write grant revoked outright. This is stronger
-- than patching each policy's WITH CHECK individually — the base GRANT is
-- checked before RLS is ever evaluated, so a table with no grant is
-- unreachable for writes regardless of what its policies say.
--
-- SELECT is untouched everywhere — the app's dashboard/list views read
-- these tables directly via the browser client and must keep working.
--
-- Run AFTER: 029_content_purge_index.sql

-- ── workspaces: narrow to exactly the columns saveBrand() needs ──────────
REVOKE UPDATE ON workspaces FROM authenticated;
GRANT UPDATE (name, industry, brand_voice, brand_knowledge) ON workspaces TO authenticated;

-- ── Everything else: no legitimate direct-write path exists anywhere,
-- so remove write access outright rather than trying to enumerate safe
-- columns table by table. ────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON asset_folders             FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON assets                    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON calendar_events            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON campaigns                  FROM authenticated;
REVOKE INSERT,         DELETE ON comments                   FROM authenticated;
REVOKE INSERT,         DELETE ON content_piece_assets       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON content_pieces             FROM authenticated;
REVOKE INSERT                 ON content_versions           FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON domains                    FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON integrations               FROM authenticated;
REVOKE INSERT,         DELETE ON knowledge_documents        FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON webhook_endpoints          FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON workspace_approval_stages  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON workspace_invites          FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON workspace_members          FROM authenticated;

-- Same revocations for anon, as cheap defense-in-depth — the app requires
-- login for all of this today, so anon shouldn't have inherited any of
-- these grants in the first place, but explicit beats implicit.
REVOKE INSERT, UPDATE, DELETE ON asset_folders             FROM anon;
REVOKE INSERT, UPDATE, DELETE ON assets                    FROM anon;
REVOKE INSERT, UPDATE, DELETE ON calendar_events            FROM anon;
REVOKE INSERT, UPDATE, DELETE ON campaigns                  FROM anon;
REVOKE INSERT,         DELETE ON comments                   FROM anon;
REVOKE INSERT,         DELETE ON content_piece_assets       FROM anon;
REVOKE INSERT, UPDATE, DELETE ON content_pieces             FROM anon;
REVOKE INSERT                 ON content_versions           FROM anon;
REVOKE INSERT, UPDATE, DELETE ON domains                    FROM anon;
REVOKE INSERT, UPDATE, DELETE ON integrations               FROM anon;
REVOKE INSERT,         DELETE ON knowledge_documents        FROM anon;
REVOKE INSERT, UPDATE, DELETE ON webhook_endpoints          FROM anon;
REVOKE INSERT, UPDATE, DELETE ON workspace_approval_stages  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON workspace_invites          FROM anon;
REVOKE INSERT, UPDATE, DELETE ON workspace_members          FROM anon;
REVOKE UPDATE                 ON workspaces                 FROM anon;

-- ── Deliberately left untouched ───────────────────────────────────────────
-- performance_events INSERT ("anyone_can_insert_events", WITH CHECK true)
--   — intentional: a public tracking pixel on published content needs
--   anonymous writes with no auth at all. Spammable by design; accepted
--   for that use case, not a bug.
-- waitlist INSERT — intentional public signup form, same reasoning.

-- ── Verification queries ─────────────────────────────────────────────────
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--   WHERE grantee IN ('authenticated','anon') AND table_schema='public'
--   AND privilege_type IN ('INSERT','UPDATE','DELETE') ORDER BY table_name;
-- (workspaces should show UPDATE only with column_name populated for the
--  4 allowed columns; every table listed above should show zero rows.)
