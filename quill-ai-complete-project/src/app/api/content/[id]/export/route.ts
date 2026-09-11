import { NextRequest } from 'next/server'
import { createSupabaseAdmin, requireUser, requireWorkspace } from '@/lib/supabase/server'
import { jsonError, workspaceCatch, countWords } from '@/lib/utils'

export const runtime     = 'nodejs'
export const maxDuration = 30

// GET /api/content/[id]/export
// Generates a PDF of a content piece, with workspace branding overrides
// applied when white_label_enabled = true (Agency plan feature).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let user
  try { user = await requireUser() } catch { return jsonError('Unauthorized', 401) }

  let workspace: any
  try { ({ workspace } = await requireWorkspace(user.id)) }
  catch (e) { return workspaceCatch(e) }

  const admin = createSupabaseAdmin()

  // Fetch content piece + workspace branding in parallel
  const [pieceRes, brandingRes] = await Promise.all([
    admin.from('content_pieces')
      .select('id, title, content, industry, content_type, tone, keyword, platforms, created_at, word_count, workspace_id')
      .eq('id', id)
      .single(),
    admin.from('workspaces')
      .select('brand_primary_color, brand_company_name, logo_url, white_label_enabled, plan')
      .eq('id', workspace.id)
      .single(),
  ])

  const piece = pieceRes.data
  if (pieceRes.error || !piece) return jsonError('Content not found', 404)
  if (piece.workspace_id !== workspace.id) return jsonError('Forbidden', 403)

  // Branding: use workspace overrides for Agency white-label, defaults otherwise
  const ws       = brandingRes.data
  const whiteLabel = ws?.white_label_enabled && ws?.plan === 'agency'
  const branding = {
    primaryColor:  (whiteLabel && ws?.brand_primary_color) ? ws.brand_primary_color : '#6c63ff',
    companyName:   (whiteLabel && ws?.brand_company_name)  ? ws.brand_company_name  : 'Quill.AI',
    logoUrl:       (whiteLabel && ws?.logo_url)            ? ws.logo_url            : null,
  }

  try {
    const { Document, Page, Text, View, StyleSheet, renderToBuffer, Image } = await import('@react-pdf/renderer')
    const React = await import('react')

    const styles = StyleSheet.create({
      page: {
        fontFamily: 'Helvetica',
        backgroundColor: '#FFFFFF',
        paddingTop: 0, paddingHorizontal: 0, paddingBottom: 40,
      },
      header: {
        backgroundColor: branding.primaryColor,   // ← workspace brand color
        paddingVertical: 20, paddingHorizontal: 40, marginBottom: 0,
      },
      headerBrand: {
        fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginBottom: 4,
      },
      headerSub: { fontSize: 10, color: 'rgba(255,255,255,0.75)' },
      body: { paddingHorizontal: 40, paddingTop: 28 },
      title: {
        fontSize: 22, fontFamily: 'Helvetica-Bold',
        color: '#1a1a2e', marginBottom: 10, lineHeight: 1.3,
      },
      metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
      metaChip: {
        backgroundColor: '#F1F5F9', borderRadius: 4,
        paddingVertical: 3, paddingHorizontal: 8, fontSize: 9, color: '#64748B',
      },
      dateLine:  { fontSize: 9, color: '#94A3B8', marginBottom: 20 },
      divider:   { height: 1, backgroundColor: '#E2E8F0', marginBottom: 20 },
      h2: {
        fontSize: 15, fontFamily: 'Helvetica-Bold',
        color: '#1a1a2e', marginBottom: 6, marginTop: 14,
      },
      h3: {
        fontSize: 13, fontFamily: 'Helvetica-Bold',
        color: '#334155', marginBottom: 4, marginTop: 10,
      },
      paragraph: {
        fontSize: 11, color: '#333333', lineHeight: 1.65, marginBottom: 8,
      },
      footerSection: {
        marginTop: 24, paddingTop: 16,
        borderTopWidth: 1, borderTopColor: '#E2E8F0', borderTopStyle: 'solid',
      },
      footerLabel: {
        fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#64748B',
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2,
      },
      footerValue: { fontSize: 10, color: '#334155', marginBottom: 8 },
      pageFooter: {
        position: 'absolute', bottom: 20, left: 40, right: 40,
        flexDirection: 'row', justifyContent: 'space-between',
      },
      pageFooterText: { fontSize: 8, color: '#94A3B8' },
      logoImg: { width: 32, height: 32, objectFit: 'contain', marginBottom: 4 },
    })

    const rawContent = piece.content ?? ''
    const lines = rawContent.split('\n')
    const contentBlocks: { type: 'h2' | 'h3' | 'paragraph'; text: string }[] = []

    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      if (t.startsWith('## '))      contentBlocks.push({ type: 'h2', text: t.slice(3) })
      else if (t.startsWith('### ')) contentBlocks.push({ type: 'h3', text: t.slice(4) })
      else if (!t.startsWith('# '))  contentBlocks.push({ type: 'paragraph', text: t.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1') })
    }

    const wordCount     = piece.word_count ?? countWords(rawContent)
    const generatedDate = piece.created_at
      ? new Date(piece.created_at).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })
      : new Date().toLocaleDateString()

    const footerBrandLabel = whiteLabel
      ? `${branding.companyName} — Confidential`
      : 'quill.ai — Confidential'

    const PDFDoc = React.createElement(
      Document, null,
      React.createElement(
        Page, { size: 'A4', style: styles.page },

        // ── Header ────────────────────────────────────────────────────────
        React.createElement(
          View, { style: styles.header },
          // Show workspace logo if white-label and logo exists
          branding.logoUrl
            ? React.createElement(Image as any, { src: branding.logoUrl, style: styles.logoImg })
            : null,
          React.createElement(Text, { style: styles.headerBrand },
            branding.logoUrl ? '' : `✦ ${branding.companyName}`  // hide text if logo shown
          ),
          React.createElement(Text, { style: styles.headerSub }, 'Generated Content Report'),
        ),

        // ── Body ──────────────────────────────────────────────────────────
        React.createElement(
          View, { style: styles.body },
          React.createElement(Text, { style: styles.title }, piece.title ?? 'Generated Content'),
          React.createElement(
            View, { style: styles.metaRow },
            ...[piece.industry, piece.content_type, piece.tone]
              .filter(Boolean)
              .map((chip, i) => React.createElement(Text, { key: i, style: styles.metaChip }, chip))
          ),
          React.createElement(Text, { style: styles.dateLine }, `Generated: ${generatedDate}`),
          React.createElement(View, { style: styles.divider }),
          ...contentBlocks.map((block, i) => {
            if (block.type === 'h2') return React.createElement(Text, { key: i, style: styles.h2 }, block.text)
            if (block.type === 'h3') return React.createElement(Text, { key: i, style: styles.h3 }, block.text)
            return React.createElement(Text, { key: i, style: styles.paragraph }, block.text)
          }),
          React.createElement(
            View, { style: styles.footerSection },
            piece.keyword && React.createElement(React.Fragment, null,
              React.createElement(Text, { style: styles.footerLabel }, 'Primary Keyword'),
              React.createElement(Text, { style: styles.footerValue }, piece.keyword),
            ),
            piece.platforms && (piece.platforms as string[]).length > 0 && React.createElement(React.Fragment, null,
              React.createElement(Text, { style: styles.footerLabel }, 'Target Platforms'),
              React.createElement(Text, { style: styles.footerValue }, (piece.platforms as string[]).join(', ')),
            ),
            React.createElement(Text, { style: styles.footerLabel }, 'Word Count'),
            React.createElement(Text, { style: styles.footerValue }, `${wordCount.toLocaleString()} words`),
          ),
        ),

        // ── Page footer ───────────────────────────────────────────────────
        React.createElement(
          View, { style: styles.pageFooter, fixed: true },
          React.createElement(Text, { style: styles.pageFooterText }, footerBrandLabel),
          React.createElement(Text, {
            style: styles.pageFooterText,
            render: ({ pageNumber, totalPages }: any) => `${pageNumber} / ${totalPages}`,
          }),
        ),
      )
    )

    // renderToBuffer() is the correct server-side API.
    // pdf().toBlob() is browser-only and throws on Vercel Node.js runtime.
    const pdfBuffer  = await renderToBuffer(PDFDoc)
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer
    const filename    = `${branding.companyName.toLowerCase().replace(/\s+/g,'-')}-content-${id.substring(0,8)}.pdf`

    return new Response(arrayBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    console.error('[PDF Export]', err)
    return jsonError('PDF generation failed. Please try again.', 500)
  }
}
