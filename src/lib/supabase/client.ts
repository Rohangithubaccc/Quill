'use client'

import { createBrowserClient } from '@supabase/ssr'
// NOTE: <Database> generic intentionally omitted here.
// src/lib/types/database.ts is a placeholder stub (no real project has been
// connected). Its index-signature Tables shape doesn't satisfy Supabase's
// generic type resolution for named-table operations across the app, which
// cascades into `never` types at update/insert/select call sites everywhere.
// Supabase-js's own documented default for this generic is `any` when
// omitted — so this has ZERO effect on runtime behavior. Once you replace
// src/lib/types/database.ts with real output from
// `supabase gen types typescript`, re-add `<Database>` here for full
// compile-time table/column type-checking.

let client: ReturnType<typeof createBrowserClient> | null = null

/** Browser singleton client — safe to call from client components */
export function createSupabaseBrowserClient() {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  return client
}
