import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Preview,
} from '@react-email/components'

// ─────────────────────────────────────────────────────────────────────────────
// TrialEndingSoonEmail
// Sent on day 10, day 4, and day 1 of a user's trial.
// Rendered server-side with @react-email/render (not renderToStaticMarkup).
// ─────────────────────────────────────────────────────────────────────────────

interface TrialEndingSoonEmailProps {
  firstName: string
  daysLeft: number
  usageCount: number
  usageLimit: number
  workspaceName: string
}

const BASE_URL = process.env.NEXT_PUBLIC_URL ?? 'https://quill.ai'

function EmailHeader() {
  return (
    <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginBottom: '8px' }}>
      <tbody><tr><td style={{ padding: '24px 24px 0' }}>
        <table cellPadding="0" cellSpacing="0"><tbody><tr>
          <td style={{
            backgroundColor: '#6c63ff',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 800,
            fontSize: '18px',
            color: '#ffffff',
            fontFamily: 'Helvetica, Arial, sans-serif',
          }}>
            ✦ Quill.AI
          </td>
        </tr></tbody></table>
      </td></tr></tbody>
    </table>
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

export default function TrialEndingSoonEmail({
  firstName,
  daysLeft,
  usageCount,
  usageLimit,
  workspaceName,
}: TrialEndingSoonEmailProps) {
  const usedPct       = Math.min(100, Math.round((usageCount / usageLimit) * 100))
  const ctaBg         = daysLeft <= 3 ? '#f06565' : '#6c63ff'
  const urgencyColor  = daysLeft <= 3 ? '#f06565' : '#f59e42'

  return (
    <Html lang="en">
      <Head>
        <title>Your trial ends soon — Quill.AI</title>
        <meta charSet="utf-8" />
      </Head>
      <Preview>{`⏰ ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in your Quill.AI trial — upgrade to keep creating.`}</Preview>
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
                    <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: urgencyColor, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                      ⏰ Trial ending soon
                    </p>
                    <h1 style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 800, fontSize: '26px', color: '#e8e8f0', margin: '0 0 12px 0', lineHeight: 1.2 }}>
                      {daysLeft} day{daysLeft !== 1 ? 's' : ''} left in your trial
                    </h1>
                    <p style={{ fontSize: '15px', color: '#b0b0c8', lineHeight: 1.7, margin: '0' }}>
                      Hi {firstName}, your free trial for <strong style={{ color: '#e8e8f0' }}>{workspaceName}</strong> ends in {daysLeft} day{daysLeft !== 1 ? 's' : ''}. Upgrade now to keep creating without interruption.
                    </p>
                  </td></tr></tbody>
                </table>
              </td></tr>

              {/* Usage box */}
              <tr><td style={{ padding: '16px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.2)', borderRadius: '10px', padding: '16px 20px' }}>
                  <tbody>
                  <tr><td>
                    <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#7c7c9a' }}>
                      You&apos;ve created <strong style={{ color: '#e8e8f0' }}>{usageCount}</strong> of <strong style={{ color: '#e8e8f0' }}>{usageLimit}</strong> content pieces during your trial.
                    </p>
                    {/* Usage bar — table hack for email client compatibility */}
                    <table width="100%" cellPadding="0" cellSpacing="0">
                      <tbody><tr>
                        <td style={{ backgroundColor: '#2a2a3a', borderRadius: '99px', height: '8px', overflow: 'hidden' }}>
                          <table width={`${usedPct}%`} cellPadding="0" cellSpacing="0"><tbody><tr>
                            <td style={{ backgroundColor: usedPct >= 80 ? '#f59e42' : '#6c63ff', height: '8px', borderRadius: '99px' }}>&nbsp;</td>
                          </tr></tbody></table>
                        </td>
                      </tr></tbody>
                    </table>
                    {usageCount > 0 && (
                      <p style={{ margin: '10px 0 0', fontSize: '13px', color: '#3ecf8e' }}>
                        ✓ You&apos;re already creating great content. Don&apos;t lose momentum.
                      </p>
                    )}
                  </td></tr>
                  </tbody>
                </table>
              </td></tr>

              {/* CTA */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0"><tbody><tr><td align="center">
                  <a
                    href={`${BASE_URL}/settings`}
                    style={{
                      display: 'inline-block',
                      backgroundColor: ctaBg,
                      color: '#ffffff',
                      textDecoration: 'none',
                      borderRadius: '8px',
                      padding: '13px 28px',
                      fontWeight: 700,
                      fontSize: '15px',
                      fontFamily: 'Helvetica, Arial, sans-serif',
                    }}
                  >
                    Keep Creating →
                  </a>
                </td></tr></tbody></table>
              </td></tr>

              {/* Plan comparison */}
              <tr><td style={{ padding: '20px 24px 0' }}>
                <table width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' as const, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#7c7c9a', padding: '8px 12px', borderBottom: '1px solid #2a2a3a' }}>Plan</th>
                      <th style={{ textAlign: 'center' as const, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#7c7c9a', padding: '8px 12px', borderBottom: '1px solid #2a2a3a' }}>Credits / mo</th>
                      <th style={{ textAlign: 'right' as const, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#7c7c9a', padding: '8px 12px', borderBottom: '1px solid #2a2a3a' }}>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontSize: '13px', color: '#7c7c9a', padding: '10px 12px' }}>Starter</td>
                      <td style={{ fontSize: '13px', color: '#7c7c9a', textAlign: 'center' as const, padding: '10px 12px' }}>120</td>
                      <td style={{ fontSize: '13px', color: '#7c7c9a', textAlign: 'right' as const, padding: '10px 12px' }}>$299/mo</td>
                    </tr>
                    <tr style={{ backgroundColor: 'rgba(108,99,255,0.08)' }}>
                      <td style={{ fontSize: '13px', color: '#6c63ff', fontWeight: 700, padding: '10px 12px', borderRadius: '4px 0 0 4px' }}>Growth ⭐</td>
                      <td style={{ fontSize: '13px', color: '#6c63ff', fontWeight: 700, textAlign: 'center' as const, padding: '10px 12px' }}>400</td>
                      <td style={{ fontSize: '13px', color: '#6c63ff', fontWeight: 700, textAlign: 'right' as const, padding: '10px 12px', borderRadius: '0 4px 4px 0' }}>$599/mo</td>
                    </tr>
                  </tbody>
                </table>
              </td></tr>

              {/* Divider + footer */}
              <tr><td style={{ padding: '20px 24px 0' }}><div style={{ borderTop: '1px solid #2a2a3a' }} /></td></tr>
              <tr><td><EmailFooter /></td></tr>
              </tbody>
            </table>
          </td></tr></tbody>
        </table>
      </Body>
    </Html>
  )
}
