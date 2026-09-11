'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    fullName: '', email: '', password: '', workspaceName: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const inputStyle = {
    width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a',
    borderRadius: '8px', padding: '10px 12px', color: '#e8e8f0',
    fontSize: '14px', outline: 'none', fontFamily: 'Inter, sans-serif',
    transition: 'border-color 0.18s',
  }

  const labelStyle = {
    display: 'block' as const, fontSize: '11px', fontWeight: 600,
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    color: '#7c7c9a', marginBottom: '6px',
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setError('Password must contain at least one letter and one number.')
      return
    }

    setLoading(true)

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Signup failed. Please try again.')
      setLoading(false)
      return
    }

    // ── Email verification required ──────────────────────────────────────
    // When Supabase "Confirm email" is enabled, the API returns
    // { requiresVerification: true, email } instead of a workspace object.
    // Redirect to the verify-email holding page — the user cannot access
    // the app until they click the confirmation link.
    if (data.requiresVerification) {
      router.push(`/verify-email?email=${encodeURIComponent(form.email)}`)
      return
    }

    // ── Auto-login (email confirmation disabled in Supabase) ─────────────
    // Only reached in local development or when email confirmation is off.
    if (data.autoLogin) {
      router.push('/dashboard')
      router.refresh()
    } else {
      // Account created but auto-login failed — let them sign in manually
      router.push('/login?notice=confirm-email')
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #0f0f13; color: #e8e8f0; }
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
        <div style={{ width: '100%', maxWidth: '420px' }}>

          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
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
              Create your workspace — free 14-day trial
            </div>
          </div>

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

            <form onSubmit={handleSubmit}>
              {[
                { key: 'fullName', label: 'Full Name', type: 'text', placeholder: 'Alex Kim', autocomplete: 'name' },
                { key: 'email', label: 'Work Email', type: 'email', placeholder: 'you@company.com', autocomplete: 'email' },
                { key: 'password', label: 'Password', type: 'password', placeholder: 'Min. 8 characters, 1 letter + 1 number', autocomplete: 'new-password' },
                { key: 'workspaceName', label: 'Company / Workspace Name', type: 'text', placeholder: 'Acme Corp', autocomplete: 'organization' },
              ].map(field => (
                <div key={field.key} style={{ marginBottom: '16px' }}>
                  <label style={labelStyle}>{field.label}</label>
                  <input
                    type={field.type} required
                    autoComplete={field.autocomplete}
                    placeholder={field.placeholder}
                    value={form[field.key as keyof typeof form]}
                    onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = '#6c63ff')}
                    onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
                  />
                </div>
              ))}

              <div style={{ fontSize: '11px', color: '#4a4a65', marginBottom: '20px', lineHeight: 1.5 }}>
                By creating an account you agree to our{' '}
                <Link href="/terms" style={{ color: '#6c63ff', textDecoration: 'none' }}>Terms of Service</Link>
                {' '}and{' '}
                <Link href="/privacy" style={{ color: '#6c63ff', textDecoration: 'none' }}>Privacy Policy</Link>.
              </div>

              <button
                type="submit" disabled={loading}
                style={{
                  width: '100%', background: '#6c63ff', color: '#fff',
                  border: 'none', borderRadius: '8px', padding: '12px',
                  fontSize: '14px', fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {loading ? '⏳ Creating workspace…' : '✦ Create My Workspace'}
              </button>
            </form>

            <div style={{
              marginTop: '20px', padding: '14px', borderRadius: '8px',
              background: 'rgba(245,200,66,0.07)', border: '1px solid rgba(245,200,66,0.2)',
              fontSize: '12px', color: '#7c7c9a', lineHeight: 1.5,
            }}>
              🎁 <strong style={{ color: '#f5c842' }}>14-day free trial</strong> — no credit card required.
              Starter plan: 4 blogs + 8 social posts per month.
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: '#7c7c9a' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: '#6c63ff', fontWeight: 600, textDecoration: 'none' }}>
              Sign in →
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
