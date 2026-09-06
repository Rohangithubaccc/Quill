import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

// GET /api/knowledge-base — list documents for the workspace
export async function GET(_req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data: items, error } = await admin
    .from('knowledge_documents')
    .select('id, filename, file_type, file_size_bytes, status, error_message, chunk_count, flagged_content, flagged_reasons, scan_status, scan_detail, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })

  if (error) return dbError('knowledge-base', error, 'Query failed. Please try again.', 500)
  return jsonOk({ items: items ?? [] })
}
