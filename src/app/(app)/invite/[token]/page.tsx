import { createSupabaseAdmin } from '@/lib/supabase/server'
import InviteAcceptClient from './InviteAcceptClient'

interface Invite {
  id: string
  workspace_id: string
  email: string
  role: string
  expires_at: string
  workspace: { name: string } | null
  inviter: { full_name?: string; email?: string } | null
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createSupabaseAdmin()

  // Look up invite with workspace info
  // Cast to any: this loose Database stub can't resolve Supabase's
  // nested-join type inference for aliased relations like
  // `workspace:workspaces(...)`. Real generated types would resolve
  // this correctly — see src/lib/types/database.ts for details.
  const { data: invite, error } = await (admin
    .from('workspace_invites')
    .select(`
      id, workspace_id, email, role, status, expires_at,
      workspace:workspaces(name),
      inviter:auth.users!invited_by(raw_user_meta_data)
    `)
    .eq('token', token)
    .single() as any)

  const isExpired =
    error ||
    !invite ||
    invite.status !== 'pending' ||
    new Date(invite.expires_at) < new Date()

  if (isExpired) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '24px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(108,99,255,0.1) 0%, transparent 60%), #0f0f13',
        fontFamily: 'Inter, sans-serif',
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap'); body{margin:0;background:#0f0f13;color:#e8e8f0}`}</style>
        <div style={{
          background: '#1e1e28', border: '1px solid rgba(240,101,101,0.3)',
          borderRadius: '16px', padding: '40px', textAlign: 'center',
          maxWidth: '400px', width: '100%',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏰</div>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '20px', marginBottom: '8px', color: '#e8e8f0' }}>
            Invitation Expired
          </h2>
          <p style={{ color: '#7c7c9a', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
            This invitation link has expired or has already been used. Ask your team admin to send a new one.
          </p>
          <a href="/login" style={{
            display: 'inline-block', background: '#6c63ff', color: '#fff',
            textDecoration: 'none', padding: '11px 24px', borderRadius: '8px',
            fontSize: '14px', fontWeight: 600,
          }}>Go to Login →</a>
        </div>
      </div>
    )
  }

  const workspaceName = (invite.workspace as any)?.name ?? 'a workspace'
  const inviterMeta = (invite.inviter as any)?.raw_user_meta_data
  const inviterName = inviterMeta?.full_name ?? 'A team member'

  return (
    <InviteAcceptClient
      token={token}
      email={invite.email}
      role={invite.role}
      workspaceName={workspaceName}
      inviterName={inviterName}
      expiresAt={invite.expires_at}
    />
  )
}
