import { NextRequest } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

export const runtime     = 'nodejs'
export const maxDuration = 60

// GET /api/cron/purge-deleted-content
// Schedule: 0 5 * * *  (daily, 5am UTC — after the workspace purge cron)
//
// content_pieces.deleted_at (migration 001) makes content deletion soft:
// the row and its header_image_url (a real Storage file) persist
// indefinitely, with nothing to ever reclaim that space. This is the
// missing other half — hard-deletes anything soft-deleted more than
// CONTENT_RETENTION_DAYS ago.
//
// content_pieces has no RESTRICT-mode foreign keys anywhere (checked
// every migration): content_versions, comments, calendar link rows, and
// content_piece_assets link rows all CASCADE; calendar_events.content_id,
// generation_logs.content_id, and content_pieces.parent_id (repurpose
// lineage) all SET NULL by design, so a hard DELETE here is safe on its
// own — no separate cleanup pass needed for any of those.
//
// DAM assets are NOT touched, on purpose: content_piece_assets cascading
// only removes the *link* row, never the underlying `assets` row — an
// asset can be attached to multiple content pieces and is an independent,
// reusable library item, not owned by any single piece.
//
// Storage cleanup covers DALL-E header images
// (images/{workspaceId}/{contentId}-*.png) and PDF exports
// (images/{workspaceId}/export-{contentId}-*.pdf) — both live under the
// same brand-assets/images/{workspaceId} prefix, matched by contentId
// substring, one paginated list() per workspace rather than per piece.
// Real byte sizes come from Storage's own file metadata (confirmed via
// the storage-js FileMetadata type, not assumed), so the quota released
// is exact — not the flat-estimate approximation migration 027's backfill
// had to use for pre-existing images with no tracked size.
//
// Rows are claimed atomically via claim_content_for_purge() (migration
// 035) before anything storage-related is computed — found via a real
// concurrent-invocation test that two overlapping runs would otherwise
// both list the same not-yet-removed files, both compute the same
// bytesReleased, and both call release_storage() with it, silently
// double-releasing quota that was only actually freed once. The DELETE
// at the bottom was never the unsafe part on its own (Postgres DELETE
// ... WHERE id IN (...) is naturally idempotent), but it now only ever
// runs against IDs this invocation itself claimed.
const CONTENT_RETENTION_DAYS = 30
const REMOVE_BATCH_SIZE      = 100

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '')

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return jsonError('Unauthorized', 401)
  }

  const admin = createSupabaseAdmin()

  const { data: due, error } = await admin.rpc('claim_content_for_purge', {
    p_retention_days: CONTENT_RETENTION_DAYS,
  })

  if (error) {
    console.error('[Cron] purge-deleted-content claim failed:', error)
    return jsonError('Claim failed: ' + error.message, 500)
  }

  // Group by workspace so each workspace's images/{workspaceId} prefix is
  // listed once, not once per content piece.
  const byWorkspace = new Map<string, string[]>()
  for (const piece of due ?? []) {
    const list = byWorkspace.get(piece.workspace_id) ?? []
    list.push(piece.id)
    byWorkspace.set(piece.workspace_id, list)
  }

  const results: Array<{ workspaceId: string; piecesPurged: number; bytesReleased: number; error?: string }> = []

  for (const [workspaceId, contentIds] of byWorkspace) {
    try {
      const prefix = `images/${workspaceId}`

      // Paginate the full listing — a workspace can have more files than
      // one page, and every one needs checking against every due content
      // ID, not just the first 1000.
      const allFiles: { name: string; size: number }[] = []
      let offset = 0
      for (;;) {
        const { data: files } = await admin.storage.from('brand-assets').list(prefix, { limit: 1000, offset })
        if (!files?.length) break
        allFiles.push(...files.map(f => ({ name: f.name, size: f.metadata?.size ?? 0 })))
        if (files.length < 1000) break
        offset += 1000
      }

      const toRemove: string[] = []
      let bytesReleased = 0
      for (const file of allFiles) {
        if (contentIds.some(id => file.name.includes(id))) {
          toRemove.push(`${prefix}/${file.name}`)
          bytesReleased += file.size
        }
      }

      for (let i = 0; i < toRemove.length; i += REMOVE_BATCH_SIZE) {
        await admin.storage.from('brand-assets').remove(toRemove.slice(i, i + REMOVE_BATCH_SIZE)).catch(() => {})
      }

      if (bytesReleased > 0) {
        await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspaceId, p_bytes: bytesReleased })).catch(() => {})
      }

      const { error: deleteErr } = await admin.from('content_pieces').delete().in('id', contentIds)
      if (deleteErr) throw new Error(deleteErr.message)

      results.push({ workspaceId, piecesPurged: contentIds.length, bytesReleased })
      console.log(`[Cron] Purged ${contentIds.length} content piece(s) for workspace ${workspaceId}, released ${bytesReleased} bytes`)
    } catch (e) {
      results.push({ workspaceId, piecesPurged: 0, bytesReleased: 0, error: e instanceof Error ? e.message : String(e) })
      console.error(`[Cron] Failed to purge content for workspace ${workspaceId}:`, e)
    }
  }

  return jsonOk({
    checked:       due?.length ?? 0,
    piecesPurged:  results.reduce((sum, r) => sum + r.piecesPurged, 0),
    bytesReleased: results.reduce((sum, r) => sum + r.bytesReleased, 0),
    results,
  })
}
