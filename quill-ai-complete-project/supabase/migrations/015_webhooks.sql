-- ── Migration 015: outbound webhooks ─────────────────────────────────────────
--
-- Enables workspace owners/admins to register HTTP endpoints that receive
-- signed event payloads when key actions happen in Quill.AI.
--
-- Supported events:
--   content.generated   — fired after every AI generation
--   content.approved    — fired when a reviewer approves content
--   content.published   — fired after WordPress/LinkedIn/Buffer publish
--   usage.limit_warning — fired when credits_remaining < 20% of credits_monthly
--
-- Payload signature: HMAC-SHA256 in X-Quill-Signature header ("sha256={hex}")
-- Run AFTER: 014_image_generation.sql

-- ── Webhook endpoints ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url           TEXT        NOT NULL,
  events        TEXT[]      NOT NULL DEFAULT '{}',
  -- Empty array = subscribe to ALL events (convenience wildcard)
  -- Non-empty = only listed events, e.g. '{content.generated,content.approved}'
  secret        TEXT        NOT NULL,
  -- Stored ENCRYPTED with encrypt() from src/lib/utils.ts.
  -- NEVER returned in plain after creation. Only masked '••••••••' on GET.
  description   TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  last_fired_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_admins_manage_webhooks"
  ON webhook_endpoints FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = webhook_endpoints.workspace_id
        AND user_id      = auth.uid()
        AND role         IN ('owner','admin')
        AND status       = 'active'
    )
  );

-- Fast lookup: active endpoints for a workspace (hot path in dispatch)
CREATE INDEX IF NOT EXISTS webhook_endpoints_workspace_active_idx
  ON webhook_endpoints(workspace_id)
  WHERE is_active = true;

-- ── Webhook deliveries (audit log) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id   UUID        REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  workspace_id  UUID        NOT NULL,
  event_type    TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  status_code   INTEGER,
  response_body TEXT,       -- first 500 chars of response
  success       BOOLEAN     NOT NULL DEFAULT false,
  duration_ms   INTEGER,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners_admins_read_deliveries"
  ON webhook_deliveries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = webhook_deliveries.workspace_id
        AND user_id      = auth.uid()
        AND role         IN ('owner','admin')
        AND status       = 'active'
    )
  );

-- Index for "show recent deliveries for this endpoint"
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
  ON webhook_deliveries(endpoint_id, fired_at DESC);

-- Auto-delete delivery logs older than 30 days (keep table small)
-- Uncomment after enabling pg_cron (Database → Extensions → pg_cron):
-- SELECT cron.schedule('cleanup-webhook-deliveries','0 4 * * *',
--   $$DELETE FROM webhook_deliveries WHERE fired_at < NOW() - INTERVAL '30 days'$$);
