import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch } from '@/lib/utils'

export const runtime     = 'nodejs'
export const maxDuration = 30

// GET /api/gdpr/export
// Bundles every workspace-scoped table into a single JSON download.
//
// Deliberately excludes:
//   - integrations.config       — encrypted third-party credentials
//                                  (WordPress app password, Buffer tokens)
//   - webhook_endpoints.secret  — encrypted HMAC signing secret
//   - workspaces.byok_api_key_encrypted and related BYOK columns
//   - knowledge_chunks          — embedding vectors, not personal data,
//                                  and large; the parent knowledge_documents
//                                  row (filename, type, status) is included
//   - job_results / generation_logs / byok_usage_log / performance_events
//     — internal operational logs, not user-generated content
// These are operational/credential data, not "the user's data" in the
// GDPR portability sense — including them would be a real credential leak
// if this export file were ever intercepted or stored insecurely.
//
// Runs during a pending-deletion grace period too (allowPendingDeletion) —
// someone who just requested deletion should still be able to get a final
// copy of their data before the 30-day purge.
export async function GET(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace
  try { ({ workspace } = await requireWorkspace(user.id, { allowPendingDeletion: true })) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()
  const wsId = workspace.id

  const [
    workspaceProfile,
    members,
    contentPieces,
    calendarEvents,
    campaigns,
    assets,
    assetFolders,
    knowledgeDocuments,
    approvalStages,
    approvalHistory,
    webhookEndpoints,
    integrations,
  ] = await Promise.all([
    admin.from('workspaces')
      .select('id, name, slug, plan, industry, brand_voice, brand_knowledge, logo_url, stripe_customer_id, created_at')
      .eq('id', wsId).single(),
    admin.from('workspace_members')
      .select('user_id, role, status, invited_email, created_at')
      .eq('workspace_id', wsId),
    admin.from('content_pieces')
      .select('id, title, content, industry, content_type, tone, keyword, target_audience, word_count, platforms, brand_voice, status, engagement_score, created_at, updated_at')
      .eq('workspace_id', wsId).is('deleted_at', null),
    admin.from('calendar_events')
      .select('id, content_id, title, platform, scheduled_at, status, created_at')
      .eq('workspace_id', wsId),
    admin.from('campaigns')
      .select('id, name, description, goal, status, start_date, end_date, created_at, updated_at')
      .eq('workspace_id', wsId),
    admin.from('assets')
      .select('id, name, asset_type, mime_type, file_size_bytes, width, height, tags, folder_id, created_at')
      .eq('workspace_id', wsId),
    admin.from('asset_folders')
      .select('id, name, parent_folder_id, created_at')
      .eq('workspace_id', wsId),
    admin.from('knowledge_documents')
      .select('id, filename, file_type, file_size_bytes, status, created_at')
      .eq('workspace_id', wsId),
    admin.from('workspace_approval_stages')
      .select('id, stage_index, name, required_role, created_at')
      .eq('workspace_id', wsId),
    admin.from('approval_history')
      .select('id, content_id, stage_index, stage_name, action, actor_user_id, note, created_at')
      .eq('workspace_id', wsId),
    admin.from('webhook_endpoints')
      .select('id, url, events, description, is_active, last_fired_at, created_at')
      .eq('workspace_id', wsId),
    admin.from('integrations')
      .select('id, provider, status, connected_at, created_at')
      .eq('workspace_id', wsId),
  ])

  // content_versions and comments key off content_id, not workspace_id
  // directly — scope them through the content piece IDs just fetched
  // above rather than a second round-trip to re-derive the same list.
  const pieceIds = (contentPieces.data ?? []).map(p => p.id)

  const [versions, comments] = pieceIds.length
    ? await Promise.all([
        admin.from('content_versions')
          .select('id, content_id, version_number, content, created_by, created_at')
          .in('content_id', pieceIds),
        admin.from('comments')
          .select('id, content_id, user_id, body, created_at')
          .in('content_id', pieceIds),
      ])
    : [{ data: [] }, { data: [] }]

  const exportPayload = {
    exported_at: new Date().toISOString(),
    workspace:   workspaceProfile.data,
    members:     members.data ?? [],
    content: {
      pieces:   contentPieces.data ?? [],
      versions: versions.data ?? [],
      comments: comments.data ?? [],
    },
    calendar_events:      calendarEvents.data ?? [],
    campaigns:            campaigns.data ?? [],
    assets:                assets.data ?? [],
    asset_folders:         assetFolders.data ?? [],
    knowledge_documents:   knowledgeDocuments.data ?? [],
    approval: {
      stages:  approvalStages.data ?? [],
      history: approvalHistory.data ?? [],
    },
    webhook_endpoints: webhookEndpoints.data ?? [],
    integrations:      integrations.data ?? [],
    _excluded_note: 'Encrypted credentials (third-party integration config, webhook signing secrets, BYOK API keys) and internal operational logs are intentionally not included in this export.',
  }

  return new Response(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
