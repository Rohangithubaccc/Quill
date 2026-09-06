import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/content/[id]/comments/[commentId]
// Body: { resolved: boolean }
//
// This handler used to live in ../route.ts (i.e. registered under
// /api/content/[id]/comments with no [commentId] segment at all) even
// though its own doc comment and every frontend caller
// (src/app/(app)/review/page.tsx) always hit
// /api/content/{contentId}/comments/{commentId} — a URL that file could
// never match. The result: this handler was fully unreachable, a 404 at
// Next's router level before any of its code ever ran, so "resolve this
// comment" was broken end-to-end. Found while auditing this route for
// the Next.js 15 params-Promise migration; moved here (the location the
// URL and the code always assumed) as part of that same pass rather than
// leaving it broken under a new signature.
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { commentId } = await params

  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  let memberRole: string
  try {
    const result = await requireWorkspace(user.id)
    workspace  = result.workspace
    memberRole = result.role ?? 'member'
  } catch (e) {
    return workspaceCatch(e)
  }

  const admin = createSupabaseAdmin()

  // Parse body
  let resolved: boolean
  try {
    const parsed = await req.json()
    if (typeof parsed.resolved !== 'boolean') {
      return jsonError('`resolved` must be a boolean', 400)
    }
    resolved = parsed.resolved
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  // Fetch the comment to check ownership
  const { data: comment, error: commentErr } = await admin
    .from('comments')
    .select('id, user_id, content_id')
    .eq('id', commentId)
    .single()

  if (commentErr || !comment) {
    return jsonError('Comment not found', 404)
  }

  // Verify the content belongs to this workspace (prevents cross-workspace tampering)
  const { data: piece, error: pieceErr } = await admin
    .from('content_pieces')
    .select('id')
    .eq('id', comment.content_id)
    .eq('workspace_id', workspace.id)
    .single()

  if (pieceErr || !piece) {
    return jsonError('Access denied', 403)
  }

  // Permission check: owners/admins can resolve any comment; members only their own
  const isPrivileged = ['owner', 'admin'].includes(memberRole)
  if (!isPrivileged && comment.user_id !== user.id) {
    return jsonError('You can only resolve your own comments', 403)
  }

  const { data: updated, error: updateErr } = await admin
    .from('comments')
    .update({
      resolved_at: resolved ? new Date().toISOString() : null,
    })
    .eq('id', commentId)
    .select()
    .single()

  if (updateErr || !updated) {
    console.error('[comments/PATCH] Update error:', updateErr)
    return jsonError('Failed to update comment', 500)
  }

  return jsonOk(updated)
}
