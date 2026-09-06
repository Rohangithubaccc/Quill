-- ── Migration 043: normalize invite email casing ─────────────────────────────
--
-- Found during a ruthless adversarial pass: workspace_invites.email and
-- workspace_members.invited_email were compared with exact-match .eq()
-- in the app layer, so inviting 'Jane@Example.com' when
-- 'jane@example.com' already had a pending or accepted invite neither
-- detected the duplicate nor deduped it. Confirmed directly: seeded an
-- active member with invited_email = 'jane@example.com', then ran the
-- app's exact "already a member?" query for 'Jane@Example.com' — 0 rows,
-- the guard doesn't fire. Confirmed the seat-limit function counts raw
-- rows (count(*)), not distinct emails, so this genuinely wastes a real,
-- paid seat slot on a redundant duplicate invite.
--
-- The application-layer fix (email: z.string().email().transform(e =>
-- e.toLowerCase().trim())) in workspace/invites/route.ts prevents this
-- for every new invite going forward. This migration normalizes
-- whatever mixed-case data already exists, so the fix is complete
-- retroactively too, not just for new rows.
--
-- Run AFTER: 042_atomic_byok_usage_count.sql

UPDATE workspace_invites
SET email = lower(email)
WHERE email <> lower(email);

UPDATE workspace_members
SET invited_email = lower(invited_email)
WHERE invited_email IS NOT NULL
  AND invited_email <> lower(invited_email);

-- ── Verification ──────────────────────────────────────────────────────────
--   SELECT count(*) FROM workspace_invites WHERE email <> lower(email); -- 0
--   SELECT count(*) FROM workspace_members WHERE invited_email <> lower(invited_email); -- 0
