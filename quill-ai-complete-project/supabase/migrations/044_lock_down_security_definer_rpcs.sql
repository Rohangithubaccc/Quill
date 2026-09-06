-- ── Migration 044: lock SECURITY DEFINER RPCs out of anon/authenticated ─────
--
-- Found during live-infrastructure testing (Stage 0, real Supabase Cloud
-- project, not local `supabase start`) via `get_advisors(type: security)`,
-- then independently re-confirmed by querying
-- information_schema.routine_privileges directly rather than trusting the
-- linter's summary — same "empirical, not inferred" bar as every other fix
-- in this project.
--
-- ROOT CAUSE: every atomic/service-role-only RPC added since migration 013
-- ends with `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` on the assumption
-- that this removes access for everyone except the explicit
-- `GRANT ... TO service_role` that follows it. That assumption is wrong on
-- Supabase specifically: Supabase Cloud grants EXECUTE on newly created
-- functions directly to the `anon` and `authenticated` roles, not through
-- the `PUBLIC` pseudo-role. `REVOKE ... FROM PUBLIC` does not touch a
-- privilege that was never granted via PUBLIC in the first place — the
-- direct per-role grant survives untouched. A local fresh-Postgres
-- migration run (`supabase start`, or a bare `psql` against a vanilla
-- instance) does not reproduce this, because that platform-level default
-- grant is a Supabase Cloud project setting, not something any migration
-- file establishes — which is exactly why 8 rounds of adversarial testing
-- against fresh local instances never caught it.
--
-- CONFIRMED EXPLOITABLE (real project, real anon-equivalent grant, checked
-- directly against information_schema.routine_privileges — not simulated):
--   - add_credits(workspace_id, credits)   — anyone can grant infinite free
--     credits to any workspace with zero auth: a single unauthenticated
--     POST to /rest/v1/rpc/add_credits.
--   - reset_monthly_credits()              — anyone can reset EVERY
--     workspace on the platform to full credits, repeatedly, at will.
--   - deduct_credits(workspace_id, amount) — anyone can zero out an
--     arbitrary competitor workspace's credit balance.
--   - claim_seat_and_create_invite(...)    — anyone can spam invites into
--     any workspace, burning its paid seat capacity.
--   - reserve_storage / release_storage    — anyone can corrupt any
--     workspace's storage_used_bytes counter in either direction.
--   - claim_content_for_purge / claim_email_send / record_webhook_failure /
--     record_webhook_success / increment_asset_used_count /
--     increment_byok_usage_count — same shape: internal-only bookkeeping
--     RPCs reachable with no auth and attacker-controlled arguments.
-- All twelve are SECURITY DEFINER, so they run with the privileges of the
-- function owner regardless of who calls them — the only thing standing
-- between "internal cron/route helper" and "public write primitive" was
-- the (ineffective) REVOKE FROM PUBLIC.
--
-- is_workspace_member(ws_id) / is_workspace_owner_or_admin(ws_id) are
-- DELIBERATELY EXCLUDED from this lockdown, and it's worth being explicit
-- about why, since they look like the same pattern at first glance.
--
-- An earlier draft of this migration included them too. Applying it and
-- then testing empirically (SET LOCAL ROLE authenticated; SELECT
-- is_workspace_member(...)) showed the call still succeeding — tracing
-- that down, both functions still carry Postgres's default PUBLIC execute
-- grant, which migration 001 never revoked (unlike every function listed
-- below, each of which explicitly revoked PUBLIC when it was created).
-- REVOKE ... FROM anon, authenticated does nothing when PUBLIC still
-- grants the same privilege to everyone, authenticated included — which
-- is exactly why draft's version of this fix was a harmless no-op for
-- these two specifically rather than an actual lockdown.
--
-- More importantly: querying pg_policies confirms these two functions are
-- referenced directly inside the USING/WITH CHECK clause of 46 RLS
-- policies across nearly every table in this schema (workspaces,
-- content_pieces, campaigns, assets, comments, etc.). RLS policy
-- expressions run under the privileges of whichever role is executing the
-- query — for any real signed-in user hitting the API, that's
-- `authenticated`. Had the PUBLIC grant genuinely been revoked (the
-- mistake the earlier draft was about to compound by also stripping
-- PUBLIC to "finish the job"), every one of those 46 policies would start
-- throwing `permission denied for function is_workspace_member` for every
-- real user, on every request — a self-inflicted total outage disguised
-- as a security fix. Confirmed this specific failure mode by reproducing
-- it directly: SET LOCAL ROLE authenticated; CREATE TABLE ... correctly
-- throws permission denied (proving the role switch itself is real and
-- enforced), which is what makes the is_workspace_member success under
-- the same role switch meaningful rather than a fluke of the test.
--
-- Net effect: these two remain callable by anon/authenticated exactly as
-- before (via PUBLIC) — intentionally, not as an oversight. Calling them
-- directly leaks nothing beyond what the caller's own auth.uid() already
-- entitles them to see, which is the same reasoning the original
-- migration 001 comment implicitly relied on by never revoking PUBLIC
-- here in the first place.
--
-- THE FIX: explicit `REVOKE EXECUTE ... FROM anon, authenticated` on the
-- twelve functions below only — every one of which already had PUBLIC
-- correctly revoked when it was created (013 through 042), so this
-- REVOKE is the missing piece, not a redundant one. service_role's
-- EXECUTE grant is untouched — every real call site in this codebase
-- already goes through the service_role admin client, matching the exact
-- same reasoning migration 030 already established for table-level
-- grants.
--
-- Run AFTER: 043_normalize_invite_email_casing.sql

