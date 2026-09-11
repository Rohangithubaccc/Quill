-- ── Migration 033: SQL-level aggregation for performance events ─────────────
--
-- Found during the load/performance pass of the review: GET
-- /api/performance (a real, user-facing, on-demand page load — the
-- Performance dashboard) fetched every individual performance_events row
-- matching the filter and counted them in a JavaScript loop, with no
-- upper bound. For a single piece of genuinely popular published content
-- — the tracking pixel described in the original roadmap fires on every
-- page view — a 90-day window could mean tens or hundreds of thousands
-- of raw rows transferred over the network just to compute four integers
-- per content piece. The same pattern also exists in the weekly
-- aggregate-engagement cron; that one is lower urgency since it isn't
-- blocking a user's page load, and is left as a known follow-on rather
-- than fixed in this pass.
--
-- Moves the counting into Postgres, which is what it's for — GROUP BY
-- with an index-covered scan is meaningfully cheaper than fetching every
-- row, and critically, the amount of data sent back to the app server is
-- now O(content pieces × event types), not O(events).
--
-- Run AFTER: 032_harden_storage_functions.sql

-- Composite index matching the exact query shape (filter by content_id
-- set + occurred_at range, group by content_id + event_type) — the three
-- existing single-column indexes (migration 001) can be combined via a
-- bitmap scan, but a covering composite index is meaningfully faster at
-- the row counts this is meant to handle.
CREATE INDEX IF NOT EXISTS idx_pe_content_occurred_type
  ON performance_events(content_id, occurred_at, event_type);

CREATE OR REPLACE FUNCTION get_content_event_counts(
  p_content_ids UUID[],
  p_since       TIMESTAMPTZ
)
RETURNS TABLE(content_id UUID, event_type TEXT, event_count BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT content_id, event_type, COUNT(*) AS event_count
  FROM performance_events
  WHERE content_id = ANY(p_content_ids)
    AND occurred_at >= p_since
  GROUP BY content_id, event_type
$$;

-- STABLE (not VOLATILE) tells Postgres this can be optimized/cached
-- within a single query — it only reads, never writes. Callable by
-- anyone who can already read performance_events (RLS on the underlying
-- table still applies to who can invoke this, same as any other
-- SECURITY INVOKER function); no elevated privilege here since this
-- route already used the service_role admin client for the raw query it
-- replaces.
GRANT EXECUTE ON FUNCTION get_content_event_counts(UUID[], TIMESTAMPTZ) TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
-- SELECT * FROM get_content_event_counts(ARRAY['<some-content-id>']::uuid[], NOW() - INTERVAL '30 days');
-- EXPLAIN ANALYZE should show the composite index being used, not a full
-- table scan, and the row count returned should be
-- (content pieces × event types actually present), not raw event count.
