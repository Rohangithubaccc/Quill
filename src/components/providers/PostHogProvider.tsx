'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { initPostHog, posthog, identifyUser } from '@/lib/posthog'

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const supabase = createSupabaseBrowserClient()
  const identified = useRef(false)

  // Initialize PostHog once on mount
  useEffect(() => {
    initPostHog()
  }, [])

  // Identify user on mount
  useEffect(() => {
    if (identified.current) return

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return

      // Fetch workspace plan for segmentation
      // Cast to any: this loose Database stub can't resolve Supabase's
      // nested-join type inference for aliased relations like
      // `workspace:workspaces(...)`. Real generated types would resolve
      // this correctly — see src/lib/types/database.ts for details.
      const { data: member } = await (supabase
        .from('workspace_members')
        .select('workspace:workspaces(name, plan)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1)
        .single() as any)

      identifyUser(user.id, {
        email: user.email,
        plan: (member?.workspace as any)?.plan ?? 'unknown',
        workspace_name: (member?.workspace as any)?.name ?? 'unknown',
      })

      identified.current = true
    })
  }, [])

  // Track page views on pathname change
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.capture('$pageview', { $current_url: window.location.href })
    }
  }, [pathname])

  return <>{children}</>
}
