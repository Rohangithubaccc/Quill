import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// GET /api/jobs/[id]
// Polls a background job (image_generation, bulk_repurpose).
// Returns: { id, job_type, status, result, error, created_at, updated_at }
// Client clears its interval when status === 'complete' | 'failed'.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data: job, error } = await admin
    .from('job_results')
    .select('id, job_type, workspace_id, payload, status, result, error, created_at, updated_at')
    .eq('id', id)
    .eq('workspace_id', workspace.id)   // cross-workspace guard on top of RLS
    .single()

  if (error || !job) return jsonError('Job not found', 404)

  return jsonOk({
    id:         job.id,
    job_type:   job.job_type,
    status:     job.status,
    result:     job.result    ?? null,
    error:      job.error     ?? null,
    payload:    job.payload   ?? {},
    created_at: job.created_at,
    updated_at: job.updated_at,
  })
}
