/**
 * posthog.ts
 * PostHog analytics client — browser only.
 * Server-side tracking uses posthog-node (imported separately where needed).
 */

import posthog from 'posthog-js'

let initialized = false

export function initPostHog(): void {
  if (typeof window === 'undefined') return
  if (initialized) return
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    capture_pageview: false,    // manually per pathname change
    capture_pageleave: true,
    persistence: 'localStorage+cookie',
    person_profiles: 'identified_only', // GDPR: only profile logged-in users
    autocapture: false,          // we capture events explicitly
    disable_session_recording: false,
    sanitize_properties(props: Record<string, unknown>) {
      // Strip PII that might be auto-captured
      delete props['$referrer']
      delete props['$initial_referrer']
      return props
    },
  })

  initialized = true
}

export { posthog }

// ── Typed event helpers ────────────────────────────────────────────────────
// Centralise event names to avoid typos across pages

export const track = {
  // Generator
  contentGenerated(props: {
    industry: string; content_type: string; word_count: number
    tone: string; platforms: string[]
  }) {
    posthog.capture('content_generated', props)
  },

  contentPublished(props: { platform: string; content_id?: string }) {
    posthog.capture('content_published', props)
  },

  contentCopied() {
    posthog.capture('content_copied')
  },

  pdfDownloaded(props: { content_id: string }) {
    posthog.capture('pdf_downloaded', props)
  },

  // Calendar
  contentScheduled(props: { platform: string; via: 'manual' | 'auto' }) {
    posthog.capture('content_scheduled', props)
  },

  contentRescheduled(props: { via: 'drag_drop' | 'edit' }) {
    posthog.capture('content_rescheduled', props)
  },

  autoScheduleUsed(props: { count: number }) {
    posthog.capture('auto_schedule_used', props)
  },

  // Review queue
  contentApproved() {
    posthog.capture('content_approved')
  },

  contentRejected() {
    posthog.capture('content_rejected')
  },

  // Settings
  integrationConnected(props: { provider: string }) {
    posthog.capture('integration_connected', props)
  },

  teamInviteSent(props: { role: string }) {
    posthog.capture('team_invite_sent', props)
  },

  workspaceSwitched() {
    posthog.capture('workspace_switched')
  },

  // Search
  searchPerformed(props: { query: string; result_count: number }) {
    posthog.capture('search_performed', props)
  },
}

export function identifyUser(userId: string, props: {
  email?: string; plan?: string; workspace_name?: string
}) {
  posthog.identify(userId, props)
}

export function resetUser() {
  posthog.reset()
}
