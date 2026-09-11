import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseAdmin, requireUser } from '@/lib/supabase/server'
import { jsonError, jsonOk } from '@/lib/utils'

export async function POST(req: NextRequest) {
  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  const { token } = await req.json() as { token?: string }
  if (!token) return jsonError('Token is required')

  const admin = createSupabaseAdmin()

  // Look up the invite
  const { data: invite, error: invErr } = await admin
    .from('workspace_invites')
    .select('id, workspace_id, email, role, status, expires_at')
    .eq('token', token)
    .single()

  if (invErr || !invite) return jsonError('Invitation not found or already used', 404)
  if (invite.status !== 'pending') return jsonError('This invitation has already been used or expired', 410)
  if (new Date(invite.expires_at) < new Date()) {
    await admin.from('workspace_invites').update({ status: 'expired' }).eq('id', invite.id)
    return jsonError('This invitation has expired', 410)
  }

  // Verify the invite email matches the logged-in user's email
  if (invite.email.toLowerCase() !== user.email?.toLowerCase()) {
    return jsonError(
      `This invitation was sent to ${invite.email}. Please sign in with that email address.`,
      403
    )
  }

  // Check not already a member
  const { data: existingMember } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', invite.workspace_id)
    .eq('user_id', user.id)
    .single()

  if (existingMember) {
    // Already a member — just accept and redirect
    await admin.from('workspace_invites').update({ status: 'accepted' }).eq('id', invite.id)
  } else {
    // Add to workspace
    const { error: memberErr } = await admin.from('workspace_members').insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
      status: 'active',
      invited_email: invite.email,
    })

    if (memberErr) return jsonError('Failed to join workspace', 500)

    // Mark invite as accepted
    await admin.from('workspace_invites').update({ status: 'accepted' }).eq('id', invite.id)
  }

  // Set workspace cookie
  const cookieStore = await cookies()
  cookieStore.set('workspace_id', invite.workspace_id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  })

  return jsonOk({ workspace_id: invite.workspace_id, role: invite.role })
}
