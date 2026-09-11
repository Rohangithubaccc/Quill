import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

const UseSchema = z.object({
  contentId: z.string().uuid(),
})

function getAssetIdFromUrl(req: NextRequest): string {
  // path is /api/assets/:id/use — the id is the second-to-last segment
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 2]
}

// POST /api/assets/:id/use — attach an asset to a content piece, and bump
// its used_count. Called from the generator/campaign UI when someone
// picks an existing asset instead of generating a new image.
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const assetId = getAssetIdFromUrl(req)

  let body: z.infer<typeof UseSchema>
  try { body = UseSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  const { data: asset } = await admin.from('assets').select('id').eq('id', assetId).eq('workspace_id', workspace.id).single()
  if (!asset) return jsonError('Asset not found', 404)

  const { data: piece } = await admin.from('content_pieces').select('id').eq('id', body.contentId).eq('workspace_id', workspace.id).single()
  if (!piece) return jsonError('Content piece not found', 404)

  const { error: linkErr } = await admin.from('content_piece_assets').upsert(
    { content_id: body.contentId, asset_id: assetId },
    { onConflict: 'content_id,asset_id' },
  )
  if (linkErr) return jsonError('Failed to link asset: ' + linkErr.message, 500)

  // Atomic — see migration 026_atomic_credits.sql. Lower stakes than
  // credits (a display counter, not billing), but the same read-then-
  // write-in-JS pattern was here too, so fixed the same way while
  // already touching this class of bug.
  await admin.rpc('increment_asset_used_count', { p_asset_id: assetId })

  return jsonOk({ linked: true })
}
