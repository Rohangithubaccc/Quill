import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { Resend } from 'resend'
import { MentionEmail } from '@/emails/MentionEmail'
import React from 'react'

// Lazily instantiated so importing this module never crashes when
// RESEND_API_KEY isn't set yet — only sending an email requires the key.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/content/[id]/comments
// Returns all comments for a content piece, ordered by created_at ASC.
// Includes user display info (email truncated to first part before @).
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) {
    return workspaceCatch(e)
  }

  const admin = createSupabaseAdmin()

  // Verify the content piece belongs to this workspace
  const { data: piece, error: pieceErr } = await admin
    .from('content_pieces')
    .select('id, workspace_id')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single()

  if (pieceErr || !piece) {
    return jsonError('Content not found or access denied', 404)
  }

  // Fetch comments with user email via join to auth.users
  // We use a raw query through the admin client so we can JOIN auth.users
  const { data: comments, error: commentsErr } = await admin
    .from('comments')
    .select(`
      id,
      content_id,
      user_id,
      body,
      metadata,
      resolved_at,
      created_at,
      user:user_id ( email )
    `)
    .eq('content_id', id)
    .order('created_at', { ascending: true })

  if (commentsErr) {
    console.error('[comments/GET] Supabase error:', commentsErr)
    return jsonError('Failed to fetch comments', 500)
  }

  // Flatten the user email into the comment object, truncating to before @
  const shaped = (comments ?? []).map((c: any) => ({
    id:          c.id,
    content_id:  c.content_id,
    user_id:     c.user_id,
    body:        c.body,
    metadata:    c.metadata ?? {},
    resolved_at: c.resolved_at ?? null,
    created_at:  c.created_at,
    user_email:  (c.user?.email as string | undefined) ?? '',
  }))

  return jsonOk(shaped)
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/content/[id]/comments
// Body: { body, selectionOffset?, selectionText?, mentions? }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let user: Awaited<ReturnType<typeof requireUser>>
  try { user = await requireUser() }
  catch { return jsonError('Unauthorized', 401) }

  let workspace: Awaited<ReturnType<typeof requireWorkspace>>['workspace']
  try {
    const result = await requireWorkspace(user.id)
    workspace = result.workspace
  } catch (e) {
    return workspaceCatch(e)
  }

  const admin = createSupabaseAdmin()

  // ── Parse and validate body ───────────────────────────────────────────────
  let body: string
  let selectionOffset: number | undefined
  let selectionText: string | undefined
  let mentions: string[] | undefined

  try {
    const parsed = await req.json()
    body            = parsed.body
    selectionOffset = parsed.selectionOffset
    selectionText   = parsed.selectionText
    mentions        = parsed.mentions
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return jsonError('Comment body is required', 400)
  }
  if (body.length > 2000) {
    return jsonError('Comment body must be 2000 characters or fewer', 400)
  }
  if (selectionText && selectionText.length > 200) {
    selectionText = selectionText.substring(0, 200)
  }

  // ── Verify content piece belongs to this workspace ────────────────────────
  const { data: piece, error: pieceErr } = await admin
    .from('content_pieces')
    .select('id, workspace_id, title')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single()

  if (pieceErr || !piece) {
    return jsonError('Content not found or access denied', 404)
  }

  // ── Insert comment ────────────────────────────────────────────────────────
  const metadata: Record<string, unknown> = {}
  if (selectionOffset !== undefined) metadata.selectionOffset = selectionOffset
  if (selectionText)                 metadata.selectionText   = selectionText
  if (mentions?.length)              metadata.mentions        = mentions

  const { data: inserted, error: insertErr } = await admin
    .from('comments')
    .insert({
      content_id: id,
      user_id:    user.id,
      body:       body.trim(),
      metadata,
    })
    .select()
    .single()

  if (insertErr || !inserted) {
    console.error('[comments/POST] Insert error:', insertErr)
    return jsonError('Failed to post comment', 500)
  }

  // ── Fetch commenter email for mention notifications ───────────────────────
  // Supabase's query builder is a "thenable", not a real Promise, so it has
  // no .catch() of its own. Wrap with Promise.resolve() to get a real one.
  const { data: commenterData } = await Promise.resolve(
    admin
      .from('profiles')                          // or auth.users — adjust to your schema
      .select('email')
      .eq('id', user.id)
      .single()
  ).catch(() => ({ data: null })) as any

  // Fallback: look up via auth admin API
  let commenterEmail = commenterData?.email ?? ''
  if (!commenterEmail) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(user.id)
      commenterEmail = authUser?.user?.email ?? ''
    } catch { /* best-effort */ }
  }
  const commenterName = commenterEmail.split('@')[0] || 'Someone'

  // ── Fire mention emails (non-blocking) ───────────────────────────────────
  if (mentions && mentions.length > 0) {
    const reviewUrl = `${process.env.NEXT_PUBLIC_URL ?? ''}/review`

    // Only notify users who are actual workspace members
    const { data: members } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspace.id)
      .eq('status', 'active')

    const memberUserIds = new Set((members ?? []).map((m: any) => m.user_id))

    // Resolve mentioned emails to user IDs, filter to workspace members
    const uniqueMentions = [...new Set(mentions)]
    uniqueMentions.forEach((mentionedEmail) => {
      // Fire-and-forget; do not block the response.
      //
      // NOTE: membership is checked against `memberUserIds`, computed once
      // above from the `members` query at the top of this function — there
      // is no need for a second workspace_members query per mention here.
      // (An earlier version of this code re-queried workspace_members and
      // used its result only as an execution gate via .then(), discarding
      // the actual query result — that redundant query has been removed;
      // this preserves the exact same behavior with one fewer DB round trip
      // per mention.)
      ;(async () => {
        try {
          let mentionedUserId: string | null = null
          try {
            const { data } = await admin.auth.admin.listUsers()
            const found = data?.users?.find((u: any) => u.email === mentionedEmail)
            mentionedUserId = found?.id ?? null
          } catch { return }

          if (!mentionedUserId || !memberUserIds.has(mentionedUserId)) return

          await getResend().emails
            .send({
              from:    process.env.EMAIL_FROM ?? 'noreply@quill.ai',
              to:      mentionedEmail,
              subject: `${commenterName} mentioned you in a comment`,
              react:   React.createElement(MentionEmail, {
                mentionerEmail:  commenterEmail,
                contentTitle:    piece.title ?? 'Untitled',
                commentBody:     body.trim(),
                reviewUrl,
              }),
            })
        } catch (err) {
          console.error('[comments/POST] Mention processing failed:', err)
        }
      })()
    })
  }

  // Return the created comment with user_email attached
  return jsonOk({
    ...inserted,
    user_email: commenterEmail,
  })
}
