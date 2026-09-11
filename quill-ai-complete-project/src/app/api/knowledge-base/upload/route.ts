import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'
import { detectFileType, verifySignature } from '@/lib/knowledge-base'
import { getLimiter, checkLimit, rateLimitResponse } from '@/lib/rate-limit'
import { storageLimitMessage } from '@/lib/storage-quota'

const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB — generous for brand guides/whitepapers

// Per-workspace: each upload triggers an Inngest job that calls the
// OpenAI embeddings API (real cost) and does real parsing work — worth
// throttling independently of the credit system, which doesn't cover
// this pipeline at all.
const uploadLimiter = getLimiter('rl:kb-upload:ws', 10, '1 h')

export const runtime     = 'nodejs'
export const maxDuration = 30   // upload + storage write only; extraction/embedding run async in Inngest

// POST /api/knowledge-base/upload — any active member can upload
// (matches content_pieces INSERT policy: creation isn't owner-gated).
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { success, reset } = await checkLimit(uploadLimiter, workspace.id)
  if (!success) {
    return rateLimitResponse('Too many documents uploaded recently. Try again later.', reset)
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return jsonError('No file provided')

  const fileType = detectFileType(file.name, file.type)
  if (!fileType) return jsonError('Unsupported file type. Accepted: PDF, DOCX, TXT')
  if (file.size > MAX_SIZE_BYTES) return jsonError('File too large. Maximum size is 20MB.')
  if (file.size === 0) return jsonError('File is empty')

  const admin = createSupabaseAdmin()
  const storagePath = `${workspace.id}/${crypto.randomUUID()}-${file.name}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Filename extension and client Content-Type are both spoofable — check
  // what the file's bytes actually are before storing or processing it.
  // Runs before the quota reservation below so a rejected file never
  // consumes one.
  if (!verifySignature(buffer, fileType)) {
    return jsonError(
      `This file's contents don't match a ${fileType.toUpperCase()} file. ` +
      `Check the file isn't corrupted or renamed from a different format.`,
    )
  }

  // Reserve quota BEFORE touching Storage — see migration
  // 027_storage_quota.sql and the identical check in
  // src/app/api/assets/route.ts for the reasoning.
  const { data: reserveResult } = await admin.rpc('reserve_storage', {
    p_workspace_id: workspace.id,
    p_bytes:        file.size,
  })
  const reserve = reserveResult?.[0]
  if (!reserve?.success) {
    return jsonError(storageLimitMessage(reserve?.new_used_bytes ?? 0, reserve?.limit_bytes ?? 0), 402)
  }

  const { error: uploadErr } = await admin.storage
    .from('knowledge-base')
    .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream' })

  if (uploadErr) {
    await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspace.id, p_bytes: file.size })).catch(() => {})
    return jsonError('Upload failed: ' + uploadErr.message, 500)
  }

  const { data: document, error: insertErr } = await admin
    .from('knowledge_documents')
    .insert({
      workspace_id:    workspace.id,
      uploaded_by:     user.id,
      filename:        file.name,
      file_type:       fileType,
      storage_path:    storagePath,
      file_size_bytes: file.size,
      status:          'processing',
    })
    .select()
    .single()

  if (insertErr) {
    // Don't leave an orphaned file in storage if the DB insert failed
    await admin.storage.from('knowledge-base').remove([storagePath])
    await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspace.id, p_bytes: file.size })).catch(() => {})
    return jsonError('Failed to save document record: ' + insertErr.message, 500)
  }

  const { inngest } = await import('@/inngest/client')
  await inngest.send({
    name: 'quill/knowledge.document.process',
    data: {
      documentId:  document.id,
      workspaceId: workspace.id,
      storagePath,
      fileType,
    },
  })

  return jsonOk({ document }, 201)
}
