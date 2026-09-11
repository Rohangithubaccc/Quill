# Quill.AI — Database Migration Guide

This guide explains how to apply and verify all Quill.AI database migrations
in a Supabase project. Read it fully before touching a production database.

---

## Migration files at a glance

| File | Purpose | Defines |
|---|---|---|
| `000_validate_functions.sql` | Validation script — **not a migration** | Nothing — read-only assertions |
| `001_initial_schema.sql` | Core tables + RLS helper functions | `is_workspace_member()`, `is_workspace_owner_or_admin()`, `update_updated_at()` |
| `002_invites_and_fts.sql` | Workspace invites + FTS on content | `workspace_invites` table, `content_pieces.fts` column |
| `003_billing_and_gdpr.sql` | Billing columns + overage logging | `workspaces.trial_ends_at`, `workspaces.subscription_status`, `usage_overages` table |
| `004_email_tracking.sql` | Email send audit log | `sent_emails` table |

---

## RLS helper functions

These two functions are used in RLS policies throughout the schema. Both are
defined in **migration 001** and re-declared as a safety net in **migration 003**.

### `is_workspace_member(ws_id UUID) → BOOLEAN`
Returns `TRUE` if the currently authenticated user (`auth.uid()`) is an
**active member** of the given workspace — any role.

Used on: `workspaces`, `workspace_members`, `content_pieces`,
`content_versions`, `calendar_events`, `comments`, `integrations`,
`performance_events`, `analyzer_cache`.

### `is_workspace_owner_or_admin(ws_id UUID) → BOOLEAN`
Returns `TRUE` if the currently authenticated user is an active member
with role `owner` **or** `admin`.

Used on: `workspaces` (UPDATE), `workspace_members` (INSERT/UPDATE/DELETE),
`integrations` (ALL), `generation_logs` (SELECT), `usage_overages` (SELECT),
`sent_emails` (SELECT), `workspace_invites` (ALL).

Both functions use `SECURITY DEFINER` so they execute with the privileges of
the function owner (postgres superuser), allowing them to read
`workspace_members` even when the calling user has restricted access.

---

## How to run migrations

### Prerequisites
- Access to your Supabase project dashboard
- The project must be in a running state (not paused)

### Step-by-step

1. Open your Supabase project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the migration file in a text editor, **select all**, and paste into the SQL Editor
5. Click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`)
6. Check the output panel at the bottom:
   - ✅ `Success. No rows returned` or similar — migration applied
   - ❌ Any `ERROR:` line — see the troubleshooting section below
7. Repeat for the next migration file

### Required run order

**Always run in this order. Do not skip files.**

```
001_initial_schema.sql
        ↓
002_invites_and_fts.sql
        ↓
003_billing_and_gdpr.sql
        ↓
004_email_tracking.sql
```

Then run the validation script to confirm everything is correct:

```
000_validate_functions.sql   ← run this last, read-only
```

### On a brand-new project

```
1. Create a new Supabase project
2. Wait for provisioning (~1 min)
3. Go to SQL Editor
4. Run 001 → 002 → 003 → 004
5. Run 000 (validation)
6. Enable email auth: Authentication → Providers → Email → "Confirm email" ON
7. Set auth redirect URL: Authentication → URL Configuration →
   Site URL = https://your-domain.com
   Redirect URLs = https://your-domain.com/api/auth/callback
```

### On an existing project (adding new migrations)

Only run the migrations you haven't applied yet. All migration files use
`IF NOT EXISTS` and `CREATE OR REPLACE` guards, so running an already-applied
migration is safe and will not duplicate data or raise errors.

---

## How to verify each migration succeeded

After running each file, paste and run this quick check in a new SQL Editor tab:

### After 001
```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'workspaces')      AS workspaces_exists,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'content_pieces')  AS content_pieces_exists,
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'is_workspace_member') AS fn_member_exists,
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'is_workspace_owner_or_admin') AS fn_owner_exists;
```
All four values should be `1`.

### After 002
```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'workspace_invites') AS invites_exists,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'content_pieces'
     AND column_name = 'fts') AS fts_column_exists;
```
Both values should be `1`.

### After 003
```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workspaces'
     AND column_name = 'trial_ends_at') AS trial_col_exists,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'workspaces'
     AND column_name = 'subscription_status') AS status_col_exists,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'usage_overages') AS overages_exists;
