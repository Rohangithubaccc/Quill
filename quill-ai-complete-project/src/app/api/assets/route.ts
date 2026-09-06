import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'
import { getLimiter, checkLimit, rateLimitResponse } from '@/lib/rate-limit'
import { storageLimitMessage } from '@/lib/storage-quota'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024   // 10MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024  // 200MB

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

// Per-workspace: uploads are cheap individually but a library feature is
// still worth throttling against runaway automated uploads.
const uploadLimiter = getLimiter('rl:asset-upload:ws', 60, '1 h')

export const runtime     = 'nodejs'
export const maxDuration = 60   // videos can be large; storage upload alone may take a while

// Magic-byte verification — same reasoning as the Knowledge Base and logo
// uploads (src/lib/knowledge-base.ts, src/app/api/upload/logo/route.ts):
// file.type is client-supplied and trivially spoofed.
function verifyAssetSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  if (mimeType === 'image/gif') {
    const sig = buffer.subarray(0, 6).toString('ascii')
    return sig === 'GIF87a' || sig === 'GIF89a'
  }
  if (mimeType === 'video/mp4' || mimeType === 'video/quicktime') {
    // MP4/MOV (both are ISO base media file format): bytes 4-7 spell
    // "ftyp" in every valid file, regardless of the specific brand that
    // follows it.
    return buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  }
  if (mimeType === 'video/webm') {
    // EBML header magic bytes
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
  }
  return false
}

// GET /api/assets — list, with folder/type/tag/search filters
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { searchParams } = new URL(req.url)
  const folderId = searchParams.get('folder_id')
  const assetType = searchParams.get('type')
  const tag = searchParams.get('tag')
  const q = searchParams.get('q')?.trim()

  const admin = createSupabaseAdmin()
  let query = admin
    .from('assets')
    .select('id, name, asset_type, storage_path, mime_type, file_size_bytes, width, height, tags, used_count, folder_id, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })

  // folder_id=root is a sentinel for "top-level only" (folder_id IS NULL) —
  // omitting the param entirely means "no folder filter, show everything".
  if (folderId === 'root') query = query.is('folder_id', null)
  else if (folderId) query = query.eq('folder_id', folderId)

  if (assetType) query = query.eq('asset_type', assetType)
  if (tag) query = query.contains('tags', [tag])
  if (q) query = query.textSearch('name', q, { type: 'websearch' })

  const { data: items, error } = await query
  if (error) return dbError('assets', error, 'Query failed. Please try again.', 500)

  // Public bucket (migration 024) — build the servable URL for each asset,
  // matching the .getPublicUrl(path) pattern already used elsewhere
  // (src/app/api/upload/logo/route.ts, src/inngest/functions.ts) rather
  // than trying to construct a bucket-base URL from an empty path.
  const withUrls = (items ?? []).map(a => ({
    ...a,
    url: admin.storage.from('dam-assets').getPublicUrl(a.storage_path).data.publicUrl,
  }))

  return jsonOk({ items: withUrls })
}

// POST /api/assets — upload
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const { success, reset } = await checkLimit(uploadLimiter, workspace.id)
  if (!success) return rateLimitResponse('Too many assets uploaded recently. Try again later.', reset)

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const folderId = formData.get('folder_id') as string | null
  const tagsRaw = formData.get('tags') as string | null

  if (!file) return jsonError('No file provided')

  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
  if (!isImage && !isVideo) {
    return jsonError('File type not allowed. Accepted: PNG, JPEG, WebP, GIF, MP4, WebM, MOV')
  }

  const maxSize = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
  if (file.size > maxSize) {
    return jsonError(`File too large. Maximum size is ${Math.round(maxSize / (1024 * 1024))}MB.`)
  }
  if (file.size === 0) return jsonError('File is empty')

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!verifyAssetSignature(buffer, file.type)) {
    return jsonError("This file's contents don't match its claimed type. Please upload a genuine file of the selected format.")
  }

  const admin = createSupabaseAdmin()

  // Validate folder belongs to this workspace, if specified.
  if (folderId) {
    const { data: folder } = await admin.from('asset_folders').select('id').eq('id', folderId).eq('workspace_id', workspace.id).single()
    if (!folder) return jsonError('Folder not found', 404)
  }

  // Reserve quota BEFORE touching Storage — same atomic conditional-UPDATE
  // pattern as deduct_credits() (migration 026), so concurrent uploads to
  // the same workspace can't both pass a stale pre-upload check and
  // jointly blow past the limit. See migration 027_storage_quota.sql.
  const { data: reserveResult } = await admin.rpc('reserve_storage', {
    p_workspace_id: workspace.id,
    p_bytes:        file.size,
  })
  const reserve = reserveResult?.[0]
  if (!reserve?.success) {
    return jsonError(storageLimitMessage(reserve?.new_used_bytes ?? 0, reserve?.limit_bytes ?? 0), 402)
  }

  const storagePath = `${workspace.id}/${crypto.randomUUID()}-${file.name}`
  const { error: uploadErr } = await admin.storage
    .from('dam-assets')
    .upload(storagePath, buffer, { contentType: file.type })

  if (uploadErr) {
    await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspace.id, p_bytes: file.size })).catch(() => {})
    return jsonError('Upload failed: ' + uploadErr.message, 500)
  }

  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20) : []

  const { data: asset, error: insertErr } = await admin
    .from('assets')
    .insert({
      workspace_id:    workspace.id,
      folder_id:       folderId || null,
      uploaded_by:     user.id,
      name:            file.name,
      asset_type:      isImage ? 'image' : 'video',
      storage_path:    storagePath,
      mime_type:       file.type,
      file_size_bytes: file.size,
      tags,
    })
    .select()
    .single()

  if (insertErr) {
    await admin.storage.from('dam-assets').remove([storagePath])
    await Promise.resolve(admin.rpc('release_storage', { p_workspace_id: workspace.id, p_bytes: file.size })).catch(() => {})
    return jsonError('Failed to save asset record: ' + insertErr.message, 500)
  }

  const { data: { publicUrl } } = admin.storage.from('dam-assets').getPublicUrl(storagePath)
  return jsonOk({ asset: { ...asset, url: publicUrl } }, 201)
}
