import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const PatchSchema = z.object({
  name:      z.string().min(1).max(300).optional(),
  folder_id: z.string().uuid().nullable().optional(),
  tags:      z.array(z.string().max(50)).max(20).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

function getIdFromUrl(req: NextRequest): string {
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 1]
}

// PATCH /api/assets/:id — rename, move to a different folder, or retag
export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const id = getIdFromUrl(req)

  let body: z.infer<typeof PatchSchema>
  try { body = PatchSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  const { data: existing } = await admin.from('assets').select('id').eq('id', id).eq('workspace_id', workspace.id).single()
  if (!existing) return jsonError('Asset not found', 404)

  if (body.folder_id) {
    const { data: folder } = await admin.from('asset_folders').select('id').eq('id', body.folder_id).eq('workspace_id', workspace.id).single()
    if (!folder) return jsonError('Folder not found', 404)
  }

  const updatePayload: Record<string, unknown> = {}
  if (body.name !== undefined)      updatePayload.name      = body.name
  if (body.folder_id !== undefined) updatePayload.folder_id = body.folder_id
  if (body.tags !== undefined)      updatePayload.tags      = body.tags

  const { data: asset, error } = await admin.from('assets').update(updatePayload).eq('id', id).select().single()
  if (error) return dbError('assets/:id', error, 'Update failed. Please try again.', 500)

  return jsonOk({ asset })
}

// DELETE /api/assets/:id
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const id = getIdFromUrl(req)
  const admin = createSupabaseAdmin()

  const { data: existing } = await admin.from('assets').select('id, storage_path, file_size_bytes').eq('id', id).eq('workspace_id', workspace.id).single()
  if (!existing) return jsonError('Asset not found', 404)

  // content_piece_assets rows referencing this asset cascade automatically
  // (ON DELETE CASCADE, migration 024) — the content pieces themselves are
  // untouched, only the link row.
  const { error } = await admin.from('assets').delete().eq('id', id)
  if (error) return dbError('assets/:id', error, 'Delete failed. Please try again.', 500)

  await admin.storage.from('dam-assets').remove([existing.storage_path]).catch(() => {})

  // Free the quota back up — best-effort like the storage removal above;
  // the DB row is already gone either way, so a failure here shouldn't
  // block the delete from completing (it just means the counter runs a
  // little high until the next reserve_storage() call self-corrects it,
  // never a little low, which is the safer direction to drift).
  if (existing.file_size_bytes) {
    await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspace.id, p_bytes: existing.file_size_bytes })).catch(() => {})
  }

  return jsonOk({ deleted: true })
}
