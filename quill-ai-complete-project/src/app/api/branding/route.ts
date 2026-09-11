import { NextRequest } from 'next/server'
import { z }           from 'zod'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, jsonOk, workspaceCatch, dbError } from '@/lib/utils'

// PATCH /api/branding
// Updates brand_primary_color, brand_company_name, white_label_enabled
// White-label toggle restricted to Agency plan workspaces.

const BrandingSchema = z.object({
  brand_primary_color: z.string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid 6-digit hex color (e.g. #1a73e8)')
    .optional(),
  brand_company_name:  z.string().max(60).nullable().optional(),
  white_label_enabled: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' })

export async function PATCH(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any, role = ''
  try { ({ workspace, role } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }
  if (role !== 'owner') return jsonError('Only workspace owners can update branding', 403)

  let body: z.infer<typeof BrandingSchema>
  try { body = BrandingSchema.parse(await req.json()) }
  catch (e) { return jsonError(e instanceof z.ZodError ? e.errors[0].message : 'Invalid body') }

  // White-label mode requires Agency plan
  if (body.white_label_enabled === true && workspace.plan !== 'agency') {
    return jsonError(
      'White-label mode requires the Agency plan. ' +
      'Upgrade at Settings → Billing to unlock this feature.',
      403
    )
  }

  const admin = createSupabaseAdmin()
  const { error } = await admin.from('workspaces')
    .update(body)
    .eq('id', workspace.id)

  if (error) return dbError('branding', error, 'Failed to update branding. Please try again.', 500)

  return jsonOk({ updated: true, ...body })
}

// GET /api/branding — fetch current branding settings
export async function GET(_req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const { data, error } = await admin.from('workspaces')
    .select('brand_primary_color, brand_company_name, white_label_enabled, logo_url, plan')
    .eq('id', workspace.id)
    .single()

  if (error || !data) return jsonError('Failed to fetch branding', 500)

  return jsonOk({
    brand_primary_color: data.brand_primary_color ?? '#6c63ff',
    brand_company_name:  data.brand_company_name  ?? null,
    white_label_enabled: data.white_label_enabled ?? false,
    logo_url:            data.logo_url            ?? null,
    plan:                data.plan,
    can_white_label:     data.plan === 'agency',
  })
}
