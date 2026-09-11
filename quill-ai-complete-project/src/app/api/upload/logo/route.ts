import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch } from '@/lib/utils'

// SVG intentionally excluded: it's an XML format that can embed executable
// <script> tags and event-handler attributes. This bucket is public, so a
// malicious SVG served at its direct storage URL (not just rendered inside
// an <img> tag elsewhere in the app, where browsers don't execute embedded
// SVG scripts, but the raw URL itself, which anyone can open directly)
// would run as a real stored-XSS payload. PNG/JPEG/WebP cover every
// realistic logo use case without that risk category existing at all —
// safer than trying to hand-sanitize SVG content, which is easy to get
// subtly wrong.
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2MB

// Magic-byte signatures — file.type is client-supplied and trivially
// spoofed (nothing stops a browser from setting an arbitrary MIME type on
// a File/Blob), so it's a filter on what the uploader *claims*, not a
// verification of what the bytes actually are.
function verifyImageSignature(buffer: Buffer, claimedType: string): boolean {
  if (claimedType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (claimedType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (claimedType === 'image/webp') {
    // RIFF????WEBP — bytes 0-3 are "RIFF", bytes 8-11 are "WEBP"
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const formData = await req.formData()
  const file = formData.get('logo') as File | null

  if (!file) return jsonError('No file provided')
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonError(`File type not allowed. Accepted: PNG, JPEG, WebP`)
  }
  if (file.size > MAX_SIZE_BYTES) {
    return jsonError('File too large. Maximum size is 2MB.')
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (!verifyImageSignature(buffer, file.type)) {
    return jsonError('This file\'s contents don\'t match its claimed type. Please upload a genuine PNG, JPEG, or WebP image.')
  }

  const ext = file.name.split('.').pop() ?? 'png'
  const path = `${workspace.id}/logo.${ext}`

  const admin = createSupabaseAdmin()

  const { error: uploadErr } = await admin.storage
    .from('brand-assets')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadErr) return jsonError('Upload failed: ' + uploadErr.message, 500)

  const { data: { publicUrl } } = admin.storage
    .from('brand-assets')
    .getPublicUrl(path)

  // Update workspace logo_url
  await admin
    .from('workspaces')
    .update({ logo_url: publicUrl })
    .eq('id', workspace.id)

  return jsonOk({ url: publicUrl })
}
