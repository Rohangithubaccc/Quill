import { Inngest } from 'inngest'

// ─────────────────────────────────────────────────────────────────────────────
// Single Inngest client instance shared across all functions and the
// /api/inngest serve handler.
//
// Environment variables (set automatically by the Vercel ↔ Inngest integration,
// or manually in your .env.local for local dev):
//   INNGEST_EVENT_KEY   — authenticates event sends from your server
//   INNGEST_SIGNING_KEY — verifies that incoming webhook calls are from Inngest
//
// Local development:
//   npx inngest-cli@latest dev
//   (starts a local Inngest server at http://localhost:8288 — no env vars needed)
// ─────────────────────────────────────────────────────────────────────────────

export const inngest = new Inngest({
  id:   'quill-ai',
  name: 'Quill.AI',
})
