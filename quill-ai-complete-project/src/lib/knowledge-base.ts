// ── AI Knowledge Base: extraction, chunking, embedding, retrieval ──────────
//
// Pipeline: upload (API route) → extract text → chunk → embed each chunk →
// store in knowledge_chunks (Inngest job, see src/inngest/functions.ts) →
// retrieve top-K relevant chunks at generation time (this file, called from
// src/app/api/ai/generate/route.ts) → injected into buildPrompt() as a
// "RELEVANT COMPANY KNOWLEDGE" section (src/lib/utils.ts).
//
// Embeddings use OpenAI's text-embedding-3-small (1536 dimensions) via the
// OPENAI_API_KEY that's already required for DALL-E 3 — no third AI
// provider account needed. Anthropic has no embeddings endpoint.

import { createSupabaseAdmin } from '@/lib/supabase/server'

export type KnowledgeFileType = 'pdf' | 'docx' | 'txt'

// ── 1. Text extraction ──────────────────────────────────────────────────
export async function extractText(buffer: Buffer, fileType: KnowledgeFileType): Promise<string> {
  if (fileType === 'txt') {
    return buffer.toString('utf-8')
  }

  if (fileType === 'pdf') {
    // Uses pdfjs-dist (the actual, actively maintained Mozilla PDF.js
    // library) directly, NOT the popular `pdf-parse` npm package —
    // `pdf-parse` bundles a frozen 2018-era pdf.js fork (v1.10.100) that
    // failed to parse multiple valid PDFs during testing here (confirmed
    // independently valid via `qpdf --check`), throwing "bad XRef entry"
    // and "Illegal character" errors on straightforward, standards-
    // compliant files. pdfjs-dist correctly extracted all of them.
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const path = await import('path')

    // Suppresses a harmless-but-noisy "standardFontDataUrl" warning by
    // pointing pdf.js at the font metrics it already ships in
    // node_modules — doesn't affect extraction correctness either way,
    // just keeps production logs clean.
    const standardFontDataUrl = path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/') + '/'

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise

    let fullText = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      fullText += content.items.map((item: any) => item.str ?? '').join(' ') + '\n'
    }
    return fullText
  }

  if (fileType === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  throw new Error(`Unsupported file type: ${fileType}`)
}

// ── 2. Chunking ──────────────────────────────────────────────────────────
// Word-based sliding window. ~800 words (~1000-1100 tokens) per chunk with
// a 100-word overlap so a fact split across a chunk boundary still appears
// in full in at least one chunk. Simple and dependency-free — no need for
// a sentence-boundary-aware splitter at this scale.
export function chunkText(text: string, chunkSizeWords = 800, overlapWords = 100): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length === 0) return []
  if (words.length <= chunkSizeWords) return [words.join(' ')]

  const chunks: string[] = []
  let start = 0
  while (start < words.length) {
    const end = Math.min(start + chunkSizeWords, words.length)
    chunks.push(words.slice(start, end).join(' '))
    if (end === words.length) break
    start = end - overlapWords
  }
  return chunks
}

// ── 3. Embeddings ────────────────────────────────────────────────────────
// Batches up to 96 texts per OpenAI call (well under their per-request
// limits) to keep large-document processing from making one API call per
// chunk.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const OpenAI = (await import('openai')).default
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

  const BATCH_SIZE = 96
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    })
    // OpenAI returns embeddings in the same order as the input array.
    allEmbeddings.push(...response.data.map(d => d.embedding))
  }

  return allEmbeddings
}

// ── 4. Retrieval ─────────────────────────────────────────────────────────
// Called from ai/generate/route.ts before buildPrompt(). Never throws —
// a knowledge-base hiccup should degrade to "no extra context" rather than
// fail the whole generation. Skips the embedding API call entirely for
// workspaces with zero ready chunks, so workspaces that never uploaded
// anything pay no extra latency or cost on every generation.
export async function retrieveRelevantChunks(
  workspaceId: string,
  query: string,
  topK = 5,
): Promise<string[]> {
  if (!query.trim()) return []

  const admin = createSupabaseAdmin()

  try {
    const { count } = await admin
      .from('knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)

    if (!count || count === 0) return []

    const [queryEmbedding] = await embedTexts([query])
    if (!queryEmbedding) return []

    const { data, error } = await admin.rpc('match_knowledge_chunks', {
      query_embedding: queryEmbedding,
      match_workspace_id: workspaceId,
      match_count: topK,
    })

    if (error) {
      console.error('[knowledge-base] retrieval RPC failed:', error.message)
      return []
    }

    return (data ?? []).map((row: { content: string }) => row.content)
  } catch (err) {
    // Covers: OPENAI_API_KEY missing/invalid, network failure, etc.
    console.error('[knowledge-base] retrieval failed, continuing without it:', err)
    return []
  }
}

// ── File type detection from upload ─────────────────────────────────────
export function detectFileType(filename: string, mimeType: string): KnowledgeFileType | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (ext === 'txt' || mimeType === 'text/plain') return 'txt'
  return null
}

// Confirms the file's actual bytes match its claimed type — filename
// extension and client-supplied Content-Type are both trivially spoofed
// (rename anything.exe to anything.pdf), so detectFileType() alone only
// tells you what the uploader *claims* the file is. This checks the
// magic bytes/file signature instead, which is what the content actually
// is. Doesn't replace real antivirus/content scanning (out of scope for
// what this codebase can do without a third-party scanning service) but
// blocks the basic "wrong file type with a renamed extension" case cheaply.
export function verifySignature(buffer: Buffer, claimedType: KnowledgeFileType): boolean {
  if (claimedType === 'pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  }
  if (claimedType === 'docx') {
    // DOCX is a ZIP container — 'PK\x03\x04' is the standard local-file-header
    // signature. This confirms "this is a real ZIP archive", which is as
    // far as a cheap signature check can verify without fully parsing the
    // archive's internal structure.
    const sig = buffer.subarray(0, 4)
    return sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 0x03 && sig[3] === 0x04
  }
  // .txt has no reliable magic bytes — plain text is, definitionally,
  // whatever bytes it contains. Extraction (buffer.toString('utf-8')) is
  // safe on arbitrary bytes regardless, so there's nothing meaningful to
  // check here.
  return true
}
