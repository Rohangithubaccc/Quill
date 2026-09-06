import {
  Body, Button, Container, Head, Heading,
  Hr, Html, Preview, Section, Text,
} from '@react-email/components'
import * as React from 'react'

interface ContentApprovedEmailProps {
  reviewerName:  string   // e.g. "Sarah" (truncated from email)
  contentTitle:  string
  contentType:   string   // e.g. "Blog Post"
  reviewUrl:     string   // link back to the review page
}

// ─────────────────────────────────────────────────────────────────────────────
// ContentApprovedEmail
//
// Sent via Resend to the content creator when a reviewer clicks "Approve"
// in the review queue. Fulfils the roadmap requirement:
//   "Approve action updates status + triggers email to creator via Resend"
//
// Usage in /api/content/route.ts PATCH handler:
//   import { ContentApprovedEmail } from '@/emails/ContentApprovedEmail'
//   await resend.emails.send({
//     from:    process.env.EMAIL_FROM!,
//     to:      creatorEmail,
//     subject: `Your content has been approved — "${contentTitle}"`,
//     react:   React.createElement(ContentApprovedEmail, { ... }),
//   })
// ─────────────────────────────────────────────────────────────────────────────

export function ContentApprovedEmail({
  reviewerName,
  contentTitle,
  contentType,
  reviewUrl,
}: ContentApprovedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Your {contentType} &ldquo;{contentTitle}&rdquo; has been approved ✓
      </Preview>
      <Body style={body}>
        <Container style={container}>

          {/* Brand bar */}
          <Section style={logoBar}>
            <Text style={logoText}>✦ Quill.AI</Text>
          </Section>

          {/* Main card */}
          <Section style={card}>
            {/* Green approval badge */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <span style={{
                display: 'inline-block',
                background: 'rgba(62,207,142,0.12)',
                border: '1px solid rgba(62,207,142,0.4)',
                borderRadius: '99px',
                padding: '6px 18px',
                fontSize: '13px',
                fontWeight: 700,
                color: '#3ecf8e',
                letterSpacing: '0.04em',
              }}>
                ✓ APPROVED
              </span>
            </div>

            <Heading style={heading}>Your content is approved!</Heading>

            <Text style={subText}>
              <strong style={accent}>{reviewerName}</strong> approved your{' '}
              <strong style={accent}>{contentType}</strong>:
            </Text>

            {/* Content title pill */}
            <Section style={titlePill}>
              <Text style={titlePillText}>📄 {contentTitle}</Text>
            </Section>

            <Text style={bodyText}>
              It&rsquo;s ready to schedule or publish. Head to the review queue
              to set a publish date or push it live now.
            </Text>

            <Section style={{ textAlign: 'center' }}>
              <Button style={button} href={reviewUrl}>
                View Approved Content →
              </Button>
            </Section>
          </Section>

          <Hr style={divider} />
          <Text style={footer}>
            You received this because you&rsquo;re a content creator in a Quill.AI workspace.
          </Text>
          <Text style={footer}>
            © {new Date().getFullYear()} Quill.AI · All rights reserved
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default ContentApprovedEmail

// ── Styles ─────────────────────────────────────────────────────────────────
const body: React.CSSProperties = {
  backgroundColor: '#0b0b10',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: 0, padding: 0,
}
const container: React.CSSProperties = {
  maxWidth: '520px', margin: '0 auto', padding: '32px 16px 48px',
}
const logoBar: React.CSSProperties = { marginBottom: '24px' }
const logoText: React.CSSProperties = {
  fontSize: '18px', fontWeight: 700, color: '#6c63ff', margin: 0, letterSpacing: '-0.02em',
}
const card: React.CSSProperties = {
  background: '#13131a', border: '1px solid #2a2a3a',
  borderRadius: '12px', padding: '32px',
}
const heading: React.CSSProperties = {
  fontSize: '22px', fontWeight: 700, color: '#e8e8f0',
  margin: '0 0 12px', letterSpacing: '-0.02em', textAlign: 'center',
}
const subText: React.CSSProperties = {
  fontSize: '14px', color: '#9898b8', margin: '0 0 16px', lineHeight: '1.5',
}
const accent: React.CSSProperties = { color: '#e8e8f0' }
const titlePill: React.CSSProperties = {
  background: 'rgba(108,99,255,0.1)', border: '1px solid rgba(108,99,255,0.25)',
  borderRadius: '8px', padding: '10px 14px', marginBottom: '20px',
}
const titlePillText: React.CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: '#a8a3ff', margin: 0,
}
const bodyText: React.CSSProperties = {
  fontSize: '14px', color: '#9898b8', margin: '0 0 24px', lineHeight: '1.6',
}
const button: React.CSSProperties = {
  backgroundColor: '#3ecf8e', color: '#0b0b10',
  borderRadius: '8px', padding: '12px 28px',
  fontSize: '14px', fontWeight: 700, textDecoration: 'none',
  display: 'inline-block',
}
const divider: React.CSSProperties = { borderColor: '#2a2a3a', margin: '32px 0 24px' }
const footer: React.CSSProperties = {
  fontSize: '12px', color: '#4a4a6a', textAlign: 'center', margin: '0 0 6px', lineHeight: '1.5',
}