REVOKE EXECUTE ON FUNCTION add_credits(UUID, INTEGER)                                          FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION deduct_credits(UUID, INTEGER)                                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION reset_monthly_credits()                                              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION reserve_storage(UUID, BIGINT)                                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION release_storage(UUID, BIGINT)                                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_seat_and_create_invite(UUID, UUID, TEXT, TEXT, INT)             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_content_for_purge(INT, INT)                                    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_email_send(UUID, TEXT, TIMESTAMPTZ)                             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_webhook_failure(UUID, TEXT)                                   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_webhook_success(UUID)                                         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_asset_used_count(UUID)                                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_byok_usage_count(UUID)                                     FROM anon, authenticated;

-- is_workspace_member / is_workspace_owner_or_admin intentionally NOT
-- revoked here — see comment block above. They keep their default PUBLIC
-- execute grant because 46 RLS policies across this schema depend on
-- being able to call them as `authenticated`.

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE routine_schema = 'public' AND grantee IN ('anon','authenticated')
--     AND routine_name IN (
--       'add_credits','deduct_credits','reset_monthly_credits',
--       'reserve_storage','release_storage','claim_seat_and_create_invite',
--       'claim_content_for_purge','claim_email_send',
--       'record_webhook_failure','record_webhook_success',
--       'increment_asset_used_count','increment_byok_usage_count'
--     );
--   -- Expect: zero rows.
--
--   -- Separately — confirms is_workspace_member/is_workspace_owner_or_admin
--   -- were correctly left alone, not accidentally caught by the same fix:
--   SELECT routine_name, grantee FROM information_schema.routine_privileges
--   WHERE routine_schema='public' AND grantee = 'PUBLIC'
--     AND routine_name IN ('is_workspace_member','is_workspace_owner_or_admin');
--   -- Expect: both still present. If this ever comes back empty, RLS is
--   -- broken for every real user — investigate before doing anything else.
--
--   -- get_advisors(type: 'security') will still list these two under
--   -- anon/authenticated_security_definer_function_executable — that's
--   -- the accepted, understood tradeoff explained above, not an
--   -- unresolved finding.
