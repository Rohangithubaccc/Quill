import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

interface MentionEmailProps {
  mentionerEmail: string
  contentTitle:   string
  commentBody:    string
  reviewUrl:      string
}

export function MentionEmail({
  mentionerEmail,
  contentTitle,
  commentBody,
  reviewUrl,
}: MentionEmailProps) {
  const mentionerName = mentionerEmail.split('@')[0]

  return (
    <Html>
      <Head />
      <Preview>
        {mentionerName} mentioned you in a comment on &ldquo;{contentTitle}&rdquo;
      </Preview>
      <Body style={body}>
        <Container style={container}>

          {/* ── Logo / brand bar ─────────────────────────────────────────── */}
          <Section style={logoBar}>
            <Text style={logoText}>✦ Quill.AI</Text>
          </Section>

          {/* ── Main card ────────────────────────────────────────────────── */}
          <Section style={card}>
            <Heading style={heading}>You were mentioned</Heading>

            <Text style={subheading}>
              <strong style={accent}>{mentionerName}</strong>{' '}
              ({mentionerEmail}) mentioned you in a comment on:
            </Text>

            {/* Content title pill */}
            <Section style={titlePill}>
              <Text style={titlePillText}>📄 {contentTitle}</Text>
            </Section>

            {/* Comment blockquote */}
            <Section style={blockquote}>
              <Text style={blockquoteText}>{commentBody}</Text>
            </Section>

            <Text style={helperText}>
              Log in to Quill.AI to reply or resolve this comment.
            </Text>

            <Section style={buttonSection}>
              <Button style={button} href={reviewUrl}>
                View in Quill.AI →
              </Button>
            </Section>
          </Section>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <Hr style={divider} />
          <Text style={footer}>
            You received this email because you&rsquo;re a member of a Quill.AI
            workspace. To manage notifications, visit your workspace settings.
          </Text>
          <Text style={footer}>
            © {new Date().getFullYear()} Quill.AI · All rights reserved
          </Text>

        </Container>
      </Body>
    </Html>
  )
}

export default MentionEmail

// ── Styles ─────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  backgroundColor: '#0b0b10',
  fontFamily:      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin:          0,
  padding:         0,
}

const container: React.CSSProperties = {
  maxWidth:  '520px',
  margin:    '0 auto',
  padding:   '32px 16px 48px',
}

const logoBar: React.CSSProperties = {
  marginBottom: '24px',
}

const logoText: React.CSSProperties = {
  fontSize:    '18px',
  fontWeight:  700,
  color:       '#6c63ff',
  margin:      0,
  letterSpacing: '-0.02em',
}

const card: React.CSSProperties = {
  background:   '#13131a',
  border:       '1px solid #2a2a3a',
  borderRadius: '12px',
  padding:      '32px',
}

const heading: React.CSSProperties = {
  fontSize:    '22px',
  fontWeight:  700,
  color:       '#e8e8f0',
  margin:      '0 0 12px',
  letterSpacing: '-0.02em',
}

const subheading: React.CSSProperties = {
  fontSize:   '14px',
  color:      '#9898b8',
  margin:     '0 0 20px',
  lineHeight: '1.5',
}

const accent: React.CSSProperties = {
  color: '#e8e8f0',
}

const titlePill: React.CSSProperties = {
  background:   'rgba(108, 99, 255, 0.1)',
  border:       '1px solid rgba(108, 99, 255, 0.25)',
  borderRadius: '8px',
  padding:      '10px 14px',
  marginBottom: '20px',
}

const titlePillText: React.CSSProperties = {
  fontSize:   '13px',
  fontWeight: 600,
  color:      '#a8a3ff',
  margin:     0,
}

const blockquote: React.CSSProperties = {
  background:   '#0f0f17',
  borderLeft:   '3px solid #6c63ff',
  borderRadius: '0 8px 8px 0',
  padding:      '14px 18px',
  marginBottom: '24px',
}

const blockquoteText: React.CSSProperties = {
  fontSize:   '14px',
  color:      '#c8c8e0',
  margin:     0,
  lineHeight: '1.6',
  fontStyle:  'italic',
}

const helperText: React.CSSProperties = {
  fontSize:     '13px',
  color:        '#7c7c9a',
  marginBottom: '24px',
  lineHeight:   '1.5',
}

const buttonSection: React.CSSProperties = {
  textAlign: 'center',
}

const button: React.CSSProperties = {
  backgroundColor: '#6c63ff',
  color:           '#ffffff',
  borderRadius:    '8px',
  padding:         '12px 28px',
  fontSize:        '14px',
  fontWeight:      600,
  textDecoration:  'none',
  display:         'inline-block',
  letterSpacing:   '0.01em',
}

const divider: React.CSSProperties = {
  borderColor: '#2a2a3a',
  margin:      '32px 0 24px',
}

const footer: React.CSSProperties = {
  fontSize:   '12px',
  color:      '#4a4a6a',
  textAlign:  'center',
  margin:     '0 0 6px',
  lineHeight: '1.5',
}
