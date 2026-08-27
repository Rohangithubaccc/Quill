-- ── Migration 010: job_results — async background job tracking ──────────────
--
-- Used by Inngest functions (bulk repurpose, plagiarism check, PDF export)
-- to record job status so the client can poll for completion.
--
-- Poll pattern (client side):
--   GET /api/jobs/{jobId}  →  { status: 'running' | 'complete' | 'failed', result }
--
-- Run: supabase db push  (or paste into Supabase dashboard SQL editor)

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_results (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     TEXT        NOT NULL,
  -- job_type values:
  --   'bulk_repurpose'  — one job per "Repurpose All" click
  --   'pdf_export'      — one job per PDF export request
  --   'plagiarism_check' — one job per plagiarism check (result also stored
  --                        on content_pieces; this row is the polling target)

  workspace_id UUID        REFERENCES workspaces(id) ON DELETE CASCADE,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- payload shape per job_type:
  --   bulk_repurpose:   { contentId, repurposeTypes, totalSteps }
  --   pdf_export:       { contentId, title }
  --   plagiarism_check: { contentId }

  status       TEXT        NOT NULL DEFAULT 'pending',
  -- status: 'pending' | 'running' | 'complete' | 'failed'

  result       JSONB,
  -- result shape per job_type (populated on completion):
  --   bulk_repurpose:   { pieces: [{ type, pieceId }], completedAt }
  --   pdf_export:       { downloadUrl, completedAt }
  --   plagiarism_check: { aiScore, originalityScore, reportUrl }

  error        TEXT,
  -- Human-readable error message, populated when status = 'failed'

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── updated_at trigger ────────────────────────────────────────────────────────
-- Keeps updated_at current so clients can sort by recency without querying result.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_results_updated_at ON job_results;
CREATE TRIGGER job_results_updated_at
  BEFORE UPDATE ON job_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Workspace members can read their own workspace's jobs.
-- Inngest functions write via the service role (bypasses RLS — correct).

ALTER TABLE job_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_read_own_workspace_jobs"
  ON job_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
       WHERE workspace_id = job_results.workspace_id
         AND user_id      = auth.uid()
         AND status       = 'active'
    )
  );

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Used by GET /api/jobs/{jobId} — primary lookup
-- (Primary key index already covers this; explicit for clarity.)

-- Partial index: only in-flight jobs need fast workspace+status lookups.
-- Completed/failed jobs are queried by id only.
CREATE INDEX IF NOT EXISTS job_results_workspace_status_idx
  ON job_results(workspace_id, status)
  WHERE status IN ('pending', 'running');

-- Age index for the cleanup cron
CREATE INDEX IF NOT EXISTS job_results_created_at_idx
  ON job_results(created_at);

-- ── Automatic cleanup (optional) ─────────────────────────────────────────────
-- Delete completed/failed jobs older than 7 days to keep the table small.
-- Enable pg_cron in the Supabase dashboard (Database → Extensions → pg_cron),
-- then uncomment:
--
-- SELECT cron.schedule(
--   'cleanup-old-job-results',
--   '0 3 * * *',   -- 3 AM UTC every day
--   $$
--     DELETE FROM job_results
--     WHERE created_at < NOW() - INTERVAL '7 days'
--       AND status IN ('complete', 'failed')
--   $$
-- );
