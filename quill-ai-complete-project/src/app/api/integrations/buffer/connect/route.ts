import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase/server'
import { jsonError } from '@/lib/utils'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  try { await requireUser() } catch { return jsonError('Unauthorized', 401) }

  // Generate CSRF state token
  const state = crypto.randomUUID()

  // Store state in httpOnly cookie (expires in 10 minutes)
  const cookieStore = await cookies()
  cookieStore.set('buffer_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const params = new URLSearchParams({
    client_id: process.env.BUFFER_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_URL}/api/integrations/buffer/callback`,
    response_type: 'code',
    state,
  })

  return NextResponse.redirect(
    `https://bufferapp.com/oauth2/authorize?${params.toString()}`
  )
}
