import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Preview,
} from '@react-email/components'

// ─────────────────────────────────────────────────────────────────────────────
// MonthlyResetEmail
// Sent on the 1st of each month after the usage_count is reset to 0.
// Rendered server-side with @react-email/render (not renderToStaticMarkup).
// ─────────────────────────────────────────────────────────────────────────────

interface MonthlyResetEmailProps {
  firstName: string
  lastMonthCount: number
  newLimit: number
  plan: string
  topContent?: { title: string; platform: string }[]
}

const BASE_URL = process.env.NEXT_PUBLIC_URL ?? 'https://quill.ai'

const TIPS = [
  "Repurpose your top blog post into 5 social media snippets using the LinkedIn Article + Twitter Thread content types.",
  "Use the Trend Analyzer every Monday to inject trending hashtags into your week's content briefs for 40% more reach.",
  "Set your Brand Voice once in Settings — it pre-fills every generation brief, saving you 2 minutes per piece.",
]

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
        <p style={{ margin: '0 0 4px' }}>Questions? <a href="mailto:support@quill.ai" style={{ color: '#6c63ff' }}>support@quill.ai</a></p>
        <p style={{ margin: 0 }}>© {new Date().getFullYear()} Quill.AI · All rights reserved</p>
      </td>
    </tr></tbody></table>
  )
}

export default function MonthlyResetEmail({
  firstName,
  lastMonthCount,
  newLimit,
  plan,
  topContent,
}: MonthlyResetEmailProps) {
  const now           = new Date()
  const lastMonth     = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthName = lastMonth.toLocaleString('en-US', { month: 'long' })
  const planLabel     = plan.charAt(0).toUpperCase() + plan.slice(1)
  // Rotate tips based on month number so each month has a different tip
  const tip = TIPS[now.getMonth() % TIPS.length]

  const PLATFORM_EMOJI: Record<string, string> = {
    linkedin: 'in', twitter: '𝕏', blog: '📝', instagram: '📸', email: '✉️',
  }

  return (
    <Html lang="en">
      <Head>
        <title>Your monthly limit has reset — Quill.AI</title>
        <meta charSet="utf-8" />
      </Head>
      <Preview>{`🔄 Your Quill.AI content limit has reset! You have ${newLimit} fresh pieces ready.`}</Preview>
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
                    <h1 style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 800, fontSize: '26px', color: '#e8e8f0', margin: '0 0 12px', lineHeight: 1.2 }}>
                      🔄 Your monthly limit has reset!
                    </h1>
                    <p style={{ fontSize: '15px', color: '#b0b0c8', lineHeight: 1.7, margin: 0 }}>
                      Hi {firstName}! You now have <strong style={{ color: '#3ecf8e' }}>{newLimit} fresh content pieces</strong> ready to use on your {planLabel} plan.
                    </p>
                  </td></tr></tbody>
                </table>
              </td></tr>

              {/* Last month summary */}
              <tr><td style={{ padding: '16px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: 'rgba(62,207,142,0.07)', border: '1px solid rgba(62,207,142,0.2)', borderRadius: '10px', padding: '16px 20px' }}>
                  <tbody><tr><td>
                    <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#3ecf8e' }}>
                      {lastMonthName} recap
                    </p>
                    <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#b0b0c8', lineHeight: 1.6 }}>
                      You created <strong style={{ color: '#e8e8f0' }}>{lastMonthCount}</strong> content {lastMonthCount === 1 ? 'piece' : 'pieces'} last month. {lastMonthCount === 0 ? 'This month is a fresh start! 💪' : 'Great work!'}
                    </p>
                    {topContent && topContent.length > 0 && (
                      <>
                        <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#7c7c9a' }}>Top content</p>
                        {topContent.slice(0, 3).map((c, i) => (
                          <table key={i} width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: '6px' }}>
                            <tbody><tr>
                              <td style={{ width: '28px', fontSize: '12px', color: '#4a4a65', fontWeight: 700 }}>#{i + 1}</td>
                              <td style={{ fontSize: '13px', color: '#e8e8f0', flex: 1 }}>{c.title}</td>
                              <td style={{ textAlign: 'right' as const, fontSize: '11px', color: '#7c7c9a' }}>
                                {PLATFORM_EMOJI[c.platform.toLowerCase()] ?? c.platform}
                              </td>
                            </tr></tbody>
                          </table>
                        ))}
                      </>
                    )}
                  </td></tr></tbody>
                </table>
              </td></tr>

              {/* CTA */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0"><tbody><tr><td align="center">
                  <a
                    href={`${BASE_URL}/generator`}
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
                    Start Creating →
                  </a>
                </td></tr></tbody></table>
              </td></tr>

              {/* Tip of the month */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)', borderRadius: '10px', padding: '16px 20px' }}>
                  <tbody><tr><td>
                    <p style={{ margin: '0 0 6px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#6c63ff' }}>✦ Tip of the Month</p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#b0b0c8', lineHeight: 1.6 }}>{tip}</p>
                  </td></tr></tbody>
                </table>
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
