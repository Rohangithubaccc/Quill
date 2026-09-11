-- ============================================================
-- Quill.AI — Migration Validation Script
-- ============================================================
--
-- PURPOSE:  Verify that all required database functions, tables,
--           columns, indexes, and RLS policies exist and are
--           correctly defined after running migrations 001–004.
--
-- USAGE:    Paste this entire file into Supabase Dashboard →
--           SQL Editor and click Run.
--           All assertions must return TRUE or raise 0 errors.
--
-- SAFE TO RUN MULTIPLE TIMES: This script makes no schema changes.
--           Every statement is a read-only assertion or a DO block
--           that raises an exception only on failure.
--
-- WHEN TO RUN:
--   • After applying migrations to a new environment
--   • After a Supabase restore/clone
--   • As part of a pre-launch checklist
--   • Any time you suspect a migration was partially applied
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- SECTION 1: Function existence checks
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn_count INTEGER;
BEGIN
  -- Check is_workspace_member exists
  SELECT COUNT(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'is_workspace_member';

  IF fn_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: is_workspace_member() not found. '
      'Run migration 001_initial_schema.sql first.';
  ELSE
    RAISE NOTICE 'PASS: is_workspace_member() exists (% definition/s)', fn_count;
  END IF;

  -- Check is_workspace_owner_or_admin exists
  SELECT COUNT(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'is_workspace_owner_or_admin';

  IF fn_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: is_workspace_owner_or_admin() not found. '
      'Run migration 001_initial_schema.sql first.';
  ELSE
    RAISE NOTICE 'PASS: is_workspace_owner_or_admin() exists (% definition/s)', fn_count;
  END IF;

  -- Check update_updated_at trigger function exists
  SELECT COUNT(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'update_updated_at';

  IF fn_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: update_updated_at() trigger function not found. '
      'Run migration 001_initial_schema.sql first.';
  ELSE
    RAISE NOTICE 'PASS: update_updated_at() trigger function exists';
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 2: Function return-type checks
-- Confirm each function returns BOOLEAN and uses SECURITY DEFINER
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- is_workspace_member
  SELECT p.prosecdef, t.typname
  INTO rec
  FROM pg_proc p
  JOIN pg_namespace n  ON n.oid = p.pronamespace
  JOIN pg_type t       ON t.oid = p.prorettype
  WHERE n.nspname = 'public'
    AND p.proname = 'is_workspace_member'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: is_workspace_member() not found during type check';
  END IF;
  IF rec.typname <> 'bool' THEN
    RAISE EXCEPTION 'FAIL: is_workspace_member() returns % (expected bool)', rec.typname;
  END IF;
  IF NOT rec.prosecdef THEN
    RAISE EXCEPTION 'FAIL: is_workspace_member() is not SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'PASS: is_workspace_member() → bool, SECURITY DEFINER ✓';

  -- is_workspace_owner_or_admin
  SELECT p.prosecdef, t.typname
  INTO rec
  FROM pg_proc p
  JOIN pg_namespace n  ON n.oid = p.pronamespace
  JOIN pg_type t       ON t.oid = p.prorettype
  WHERE n.nspname = 'public'
    AND p.proname = 'is_workspace_owner_or_admin'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: is_workspace_owner_or_admin() not found during type check';
  END IF;
  IF rec.typname <> 'bool' THEN
    RAISE EXCEPTION 'FAIL: is_workspace_owner_or_admin() returns % (expected bool)', rec.typname;
  END IF;
  IF NOT rec.prosecdef THEN
    RAISE EXCEPTION 'FAIL: is_workspace_owner_or_admin() is not SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'PASS: is_workspace_owner_or_admin() → bool, SECURITY DEFINER ✓';
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 3: Core table existence checks (migration 001)
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
  tbl_count INTEGER;
  required_tables TEXT[] := ARRAY[
    'workspaces',
    'workspace_members',
    'content_pieces',
    'content_versions',
    'calendar_events',
    'comments',
    'integrations',
    'performance_events',
    'generation_logs',
    'analyzer_cache',
    'waitlist'
  ];
BEGIN
  FOREACH tbl IN ARRAY required_tables LOOP
    SELECT COUNT(*) INTO tbl_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = tbl;

    IF tbl_count = 0 THEN
      RAISE EXCEPTION 'FAIL: Table "%" not found. Run migration 001 first.', tbl;
    ELSE
      RAISE NOTICE 'PASS: Table "%" exists', tbl;
    END IF;
  END LOOP;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 4: Migration 002 table and column checks
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl_count INTEGER;
  col_count INTEGER;
BEGIN
  -- workspace_invites table
  SELECT COUNT(*) INTO tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name   = 'workspace_invites';

  IF tbl_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: Table "workspace_invites" not found. '
      'Run migration 002_invites_and_fts.sql.';
  ELSE
    RAISE NOTICE 'PASS: Table "workspace_invites" exists';
  END IF;

  -- content_pieces.fts generated column
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'content_pieces'
    AND column_name  = 'fts';

  IF col_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: Generated column content_pieces.fts not found. '
      'Run migration 002_invites_and_fts.sql.';
  ELSE
    RAISE NOTICE 'PASS: content_pieces.fts generated column exists';
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 5: Migration 003 column and table checks
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  col_count INTEGER;
  tbl_count INTEGER;
BEGIN
  -- workspaces.trial_ends_at
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'workspaces'
    AND column_name  = 'trial_ends_at';

  IF col_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: Column workspaces.trial_ends_at not found. '
      'Run migration 003_billing_and_gdpr.sql.';
  ELSE
    RAISE NOTICE 'PASS: workspaces.trial_ends_at column exists';
  END IF;

  -- workspaces.subscription_status
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'workspaces'
    AND column_name  = 'subscription_status';

  IF col_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: Column workspaces.subscription_status not found. '
      'Run migration 003_billing_and_gdpr.sql.';
  ELSE
    RAISE NOTICE 'PASS: workspaces.subscription_status column exists';
  END IF;

  -- usage_overages table
  SELECT COUNT(*) INTO tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name   = 'usage_overages';

  IF tbl_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: Table "usage_overages" not found. '
      'Run migration 003_billing_and_gdpr.sql.';
  ELSE
    RAISE NOTICE 'PASS: Table "usage_overages" exists';
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 6: Migration 004 table check
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name   = 'sent_emails';

  IF tbl_count = 0 THEN
    RAISE EXCEPTION
      'FAIL: Table "sent_emails" not found. '
      'Run migration 004_email_tracking.sql.';
  ELSE
    RAISE NOTICE 'PASS: Table "sent_emails" exists';
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 7: RLS enabled checks
-- Every table must have RLS enabled before launch.
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
  rls_enabled BOOLEAN;
  rls_tables TEXT[] := ARRAY[
    'workspaces',
    'workspace_members',
    'content_pieces',
    'content_versions',
    'calendar_events',
    'comments',
    'integrations',
    'performance_events',
    'generation_logs',
    'analyzer_cache',
    'waitlist',
    'workspace_invites',
    'usage_overages',
    'sent_emails'
  ];
BEGIN
  FOREACH tbl IN ARRAY rls_tables LOOP
    SELECT relrowsecurity INTO rls_enabled
    FROM pg_class
    WHERE relname = tbl
      AND relnamespace = (
        SELECT oid FROM pg_namespace WHERE nspname = 'public'
      );

    IF NOT FOUND THEN
      RAISE WARNING 'SKIP: Table "%" does not exist — cannot check RLS', tbl;
    ELSIF NOT rls_enabled THEN
      RAISE EXCEPTION
        'FAIL: RLS is NOT enabled on table "%". '
        'This is a security vulnerability — do not launch.', tbl;
    ELSE
      RAISE NOTICE 'PASS: RLS enabled on "%"', tbl;
    END IF;
  END LOOP;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 8: RLS policy existence checks
-- Verify at least one SELECT policy exists on the critical tables.
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl TEXT;
  policy_count INTEGER;
  policy_tables TEXT[] := ARRAY[
    'workspaces',
    'workspace_members',
    'content_pieces',
    'usage_overages',
    'sent_emails'
  ];
BEGIN
  FOREACH tbl IN ARRAY policy_tables LOOP
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = tbl
      AND cmd        = 'SELECT';

    IF policy_count = 0 THEN
      RAISE EXCEPTION
        'FAIL: No SELECT policy found on table "%". '
        'Check migration files and re-run.', tbl;
    ELSE
      RAISE NOTICE 'PASS: % SELECT policy/policies on "%"', policy_count, tbl;
    END IF;
  END LOOP;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 9: Key index existence checks
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  idx TEXT;
  idx_count INTEGER;
  required_indexes TEXT[] := ARRAY[
    'idx_wm_workspace',
    'idx_wm_user',
    'idx_cp_workspace',
    'idx_cp_status',
    'idx_cp_fts',
    'idx_ce_workspace',
    'idx_ce_scheduled_at',
    'idx_overages_workspace',
    'idx_overages_attempted',
    'idx_sent_emails_workspace',
    'idx_sent_emails_type_sent',
    'idx_invites_token'
  ];
BEGIN
  FOREACH idx IN ARRAY required_indexes LOOP
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = idx;

    IF idx_count = 0 THEN
      RAISE EXCEPTION
        'FAIL: Index "%" not found. Check migration files.', idx;
    ELSE
      RAISE NOTICE 'PASS: Index "%" exists', idx;
    END IF;
  END LOOP;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- SECTION 10: Summary
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Quill.AI Migration Validation Complete';
  RAISE NOTICE 'If you see this message, all assertions passed.';
  RAISE NOTICE 'Your database schema is ready for production.';
  RAISE NOTICE '============================================================';
END;
$$;
