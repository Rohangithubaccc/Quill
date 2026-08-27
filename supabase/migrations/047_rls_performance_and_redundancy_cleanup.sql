-- ── Migration 047: RLS initplan + redundant permissive policy cleanup ───────
--
-- Resolves the two categories of get_advisors(type: 'performance') findings
-- deferred at the end of the live-infrastructure Stage 0 pass: 10 policies
-- across 9 tables calling auth.uid() directly (re-evaluated per row instead
-- of once via InitPlan), and 5 tables with genuinely overlapping permissive
-- policies for the same command.
--
-- Every USING/WITH CHECK expression below is copied verbatim from the live
-- policy definitions (pulled via pg_policies immediately before writing
-- this) with only the specific, mechanical change described in each
-- section — no incidental behavior changes.
--
-- Run AFTER: 046_perf_advisor_cleanup.sql

-- ── Part A: wrap auth.uid() as (select auth.uid()) — InitPlan fix ─────────
-- Standard Supabase-documented rewrite: Postgres can evaluate a scalar
-- subquery once and reuse it, but a bare function call in the row filter
-- gets invoked per row. Semantics are identical; only the plan changes.

DROP POLICY "authors_can_delete_own_comments" ON comments;
CREATE POLICY "authors_can_delete_own_comments"
  ON comments FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY "members_can_insert_comments" ON comments;
CREATE POLICY "members_can_insert_comments"
  ON comments FOR INSERT
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM content_pieces cp
      WHERE cp.id = content_id
        AND is_workspace_member(cp.workspace_id)
    )
  );

DROP POLICY "members_can_read_own_workspace_jobs" ON job_results;
CREATE POLICY "members_can_read_own_workspace_jobs"
  ON job_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = job_results.workspace_id
        AND user_id      = (select auth.uid())
        AND status       = 'active'
    )
  );

DROP POLICY "owners_admins_manage_webhooks" ON webhook_endpoints;
CREATE POLICY "owners_admins_manage_webhooks"
  ON webhook_endpoints FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = webhook_endpoints.workspace_id
        AND user_id      = (select auth.uid())
        AND role         IN ('owner','admin')
        AND status       = 'active'
    )
  );

DROP POLICY "owners_admins_read_deliveries" ON webhook_deliveries;
CREATE POLICY "owners_admins_read_deliveries"
  ON webhook_deliveries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = webhook_deliveries.workspace_id
        AND user_id      = (select auth.uid())
        AND role         IN ('owner','admin')
        AND status       = 'active'
    )
  );

DROP POLICY "agency_owners_manage_domains" ON domains;
CREATE POLICY "agency_owners_manage_domains"
  ON domains FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.workspace_id = domains.workspace_id
        AND wm.user_id      = (select auth.uid())
        AND wm.role         = 'owner'
        AND wm.status       = 'active'
        AND w.plan          = 'agency'
    )
  );

DROP POLICY "members_read_own_byok_usage_log" ON byok_usage_log;
CREATE POLICY "members_read_own_byok_usage_log"
  ON byok_usage_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = byok_usage_log.workspace_id
        AND user_id      = (select auth.uid())
        AND status       = 'active'
    )
  );

-- ── Part B: genuine duplicate — analyzer_cache ─────────────────────────────
-- members_can_read_cache (001, via is_workspace_member()) and
-- members_read_own_analyzer_cache (017, inline EXISTS) are byte-for-byte
-- the same access rule expressed two different ways. Function-wrapped
-- policies weren't flagged by the initplan linter, so keeping 001's
-- version and dropping 017's duplicate resolves both the redundant-policy
-- and the initplan finding for this table in one move.

DROP POLICY "members_read_own_analyzer_cache" ON analyzer_cache;

-- ── Part C: superseded policy — generation_logs ────────────────────────────
-- owners_can_read_logs (001, owner/admin only) is a strict subset of
-- members_read_own_generation_logs (017, any active member) — permissive
-- policies OR together, so 001's policy has contributed nothing since 017
-- was added; the effective rule has been "any active member" all along.
-- That's also the consistent pattern for every other workspace-scoped read
-- policy in this schema (content_pieces, calendar_events, campaigns,
-- assets, integrations, knowledge_documents, approval_history all use
-- is_workspace_member for SELECT) — generation_logs was the outlier before
-- 017, not after. Dropping the subsumed 001 policy and re-creating 017's
-- with the InitPlan fix.

