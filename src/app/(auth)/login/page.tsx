'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createSupabaseBrowserClient()
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authErr) {
      setError(authErr.message)
      setLoading(false)
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  async function handleGoogleLogin() {
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_URL}/api/auth/callback?redirectTo=${redirectTo}`,
      },
    })
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #0f0f13; color: #e8e8f0; min-height: 100vh; }
        :root {
          --bg: #0f0f13; --card: #1e1e28; --border: #2a2a3a;
          --accent: #6c63ff; --accent-dim: rgba(108,99,255,0.15);
          --gold: #f5c842; --text: #e8e8f0; --text-muted: #7c7c9a;
          --green: #3ecf8e; --red: #f06565;
        }
        input { font-family: 'Inter', sans-serif; }
        input:-webkit-autofill, input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #1e1e28 inset !important;
          -webkit-text-fill-color: #e8e8f0 !important;
        }
      `}</style>

      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '24px',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(108,99,255,0.12) 0%, transparent 60%)',
      }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '10px',
              marginBottom: '8px',
            }}>
              <div style={{
                width: '36px', height: '36px',
                background: 'linear-gradient(135deg, #6c63ff, #f5c842)',
                borderRadius: '9px', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '18px',
                boxShadow: '0 0 20px rgba(108,99,255,0.4)',
              }}>✦</div>
              <span style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px',
                background: 'linear-gradient(135deg, #fff 40%, #f5c842)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>Quill.AI</span>
            </div>
            <div style={{ fontSize: '14px', color: '#7c7c9a' }}>
              Sign in to your workspace
            </div>
          </div>

          {/* Card */}
          <div style={{
            background: '#1e1e28', border: '1px solid #2a2a3a',
            borderRadius: '16px', padding: '32px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          }}>

            {error && (
              <div style={{
                background: 'rgba(240,101,101,0.12)', border: '1px solid rgba(240,101,101,0.25)',
                borderRadius: '8px', padding: '10px 14px', marginBottom: '20px',
                fontSize: '13px', color: '#f06565',
              }}>{error}</div>
            )}

            <form onSubmit={handleEmailLogin}>
              {/* Email */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block', fontSize: '11px', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: '#7c7c9a', marginBottom: '6px',
                }}>Email</label>
                <input
                  type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  style={{
                    width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a',
                    borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
                    fontSize: '14px', outline: 'none',
                    transition: 'border-color 0.18s',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#6c63ff')}
                  onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
                />
              </div>

              {/* Password */}
              <div style={{ marginBottom: '8px' }}>
                <label style={{
                  display: 'block', fontSize: '11px', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: '#7c7c9a', marginBottom: '6px',
                }}>Password</label>
                <input
                  type="password" required autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{
                    width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a',
                    borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
                    fontSize: '14px', outline: 'none',
                    transition: 'border-color 0.18s',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#6c63ff')}
                  onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
                />
              </div>

              <div style={{ textAlign: 'right', marginBottom: '24px' }}>
                <Link href="/reset-password" style={{
                  fontSize: '12px', color: '#7c7c9a',
                  textDecoration: 'none',
                }}>Forgot password?</Link>
              </div>

              <button
                type="submit" disabled={loading}
                style={{
                  width: '100%', background: '#6c63ff', color: '#fff',
                  border: 'none', borderRadius: '8px', padding: '12px',
                  fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  transition: 'all 0.18s', fontFamily: 'Inter, sans-serif',
                }}
              >
                {loading ? '⏳ Signing in…' : '→ Sign In'}
              </button>
            </form>

            {/* Divider */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              margin: '20px 0', color: '#4a4a65', fontSize: '12px',
            }}>
              <div style={{ flex: 1, height: '1px', background: '#2a2a3a' }} />
              or
              <div style={{ flex: 1, height: '1px', background: '#2a2a3a' }} />
            </div>

            {/* Google */}
            <button
              onClick={handleGoogleLogin} disabled={loading}
              style={{
                width: '100%', background: 'transparent', color: '#e8e8f0',
                border: '1px solid #2a2a3a', borderRadius: '8px', padding: '11px',
                fontSize: '14px', fontWeight: 500, cursor: 'pointer',
                transition: 'all 0.18s', fontFamily: 'Inter, sans-serif',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '8px',
              }}
              onMouseEnter={e => {
                (e.target as HTMLButtonElement).style.borderColor = '#6c63ff'
                ;(e.target as HTMLButtonElement).style.color = '#6c63ff'
              }}
              onMouseLeave={e => {
                (e.target as HTMLButtonElement).style.borderColor = '#2a2a3a'
                ;(e.target as HTMLButtonElement).style.color = '#e8e8f0'
              }}
            >
              <span style={{ fontSize: '16px' }}>G</span> Continue with Google
            </button>
          </div>

          <div style={{
            textAlign: 'center', marginTop: '24px',
            fontSize: '13px', color: '#7c7c9a',
          }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: '#6c63ff', fontWeight: 600, textDecoration: 'none' }}>
              Create workspace →
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f0f13', color:'#7c7c9a', fontFamily:'Inter, sans-serif', fontSize:'14px' }}>
        Loading…
      </div>
    }>
      <LoginPageInner />
    </Suspense>
  )
}
