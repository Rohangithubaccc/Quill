import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Preview,
} from '@react-email/components'

// ─────────────────────────────────────────────────────────────────────────────
// UsageLimitEmail
// Sent when a workspace reaches 80%+ of its monthly content limit.
// Rendered server-side with @react-email/render (not renderToStaticMarkup).
// ─────────────────────────────────────────────────────────────────────────────

interface UsageLimitEmailProps {
  firstName: string
  usageCount: number
  usageLimit: number
  plan: string
  workspaceName: string
}

const BASE_URL = process.env.NEXT_PUBLIC_URL ?? 'https://quill.ai'

function EmailHeader() {
  return (
    <table width="100%" cellPadding="0" cellSpacing="0"><tbody><tr><td style={{ padding: '24px 24px 0' }}>
      <table cellPadding="0" cellSpacing="0"><tbody><tr>
        <td style={{
          backgroundColor: '#6c63ff',
          borderRadius: '8px',
          padding: '8px 16px',
          fontWeight: 800,
          fontSize: '18px',
          color: '#ffffff',
          fontFamily: 'Helvetica, Arial, sans-serif',
        }}>✦ Quill.AI</td>
      </tr></tbody></table>
    </td></tr></tbody></table>
  )
}

function EmailFooter() {
  return (
    <table width="100%" cellPadding="0" cellSpacing="0"><tbody><tr>
      <td style={{ padding: '16px 24px 32px', fontSize: '12px', color: '#4a4a65', textAlign: 'center' as const }}>
        <p style={{ margin: '0 0 4px 0' }}>Questions? <a href="mailto:support@quill.ai" style={{ color: '#6c63ff' }}>support@quill.ai</a></p>
        <p style={{ margin: 0 }}>© {new Date().getFullYear()} Quill.AI · All rights reserved</p>
      </td>
    </tr></tbody></table>
  )
}

export default function UsageLimitEmail({
  firstName,
  usageCount,
  usageLimit,
  plan,
  workspaceName,
}: UsageLimitEmailProps) {
  const now            = new Date()
  const nextReset      = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const daysUntilReset = Math.ceil((nextReset.getTime() - now.getTime()) / 86400000)
  const planLabel      = plan.charAt(0).toUpperCase() + plan.slice(1)

  return (
    <Html lang="en">
      <Head>
        <title>Content limit reached — Quill.AI</title>
        <meta charSet="utf-8" />
      </Head>
      <Preview>{`⚡ You've used all ${usageLimit} content pieces this month — upgrade for more.`}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: '#0f0f13' }}>
        <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: '#0f0f13', padding: '0 16px' }}>
          <tbody><tr><td align="center">
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ maxWidth: '600px', margin: '0 auto', fontFamily: 'Inter, Helvetica, Arial, sans-serif', backgroundColor: '#0f0f13', color: '#e8e8f0' }}>
              <tbody>
              <tr><td><EmailHeader /></td></tr>

              {/* Hero */}
              <tr><td style={{ padding: '16px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: '#1e1e28', borderRadius: '12px', padding: '28px', border: '1px solid #2a2a3a' }}>
                  <tbody><tr><td>
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#f06565', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>⚡ Limit reached</p>
                    <h1 style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 800, fontSize: '24px', color: '#e8e8f0', margin: '0 0 12px', lineHeight: 1.2 }}>
                      You&apos;ve used all {usageLimit} content pieces this month
                    </h1>
                    <p style={{ fontSize: '14px', color: '#b0b0c8', lineHeight: 1.7, margin: 0 }}>
                      Hi {firstName}, your <strong style={{ color: '#e8e8f0' }}>{workspaceName}</strong> workspace ({planLabel} plan) has reached its monthly content limit.
                    </p>
                  </td></tr></tbody>
                </table>
              </td></tr>

              {/* Full usage bar */}
              <tr><td style={{ padding: '16px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: 'rgba(240,101,101,0.08)', border: '1px solid rgba(240,101,101,0.2)', borderRadius: '10px', padding: '16px 20px' }}>
                  <tbody>
                  <tr><td>
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#7c7c9a' }}>{usageCount}/{usageLimit} pieces used</p>
                    {/* Usage bar — table hack for email client compatibility */}
                    <table width="100%" cellPadding="0" cellSpacing="0"><tbody><tr>
                      <td style={{ backgroundColor: '#2a2a3a', borderRadius: '99px', height: '8px', overflow: 'hidden' }}>
                        <table width="100%" cellPadding="0" cellSpacing="0"><tbody><tr>
                          <td style={{ backgroundColor: '#f06565', height: '8px', borderRadius: '99px' }}>&nbsp;</td>
                        </tr></tbody></table>
                      </td>
                    </tr></tbody></table>
                    <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#7c7c9a' }}>
                      Your limit resets on <strong style={{ color: '#e8e8f0' }}>the 1st of next month</strong> ({daysUntilReset} days from now).
                    </p>
                  </td></tr>
                  </tbody>
                </table>
              </td></tr>

              {/* Two options */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0"><tbody>
                <tr><td align="center" style={{ paddingBottom: '12px' }}>
                  <a
                    href={`${BASE_URL}/settings`}
                    style={{
                      display: 'inline-block',
                      backgroundColor: '#6c63ff',
                      color: '#ffffff',
                      textDecoration: 'none',
                      borderRadius: '8px',
                      padding: '13px 28px',
                      fontWeight: 700,
                      fontSize: '15px',
                      fontFamily: 'Helvetica, Arial, sans-serif',
                    }}
                  >
                    Upgrade for 30 pieces/month →
                  </a>
                </td></tr>
                <tr><td align="center">
                  <p style={{ fontSize: '13px', color: '#4a4a65', margin: 0 }}>
                    Or wait {daysUntilReset} days for your limit to reset automatically.
                  </p>
                </td></tr>
                </tbody></table>
              </td></tr>

              {/* What you get */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <p style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 600, color: '#e8e8f0' }}>With Growth ($599/mo) you get:</p>
                {[
                  '✓ 400 credits per month (vs 120 on Starter)',
                  '✓ Full analytics + header image generation',
                  '✓ Up to 5 team members',
                ].map(line => (
                  <p key={line} style={{ margin: '0 0 6px', fontSize: '13px', color: '#3ecf8e' }}>{line}</p>
                ))}
              </td></tr>

              <tr><td style={{ padding: '16px 24px 0' }}><div style={{ borderTop: '1px solid #2a2a3a' }} /></td></tr>
              <tr><td><EmailFooter /></td></tr>
              </tbody>
            </table>
          </td></tr></tbody>
        </table>
      </Body>
    </Html>
  )
}
