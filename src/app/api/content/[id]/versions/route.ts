import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, countWords } from '@/lib/utils'

// ── GET /api/content/[id]/versions ────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()

  // Verify content belongs to this workspace
  const { data: piece, error: pieceErr } = await admin
    .from('content_pieces')
    .select('id, workspace_id')
    .eq('id', id)
    .single()

  if (pieceErr || !piece || piece.workspace_id !== workspace.id) {
    return jsonError('Content not found', 404)
  }

  const { searchParams } = new URL(req.url)
  const versionId = searchParams.get('versionId')

  // ── Single version fetch ───────────────────────────────────────────────
  if (versionId) {
    const { data: version, error } = await admin
      .from('content_versions')
      .select('id, version_number, content, created_at, created_by')
      .eq('content_id', id)
      .eq('id', versionId)
      .single()

    if (error || !version) return jsonError('Version not found', 404)
    return jsonOk({ version })
  }

  // ── List all versions ──────────────────────────────────────────────────
  const { data: versions, error } = await admin
    .from('content_versions')
    .select('id, version_number, content, created_at, created_by')
    .eq('content_id', id)
    .order('version_number', { ascending: false })

  if (error) return jsonError('Failed to fetch versions', 500)

  // Build preview (first 120 chars of content, stripped of whitespace/markdown)
  const formatted = (versions ?? []).map(v => ({
    id: v.id,
    version_number: v.version_number,
    created_at: v.created_at,
    created_by: v.created_by,
    word_count: v.content
      ? countWords(v.content)
      : 0,
    preview: v.content
      ? v.content
          .replace(/#+\s/g, '')
          .replace(/\*\*/g, '')
          .trim()
          .substring(0, 120) + (v.content.length > 120 ? '…' : '')
      : '',
  }))

  return jsonOk({ versions: formatted, contentId: id })
}