DROP POLICY "owners_can_read_logs" ON generation_logs;
DROP POLICY "members_read_own_generation_logs" ON generation_logs;
CREATE POLICY "members_read_own_generation_logs"
  ON generation_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = generation_logs.workspace_id
        AND user_id      = (select auth.uid())
        AND status       = 'active'
    )
  );

-- ── Part D: stale public policy + InitPlan fix — waitlist ─────────────────
-- anyone_can_join_waitlist (001, WITH CHECK true) modeled the original
-- product concept of `waitlist` as a public pre-launch marketing signup
-- list. The table was later repurposed (011) for per-integration "notify
-- me" signups (HubSpot/Mailchimp/Hootsuite/Medium in Settings →
-- Integrations) and gained authenticated_users_can_join_waitlist as the
-- evidently-intended restriction — but since permissive policies OR
-- together, the unconditional `true` policy from 001 silently continued
-- to allow fully anonymous inserts the whole time regardless. Confirmed
-- via the actual app code (src/app/(app)/settings/page.tsx, joinWaitlist())
-- that every real call site is a direct browser-side insert from inside
-- the authenticated settings page, with no server route gating it — so
-- the RLS policy IS the real access control here, and nothing in the app
-- relies on anonymous inserts. Dropping the stale 001 policy; keeping and
-- InitPlan-fixing 011's.

DROP POLICY "anyone_can_join_waitlist" ON waitlist;
DROP POLICY "authenticated_users_can_join_waitlist" ON waitlist;
CREATE POLICY "authenticated_users_can_join_waitlist"
  ON waitlist FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- ── Part E: split FOR ALL into INSERT/UPDATE/DELETE ────────────────────────
-- integrations and workspace_approval_stages each pair a broad FOR SELECT
-- policy (any active member) with an owners/admins FOR ALL policy. FOR ALL
-- implicitly includes SELECT, so owners/admins were evaluating two
-- permissive SELECT policies where the broader one already covers them —
-- not a behavior bug (owners/admins are members too, so they always had
-- read access either way), just redundant evaluation. Splitting the write
-- policy into INSERT/UPDATE/DELETE only removes the overlap without
-- changing who can do what.

DROP POLICY "owners_can_manage_integrations" ON integrations;
CREATE POLICY "owners_can_insert_integrations"
  ON integrations FOR INSERT
  WITH CHECK (is_workspace_owner_or_admin(workspace_id));
CREATE POLICY "owners_can_update_integrations"
  ON integrations FOR UPDATE
  USING (is_workspace_owner_or_admin(workspace_id));
CREATE POLICY "owners_can_delete_integrations"
  ON integrations FOR DELETE
  USING (is_workspace_owner_or_admin(workspace_id));

DROP POLICY "owners_admins_can_manage_approval_stages" ON workspace_approval_stages;
CREATE POLICY "owners_admins_can_insert_approval_stages"
  ON workspace_approval_stages FOR INSERT
  WITH CHECK (is_workspace_owner_or_admin(workspace_id));
CREATE POLICY "owners_admins_can_update_approval_stages"
  ON workspace_approval_stages FOR UPDATE
  USING (is_workspace_owner_or_admin(workspace_id))
  WITH CHECK (is_workspace_owner_or_admin(workspace_id));
CREATE POLICY "owners_admins_can_delete_approval_stages"
  ON workspace_approval_stages FOR DELETE
  USING (is_workspace_owner_or_admin(workspace_id));

-- ── Verification ──────────────────────────────────────────────────────────
-- Re-run get_advisors(type: 'performance') — auth_rls_initplan should no
-- longer list any of the policies touched above, and
-- multiple_permissive_policies should no longer list analyzer_cache,
-- generation_logs, integrations, waitlist, or workspace_approval_stages.
--
-- Smoke test (as `authenticated`, no errors expected):
--   BEGIN; SET LOCAL ROLE authenticated;
--   SELECT count(*) FROM comments; SELECT count(*) FROM job_results;
--   SELECT count(*) FROM webhook_endpoints; SELECT count(*) FROM domains;
--   SELECT count(*) FROM byok_usage_log; SELECT count(*) FROM generation_logs;
--   SELECT count(*) FROM analyzer_cache; SELECT count(*) FROM integrations;
--   SELECT count(*) FROM workspace_approval_stages; ROLLBACK;
--
-- Prove the waitlist fix closed the real gap (as `anon`, should now be
-- rejected — 0 rows affected / permission denied, not a silent success):
--   BEGIN; SET LOCAL ROLE anon;
--   INSERT INTO waitlist (email, provider) VALUES ('probe@example.com','hubspot');
--   ROLLBACK;
