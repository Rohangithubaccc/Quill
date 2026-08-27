import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  return jsonOk({ workspace })
}

const PatchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  industry: z.string().max(100).optional(),
  brand_voice: z.string().max(3000).optional(),
})

export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  if (!['owner', 'admin'].includes(role)) {
    return jsonError('Only owners and admins can update workspace settings', 403)
  }

  let body: z.infer<typeof PatchSchema>
  try { body = PatchSchema.parse(await req.json()) } catch (e) {
    return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body')
  }

  const admin = createSupabaseAdmin()

  const { error } = await admin
    .from('workspaces')
    .update(body)
    .eq('id', workspace.id)

  if (error) return dbError('workspace', error, 'Update failed. Please try again.', 500)

  return jsonOk({ updated: true })
}
