import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

function getIdFromUrl(req: NextRequest): string {
  const segments = new URL(req.url).pathname.split('/')
  return segments[segments.length - 1]
}

// DELETE /api/knowledge-base/:id
// Any active member can delete (matches the RLS policy on
// knowledge_documents — same convention as content_pieces deletion isn't
// owner-gated at this granularity; unlike campaigns, a single uploaded
// document isn't workspace-wide config, so no extra role check here).
export async function DELETE(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const id = getIdFromUrl(req)
  const admin = createSupabaseAdmin()

  const { data: doc } = await admin
    .from('knowledge_documents')
    .select('id, storage_path, file_size_bytes')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single()

  if (!doc) return jsonError('Document not found', 404)

  // knowledge_chunks rows cascade automatically via
  // ON DELETE CASCADE (migration 020).
  const { error } = await admin.from('knowledge_documents').delete().eq('id', id)
  if (error) return dbError('knowledge-base/:id', error, 'Delete failed. Please try again.', 500)

  // Best-effort storage cleanup — the DB row is already gone either way,
  // so a storage failure here shouldn't surface as an error to the user.
  await admin.storage.from('knowledge-base').remove([doc.storage_path]).catch(() => {})

  // Same best-effort reasoning for freeing the quota back up (see the
  // matching comment in assets/[id]/route.ts DELETE).
  if (doc.file_size_bytes) {
    await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspace.id, p_bytes: doc.file_size_bytes })).catch(() => {})
  }

  return jsonOk({ deleted: true })
}
