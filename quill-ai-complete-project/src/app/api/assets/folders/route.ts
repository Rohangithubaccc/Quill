import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

const CreateSchema = z.object({
  name:            z.string().min(1).max(100),
  parentFolderId:  z.string().uuid().nullable().optional(),
})

// GET /api/assets/folders — flat list; the frontend builds the tree from
// parent_folder_id, same approach as most folder-tree UIs (small enough
// datasets per workspace that a recursive query isn't worth the complexity).
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data: folders, error } = await admin
    .from('asset_folders')
    .select('id, name, parent_folder_id, created_at')
    .eq('workspace_id', workspace.id)
    .order('name', { ascending: true })

  if (error) return dbError('assets/folders', error, 'Query failed. Please try again.', 500)

  // Include a per-folder asset count — cheap enough as a single follow-up
  // query rather than N+1 (one count query per folder).
  const { data: counts } = await admin
    .from('assets')
    .select('folder_id')
    .eq('workspace_id', workspace.id)
    .not('folder_id', 'is', null)

  const countMap = new Map<string, number>()
  for (const row of counts ?? []) {
    const fid = row.folder_id as string
    countMap.set(fid, (countMap.get(fid) ?? 0) + 1)
  }

  return jsonOk({
    items: (folders ?? []).map(f => ({ ...f, assetCount: countMap.get(f.id) ?? 0 })),
  })
}

// POST /api/assets/folders — create
export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }
  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  let body: z.infer<typeof CreateSchema>
  try { body = CreateSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  const admin = createSupabaseAdmin()

  if (body.parentFolderId) {
    const { data: parent } = await admin.from('asset_folders').select('id').eq('id', body.parentFolderId).eq('workspace_id', workspace.id).single()
    if (!parent) return jsonError('Parent folder not found', 404)
  }

  const { data: folder, error } = await admin
    .from('asset_folders')
    .insert({ workspace_id: workspace.id, name: body.name, parent_folder_id: body.parentFolderId ?? null, created_by: user.id })
    .select()
    .single()

  if (error) return dbError('assets/folders', error, 'Failed to create folder. Please try again.', 500)
  return jsonOk({ folder }, 201)
}