```
All three values should be `1`.

### After 004
```sql
SELECT COUNT(*) AS sent_emails_exists
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'sent_emails';
```
Value should be `1`.

### Full validation (after all four)
Run `000_validate_functions.sql` in the SQL Editor.
Look for `NOTICE: PASS:` lines for every check. Any `ERROR:` or `FAIL:`
means a migration did not apply correctly.

---

## What to do if a migration fails partway through

**The good news:** Postgres wraps each SQL statement in a transaction by
default when run from the Supabase SQL Editor. If any statement errors, the
entire file is rolled back — you get either all of it or none of it.
There is no "half-applied migration" state.

**Recovery steps:**

1. **Read the error message carefully.** Supabase shows the exact line and
   error in the output panel. Common causes:
   - `already exists` — the table or policy was already created. Safe to
     ignore if you are re-running a migration. All statements use `IF NOT
     EXISTS` guards to prevent this, but policy names are not guarded.
   - `function X does not exist` — you skipped a prerequisite migration.
     Run the earlier migration first.
   - `column X of relation Y already exists` — the `ALTER TABLE ... ADD COLUMN
     IF NOT EXISTS` guard should prevent this, but if it occurs it means the
     column already exists. Safe to ignore.

2. **For a `policy already exists` error:**
   The policy guards (`IF NOT EXISTS`) are not available in older Postgres
   versions. If you see `ERROR: policy "xyz" for table "abc" already exists`,
   add `DROP POLICY IF EXISTS "xyz" ON abc;` before the `CREATE POLICY`
   statement and re-run.

3. **For any other error:**
   Do not run subsequent migrations until the failing one is resolved.
   The validation script (`000_validate_functions.sql`) will tell you exactly
   what is missing.

4. **If you need to fully reset (development only — never production):**
   Go to Supabase Dashboard → Settings → Database → "Reset database".
   This drops everything. Then re-run 001 → 002 → 003 → 004 from scratch.

---

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Running 003 before 001 | `ERROR: relation "workspaces" does not exist` | Run 001 first |
| Running 003 before 001 on a DB where 001 tables exist but functions don't | `ERROR: function is_workspace_owner_or_admin(uuid) does not exist` | Run 001 first, or run the safety-net CREATE OR REPLACE from the top of 003 separately |
| Running 004 before 003 | `ERROR: function is_workspace_owner_or_admin(uuid) does not exist` | Run 003 first |
| Re-running a migration without `IF NOT EXISTS` awareness | `ERROR: policy "xyz" already exists` | Drop the existing policy first or skip the policy statement |
| Forgetting to enable email confirmation in Auth settings | Users can sign up without verifying email | Authentication → Providers → Email → Enable "Confirm email" |
| Not setting the redirect URL | OAuth callback returns 404 | Authentication → URL Configuration → add /api/auth/callback |

---

## Environment-specific notes

### Local development (Supabase CLI)
```bash
supabase start          # start local Postgres + Auth + Studio
supabase db reset       # reset and re-apply all migrations in supabase/migrations/
supabase db diff        # see what changed vs remote
supabase db push        # push local schema to remote project
```

The CLI applies files in **alphabetical order** by filename. The `000_`
prefix on the validation script means it would run first if using `db reset`
— but since it contains only `DO $$ ... $$` read-only assertions, this is
safe.

### Staging environment
Treat staging as a production clone. Never run `db reset` on staging.
Apply migrations one at a time and run the validation script after each.

### Production
- Always test migrations on staging first
- Run during low-traffic periods
- Have a backup point taken in the last 24 hours (Supabase Pro: daily
  automatic backups; Free tier: manual export via `pg_dump`)
- Run the validation script immediately after applying

---

## Quick reference card

```
Fresh project setup:
  001 → 002 → 003 → 004 → 000 (validate)

Adding migrations to existing project:
  Apply only new files → 000 (validate)

Validation only:
  000_validate_functions.sql

Auth configuration (Supabase Dashboard):
  Authentication → Providers → Email → Confirm email: ON
  Authentication → URL Config → Site URL: https://your-domain.com
  Authentication → URL Config → Redirect URLs: https://your-domain.com/api/auth/callback
```
