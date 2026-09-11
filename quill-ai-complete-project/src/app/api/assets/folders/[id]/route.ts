import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const PatchSchema = z.object({
  name: z.string().min(1).max(100),
})

function getIdFromUrl(req: NextRequest): string {
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 1]
}

// PATCH /api/assets/folders/:id — rename
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
  const { data: folder, error } = await admin
    .from('asset_folders')
    .update({ name: body.name })
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .select()
    .single()

  if (error || !folder) return jsonError('Folder not found', 404)
  return jsonOk({ folder })
}

// DELETE /api/assets/folders/:id — deletes the folder; assets inside move
// to "unfiled" (ON DELETE SET NULL on assets.folder_id), never deleted.
// Nested subfolders cascade-delete (ON DELETE CASCADE on parent_folder_id)
// — their assets also fall back to unfiled via the same SET NULL rule.
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const id = getIdFromUrl(req)
  const admin = createSupabaseAdmin()

  const { data: existing } = await admin.from('asset_folders').select('id').eq('id', id).eq('workspace_id', workspace.id).single()
  if (!existing) return jsonError('Folder not found', 404)

  const { error } = await admin.from('asset_folders').delete().eq('id', id)
  if (error) return dbError('assets/folders/:id', error, 'Delete failed. Please try again.', 500)

  return jsonOk({ deleted: true })
}
