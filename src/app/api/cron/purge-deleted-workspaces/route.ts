import { NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

export const runtime     = 'nodejs'
export const maxDuration = 60

// GET /api/cron/purge-deleted-workspaces
// Schedule: 0 4 * * *  (daily, 4am UTC)
// Vercel Cron calls this with the x-cron-secret header — same auth
// pattern as /api/cron/reset-usage.
//
// Hard-deletes any workspace whose 30-day GDPR grace period (migration
// 028) has elapsed. Nearly every workspace-scoped table already has
// `workspace_id ... ON DELETE CASCADE` (checked every migration, see the
// comment in 028_gdpr_deletion.sql) — so the DB side is one DELETE.
// Storage isn't part of that cascade, so those objects are removed
// explicitly first, per real path shape (checked the actual upload code,
// not assumed uniform):
//   dam-assets/{workspaceId}/...
//   knowledge-base/{workspaceId}/...
//   brand-assets/{workspaceId}/...          (logo)
//   brand-assets/images/{workspaceId}/...   (DALL-E header images, PDF exports)
async function purgeBucketPrefix(
  admin: ReturnType<typeof createSupabaseAdmin>,
  bucket: string,
  prefix: string,
) {
  const pageSize = 1000
  let offset = 0
  for (;;) {
    const { data: files } = await admin.storage.from(bucket).list(prefix, { limit: pageSize, offset })
    if (!files?.length) break
    await admin.storage.from(bucket).remove(files.map(f => `${prefix}/${f.name}`)).catch(() => {})
    if (files.length < pageSize) break
    offset += pageSize
  }
}

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError('Unauthorized', 401)
  }

  const admin = createSupabaseAdmin()

  const { data: due, error } = await admin
    .from('workspaces')
    .select('id, name')
    .not('scheduled_purge_at', 'is', null)
    .lte('scheduled_purge_at', new Date().toISOString())

  if (error) {
    console.error('[Cron] purge-deleted-workspaces query failed:', error)
    return jsonError('Query failed: ' + error.message, 500)
  }

  const results: Array<{ workspaceId: string; purged: boolean; error?: string }> = []

  for (const ws of due ?? []) {
    try {
      await purgeBucketPrefix(admin, 'dam-assets',     ws.id)
      await purgeBucketPrefix(admin, 'knowledge-base', ws.id)
      await purgeBucketPrefix(admin, 'brand-assets',   ws.id)
      await purgeBucketPrefix(admin, 'brand-assets',   `images/${ws.id}`)

      // CASCADE takes care of every other row referencing this workspace.
      const { error: deleteErr } = await admin.from('workspaces').delete().eq('id', ws.id)
      if (deleteErr) throw new Error(deleteErr.message)

      results.push({ workspaceId: ws.id, purged: true })
      console.log(`[Cron] Purged workspace ${ws.id} (${ws.name})`)
    } catch (e) {
      results.push({ workspaceId: ws.id, purged: false, error: e instanceof Error ? e.message : String(e) })
      console.error(`[Cron] Failed to purge workspace ${ws.id}:`, e)
    }
  }

  return jsonOk({ checked: due?.length ?? 0, purged: results.filter(r => r.purged).length, results })
}
