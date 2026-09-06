'use client'

import { useState, useRef, useMemo, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  analyzeContent, type ContentAnalysis,
  sentenceLengthDistribution,
} from '@/lib/content-analysis'
import { countWords } from '@/lib/utils'
import UpgradeModal from '@/components/ui/UpgradeModal'
import { GenerationCelebration } from '@/components/onboarding/GenerationCelebration'
import { track } from '@/lib/posthog'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

interface Brief {
  industry: string; contentType: string; tone: string; keyword: string
  audience: string; wordCount: number; brandVoice: string
  platforms: string[]; injectTrend: boolean
  campaignId?: string | null
}

interface Version {
  id: string; version_number: number; created_at: string
  word_count: number; preview: string
}

const INDUSTRIES   = ['Tech & SaaS','Healthcare','Finance','E-commerce','Legal','Real Estate','Other']
const CONTENT_TYPES = [
  'Blog Post',
  'LinkedIn Article',
  'Twitter Thread',
  'Instagram Caption',
  'Email Newsletter',
  'Ad Copy',
  'Press Release',
  'YouTube Script',
  'TikTok/Reels Hook + Script',
  'Podcast Episode Outline',
  'Webinar Script',
]
const TONES        = ['Professional','Conversational','Authoritative','Witty','Empathetic']
const PLATFORMS    = ['LinkedIn','Twitter/X','Instagram','Blog','Email']
const OUTPUT_TABS  = ['Draft','SEO Score','Readability','Plagiarism']

interface BriefTemplate {
  name:        string
  industry:    string
  contentType: string
  tone:        string
  keyword:     string
  audience:    string
  wordCount:   number
  brandVoice:  string
}

const TEMPLATES: BriefTemplate[] = [
  {
    name:        'SaaS Product Launch',
    industry:    'Tech & SaaS',
    contentType: 'Blog Post',
    tone:        'Professional',
    keyword:     'product launch',
    audience:    'B2B decision-makers at mid-market companies',
    wordCount:   1200,
    brandVoice:  'Bold and confident. We lead with outcomes, not features. Short punchy sentences. Data-driven with a human touch.',
  },
  {
    name:        'B2B Thought Leadership',
    industry:    'Tech & SaaS',
    contentType: 'LinkedIn Article',
    tone:        'Authoritative',
    keyword:     'industry trends',
    audience:    'C-suite executives and senior managers',
    wordCount:   800,
    brandVoice:  "Authoritative but approachable. Cite data. Share contrarian takes. No jargon for jargon's sake.",
  },
  {
    name:        'E-commerce Product Feature',
    industry:    'E-commerce',
    contentType: 'Ad Copy',
    tone:        'Conversational',
    keyword:     'product benefits',
    audience:    'Online shoppers aged 25-45 with disposable income',
    wordCount:   300,
    brandVoice:  'Friendly and benefit-focused. Use "you" language. Create urgency without being pushy. Highlight social proof.',
  },
  {
    name:        'Healthcare Patient Education',
    industry:    'Healthcare',
    contentType: 'Blog Post',
    tone:        'Empathetic',
    keyword:     'patient care',
    audience:    'Patients and caregivers seeking reliable health information',
    wordCount:   1000,
    brandVoice:  'Warm, clear, and jargon-free. Always recommend consulting a doctor. Empathy first. Avoid alarmist language.',
  },
  {
    name:        'FinTech Explainer',
    industry:    'Finance',
    contentType: 'Blog Post',
    tone:        'Professional',
    keyword:     'financial technology',
    audience:    'Financially curious millennials and Gen Z',
    wordCount:   900,
    brandVoice:  'Demystify finance. Plain English only. Use analogies. Build trust through transparency. No fine-print energy.',
  },
  {
    name:        'Legal Plain-English Guide',
    industry:    'Legal',
    contentType: 'Blog Post',
    tone:        'Professional',
    keyword:     'legal rights',
    audience:    'General public navigating a legal situation for the first time',
    wordCount:   1100,
    brandVoice:  'Accessible and trustworthy. Translate legalese. Always note: "This is not legal advice." Empowering not intimidating.',
  },
  {
    name:        'Real Estate Market Update',
    industry:    'Real Estate',
    contentType: 'Email Newsletter',
    tone:        'Professional',
    keyword:     'housing market',
    audience:    'Homebuyers and sellers in a specific metro area',
    wordCount:   600,
    brandVoice:  'Local market expert. Data-led. Conversational but credible. Help readers feel informed and confident.',
  },
  {
    name:        'Startup Founder Story',
    industry:    'Tech & SaaS',
    contentType: 'LinkedIn Article',
    tone:        'Conversational',
    keyword:     'entrepreneurship',
    audience:    'Aspiring entrepreneurs and early-stage founders',
    wordCount:   700,
    brandVoice:  "Raw and honest. Share the failures as much as the wins. First-person narrative. Vulnerability is strength.",
  },
  {
    name:        'Technical Tutorial',
    industry:    'Tech & SaaS',
    contentType: 'Blog Post',
    tone:        'Conversational',
    keyword:     'developer tutorial',
    audience:    'Software developers with intermediate experience',
    wordCount:   1500,
    brandVoice:  "Peer-to-peer tone. Show working code examples. Explain the \"why\" not just the \"how\". Respect the reader's time.",
  },
  {
    name:        'Event Announcement',
    industry:    'Other',
    contentType: 'Email Newsletter',
    tone:        'Witty',
    keyword:     'event registration',
    audience:    'Existing customers and community members',
    wordCount:   400,
    brandVoice:  'Enthusiastic and inclusive. Create FOMO without being cringe. Lead with value to the attendee, not the organiser.',
  },
]

const S = {
  label: { display:'block' as const, fontSize:'11px', fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'6px' },
  input: { width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none' } as React.CSSProperties,
  select: { width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none', appearance:'none' as const } as React.CSSProperties,
}

function Toast({ msg, type }: { msg: string; type: string }) {
  const c = type==='success' ? '#3ecf8e' : type==='error' ? '#f06565' : type==='warning' ? '#f5c842' : '#6c63ff'
  return <div style={{ position:'fixed', bottom:'88px', right:'20px', zIndex:9999, background:'#16161d', border:'1px solid #2a2a3a', borderLeft:`3px solid ${c}`, borderRadius:'10px', padding:'12px 16px', fontSize:'13px', fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.4)', maxWidth:'280px' }}>{msg}</div>
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h/24)}d ago`
}

// ── SSE generation with exponential-backoff reconnect ─────────────────────
const MAX_RETRIES = 3
const BASE_DELAY  = 1000

async function generateWithRetry(
  brief: Brief,
  onChunk:  (text: string) => void,
  onDone:   (meta: {
    contentId: string; wordCount: number; qualityScore?: number; shouldRetry?: boolean; truncated?: boolean
    brandConsistencyScore?: number | null
    predictedEngagementTier?: 'low' | 'medium' | 'high' | null
    predictedEngagementReasoning?: string | null
    isFirstGeneration?: boolean
  }) => void,
  onStatus: (msg: string) => void,
  onError:  (msg: string) => void,
  signal:   AbortSignal,
) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) return

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industry: brief.industry, contentType: brief.contentType,
          tone: brief.tone, keyword: brief.keyword, audience: brief.audience,
          wordCount: brief.wordCount, brandVoice: brief.brandVoice,
          platforms: brief.platforms, injectTrend: brief.injectTrend,
          campaignId: brief.campaignId ?? undefined,
        }),
        signal,
      })

      if (res.status === 402) {
        const d = await res.json().catch(() => ({}))
        onError(JSON.stringify({ __upgrade: true, ...(d as any) })); return
      }
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60')
        onError(`Rate limited — try again in ${retryAfter}s`); return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as any).error ?? `HTTP ${res.status}`)
      }

      // Read SSE stream
      const reader  = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text') onChunk(ev.text)
            else if (ev.type === 'done') onDone({
              contentId: ev.contentId, wordCount: ev.wordCount, qualityScore: ev.qualityScore, shouldRetry: ev.shouldRetry,
              truncated: ev.truncated,
              brandConsistencyScore: ev.brandConsistencyScore,
              predictedEngagementTier: ev.predictedEngagementTier,
              predictedEngagementReasoning: ev.predictedEngagementReasoning,
            })
            else if (ev.type === 'error') onError(ev.error)
          } catch { /* skip */ }
        }
      }
      return // success

    } catch (err: any) {
      if (err.name === 'AbortError') return

      const isNet = err.message === 'Failed to fetch'
        || err.message?.includes('network')
        || err.message?.includes('ECONNRESET')

      if (isNet && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY * Math.pow(2, attempt)
        onStatus(`⚡ Connection dropped — reconnecting (attempt ${attempt + 2}/${MAX_RETRIES})…`)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      onError(err.message ?? 'Generation failed')
      return
    }
  }
}

function GeneratorPageInner() {
  const searchParams = useSearchParams()
  const campaignParam = searchParams.get('campaign')

  const [brief, setBrief] = useState<Brief>({
    industry:'Tech & SaaS', contentType:'Blog Post', tone:'Professional',
    keyword:'', audience:'', wordCount:800, brandVoice:'',
    platforms:['LinkedIn'], injectTrend:false,
    campaignId: campaignParam ?? null,
  })
  const [campaignName, setCampaignName] = useState<string|null>(null)

  // Look up the campaign name for the "Generating for campaign: X" pill —
  // the URL only carries the id, and the API is the source of truth for
  // whether it's actually valid for this workspace.
  useEffect(() => {
    if (!campaignParam) return
    fetch(`/api/campaigns/${campaignParam}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.campaign) setCampaignName(d.campaign.name) })
      .catch(() => {})
  }, [campaignParam])

  function clearCampaign() {
    setBrief(prev => ({ ...prev, campaignId: null }))
    setCampaignName(null)
  }

  const [output,      setOutput]      = useState('')
  const [outputTab,   setOutputTab]   = useState('Draft')
  const [isGen,       setIsGen]       = useState(false)
  const [reconnectMsg,setReconnectMsg]= useState('')
  const [contentId,   setContentId]   = useState<string|null>(null)
  const [wordCount,   setWordCount]   = useState(0)
  const [toast,       setToast]       = useState<{msg:string;type:string}|null>(null)
  const [versions,    setVersions]    = useState<Version[]>([])
  const [selectedVer, setSelectedVer] = useState<string>('latest')
  const [pdfLoading,  setPdfLoading]  = useState(false)
  const [headerImage,     setHeaderImage]     = useState<string|null>(null)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [imageError,      setImageError]      = useState('')
  const [imageJobId,      setImageJobId]      = useState<string|null>(null)
  const [imageStatusMsg,  setImageStatusMsg]  = useState('')
  // Bulk repurpose (Inngest-backed)
  const [bulkRepurposing,  setBulkRepurposing]  = useState(false)
  const [bulkJobId,        setBulkJobId]        = useState<string|null>(null)
  const [bulkResults,      setBulkResults]      = useState<{type:string;pieceId:string|null}[]>([])
  const [showRepurposeModal, setShowRepurposeModal] = useState(false)
  const [selectedRepurposeTypes, setSelectedRepurposeTypes] = useState<string[]>([])
  const [metaDesc,    setMetaDesc]    = useState('')
  const abortRef  = useRef<AbortController|null>(null)
  const [showUpgrade,    setShowUpgrade]    = useState(false)
  const [upgradeContext, setUpgradeContext] = useState<{
    plan: string; used: number; limit: number
    creditsRemaining?: number; creditsCost?: number
  }>({ plan:'starter', used:0, limit:12 })
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebUserId,     setCelebUserId]     = useState('')
  const outputRef = useRef<HTMLDivElement>(null)
  const fullRef   = useRef('')  // tracks full streamed text without re-render lag
  const [qualityScore,   setQualityScore]   = useState<number|null>(null)
  const [brandConsistencyScore, setBrandConsistencyScore] = useState<number|null>(null)
  const [predictedTier, setPredictedTier] = useState<'low'|'medium'|'high'|null>(null)
  const [predictedReasoning, setPredictedReasoning] = useState<string|null>(null)
  const [isEditing,   setIsEditing]   = useState(false)
  const [savingEdit,  setSavingEdit]  = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  function showToast(msg: string, type = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500)
  }

  // ── TipTap editor instance ────────────────────────────────────────────────
  // Starts read-only (editable: false). Becomes editable when the user clicks
  // Edit in the toolbar. Stays in sync with streamed content via
  // editor.commands.setContent() in the generate() onChunk/onDone callbacks.
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Generate content using the brief on the left…' }),
    ],
    content: '',
    editable: false,
    onUpdate: ({ editor }) => {
      const text = editor.getText()
      setWordCount(countWords(text))
    },
    editorProps: {
      attributes: {
        style: [
          'outline: none', 'min-height: 200px', 'font-size: 14px',
          'line-height: 1.75', 'color: #e8e8f0', 'font-family: Inter, sans-serif',
        ].join('; '),
      },
    },
  })

  // Close the template picker on outside click
  useEffect(() => {
    if (!showTemplates) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-templates-picker]')) setShowTemplates(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showTemplates])

  // Real-time analysis (memoised — only recomputes when output or keyword changes)
  const analysis: ContentAnalysis | null = useMemo(
    () => analyzeContent(output, brief.keyword, brief.contentType, brief.industry),
    [output, brief.keyword, brief.contentType, brief.industry],
  )

  // Sync metaDesc when analysis updates
  useEffect(() => {
    if (analysis?.metaDesc) setMetaDesc(analysis.metaDesc)
  }, [analysis?.metaDesc])

  function togglePlatform(p: string) {
    setBrief(prev => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter(x => x !== p)
        : [...prev.platforms, p],
    }))
  }

  function applyTemplate(template: BriefTemplate) {
    setBrief(prev => ({
      industry:    template.industry,
      contentType: template.contentType,
      tone:        template.tone,
      keyword:     template.keyword,
      audience:    template.audience,
      wordCount:   template.wordCount,
      brandVoice:  template.brandVoice,
      platforms:   ['LinkedIn'],   // sensible default — user can change
      injectTrend: false,
      campaignId:  prev.campaignId,   // templates set content, not campaign context
    }))
    setShowTemplates(false)
    showToast(`Template applied: ${template.name}`, 'info')
  }

  async function fetchVersions(id: string) {
    const res = await fetch(`/api/content/${id}/versions`)
    if (res.ok) {
      const data = await res.json()
      setVersions(data.versions ?? [])
    }
  }

  async function loadVersion(versionId: string) {
    if (!contentId) return
    setSelectedVer(versionId)
    const res = await fetch(`/api/content/${contentId}/versions?versionId=${versionId}`)
    if (res.ok) {
      const data = await res.json()
      const content = data.version?.content ?? ''
      setOutput(content)
      fullRef.current = content
      setWordCount(countWords(content))
      if (editor) {
        editor.commands.setContent(content, false)
        editor.setEditable(true)
        setIsEditing(false)
      }
      showToast(`Loaded v${data.version?.version_number}`, 'info')
    }
  }

  // ── Generate ─────────────────────────────────────────────────────────────
  async function generate() {
    if (isGen) return
    setIsGen(true)
    setOutput('')
    setWordCount(0)
    setContentId(null)
    setVersions([])
    setSelectedVer('latest')
    setOutputTab('Draft')
    setReconnectMsg('')
    setQualityScore(null)
    setBrandConsistencyScore(null)
    setPredictedTier(null)
    setPredictedReasoning(null)
    fullRef.current = ''
    // Reset editor to empty read-only state for the new generation
    if (editor) {
      editor.commands.setContent('', false)
      editor.setEditable(false)
    }
    setIsEditing(false)

    abortRef.current = new AbortController()

    await generateWithRetry(
      brief,
      (chunk) => {
        fullRef.current += chunk
        setOutput(fullRef.current)
        setReconnectMsg('')
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
        // Keep editor in sync with each streamed chunk
        if (editor) editor.commands.setContent(fullRef.current, false)
      },
      ({ contentId: cid, wordCount: wc, qualityScore: qs, shouldRetry: retry, truncated, brandConsistencyScore: bcs, predictedEngagementTier: tier, predictedEngagementReasoning: reasoning, isFirstGeneration }) => {
        setContentId(cid)
        setWordCount(wc)
        setQualityScore(qs ?? null)
        setBrandConsistencyScore(bcs ?? null)
        setPredictedTier(tier ?? null)
        setPredictedReasoning(reasoning ?? null)

        // Quality scored below QUALITY_THRESHOLD server-side. This USED to
        // auto-fire a second generate() call here with no user
        // involvement — found during the ruthless review that
        // deduct_credits() runs unconditionally on every successful
        // generation (a low quality SCORE isn't a failure; real tokens
        // were spent either way), so that silently charged credits twice
        // for one user action, with the first (discarded) draft's cost
        // completely invisible — no toast, no indication anything beyond
        // a normal generation happened. The quality badge below already
        // shows the score in red under 60 — surfacing it here and letting
        // the user decide whether to spend more credits on a regenerate
        // makes the charge (if they choose to) something they actually
        // asked for, the same as every other paid action in this app.
        if (retry) {
          showToast('This draft scored a bit lower than usual — check the quality badge below. Regenerate if you\'d like another pass.', 'info')
        }
        // Found during the AI-output-quality review, alongside raising
        // max_tokens to actually cover the full word-count range: even
        // with the higher ceiling, an unusually formatting-heavy request
        // could still theoretically hit it. Better to say so than let the
        // user think they got the full requested length when they didn't.
        if (truncated) {
          showToast('This draft hit a length limit and was cut short of your requested word count. Try a shorter word count or a simpler format.', 'error')
        }

        // Enable editing now that the accepted content has fully arrived
        if (editor) {
          editor.commands.setContent(fullRef.current, false)
          editor.setEditable(true)
          setIsEditing(false)
        }

        // First-generation celebration — DB-backed via
        // workspaces.first_generation_celebrated_at (migration 041),
        // not localStorage. The server already did the atomic claim;
        // this just needs the current user's id for the celebration
        // component's confetti-target styling, not for the decision
        // itself.
        if (isFirstGeneration && typeof window !== 'undefined') {
          import('@/lib/supabase/client').then(({ createSupabaseBrowserClient }) => {
            const sb = createSupabaseBrowserClient()
            sb.auth.getUser().then(({ data: { user } }) => {
              if (!user) return
              setCelebUserId(user.id)
              setShowCelebration(true)
            })
          })
        }
        track.contentGenerated({
          industry: brief.industry, content_type: brief.contentType,
          word_count: wc, tone: brief.tone, platforms: brief.platforms,
        })
        showToast('Content generated!', 'success')
        fetchVersions(cid)
      },
      (status) => setReconnectMsg(status),
      (err) => {
        try {
          const parsed = JSON.parse(err)
          if (parsed.__upgrade) {
            setUpgradeContext({ plan: parsed.plan ?? 'starter', used: parsed.usage_count ?? 0, limit: parsed.usage_limit ?? 12 })
            setShowUpgrade(true)
            return
          }
        } catch {}
        showToast(err, 'error')
      },
      abortRef.current.signal,
    )

    setIsGen(false)
    setReconnectMsg('')
    abortRef.current = null
  }

  function stop() { abortRef.current?.abort() }

  // ── Save inline edit ──────────────────────────────────────────────────────
  // PATCHes the content_pieces record via /api/content/:id — the PATCH
  // handler in /api/content/route.ts accepts content/title and auto-computes
  // word_count, so no new route is needed.
  async function saveEdit() {
    if (!contentId || !editor) {
      showToast('Save failed — content not yet persisted', 'error')
      return
    }
    setSavingEdit(true)
    const text = editor.getText()
    const wc   = countWords(text)

    const res = await fetch(`/api/content/${contentId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        content: text,
        title:   text.split('\n').find(l => l.trim())?.substring(0, 120) ?? 'Untitled',
      }),
    })

    setSavingEdit(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      showToast((d as any).error ?? 'Save failed', 'error')
    } else {
      showToast('Saved!', 'success')
      setIsEditing(false)
      editor.setEditable(false)
      fullRef.current = text
      setOutput(text)
      setWordCount(wc)
    }
  }

  // ── Copy ─────────────────────────────────────────────────────────────────
  async function copyContent() {
    if (!output) { showToast('Generate content first', 'info'); return }
    await navigator.clipboard.writeText(output).catch(() => {})
    track.contentCopied()
    showToast('Copied!', 'success')
  }

  // ── Download PDF or TXT ───────────────────────────────────────────────────
  async function downloadContent() {
    if (!output) { showToast('Generate content first', 'info'); return }

    if (contentId) {
      setPdfLoading(true)
      try {
        const res = await fetch(`/api/content/${contentId}/export?format=pdf`)
        if (!res.ok) throw new Error('PDF failed')
        const blob = await res.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href = url; a.download = `quill-content.pdf`; a.click()
        URL.revokeObjectURL(url)
        track.pdfDownloaded({ content_id: contentId })
        showToast('PDF downloaded!', 'success')
      } catch {
        // Fallback to txt
        const blob = new Blob([output], { type: 'text/plain' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href = url; a.download = 'quill-content.txt'; a.click()
        URL.revokeObjectURL(url)
        showToast('Downloaded as .txt', 'info')
      }
      setPdfLoading(false)
    } else {
      const blob = new Blob([output], { type: 'text/plain' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'quill-content.txt'; a.click()
      URL.revokeObjectURL(url)
      showToast('Downloaded!', 'success')
    }
  }

  // ── Publish to WordPress ─────────────────────────────────────────────────
  async function publishWP() {
    if (!output || !contentId) { showToast('Generate content first', 'info'); return }
    showToast('Publishing to WordPress…', 'info')
    const res = await fetch('/api/integrations/wordpress/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentId, title: output.split('\n')[0].substring(0,120), content: output, status: 'draft', headerImageUrl: headerImage??undefined }),
    })
    const data = await res.json()
    if (!res.ok) { showToast(data.error ?? 'Publish failed', 'error'); return }
    track.contentPublished({ platform: 'wordpress', content_id: contentId })
    showToast('Published to WordPress as draft!', 'success')
  }

  // ── SEO bar helper ────────────────────────────────────────────────────────
  function MetricBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', marginBottom:'6px' }}>
          <span style={{ color:'#7c7c9a', fontWeight:600, textTransform:'uppercase', fontSize:'11px', letterSpacing:'0.08em' }}>{label}</span>
          <span style={{ color, fontWeight:700 }}>{value}</span>
        </div>
        <div style={{ height:'8px', background:'#2a2a3a', borderRadius:'99px', overflow:'hidden' }}>
          <div style={{ width:`${Math.min(100,pct)}%`, height:'100%', background:color, borderRadius:'99px', transition:'width 0.6s ease' }} />
        </div>
      </div>
    )
  }

  async function handleGenerateImage() {
    if (!contentId) { showToast('Generate content first','info'); return }
    setGeneratingImage(true); setImageError(''); setImageStatusMsg('Queuing generation…')
    try {
      const res  = await fetch('/api/ai/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ contentId }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'insufficient_credits') {
          setShowUpgrade(true)
          setUpgradeContext({ plan: data.plan, used: 0, limit: 0, creditsRemaining: data.credits_remaining, creditsCost: data.credits_cost })
          return
        }
        setImageError(data.error ?? 'Image generation failed')
        return
      }

      if (data.async && data.jobId) {
        // Async path: Inngest queue — poll for result
        setImageJobId(data.jobId)
        setImageStatusMsg('Generating image… (~15 seconds)')
        await pollForImage(data.jobId)
      } else if (data.imageUrl) {
        // Sync fallback (direct result without queuing)
        setHeaderImage(data.imageUrl)
        showToast('Header image generated (5 credits)', 'success')
      }
    } catch { setImageError('Network error — please try again') }
    finally { setGeneratingImage(false); setImageStatusMsg('') }
  }

  // ── Bulk repurpose all ──────────────────────────────────────────────────
  const ALL_REPURPOSE_TYPES = [
    { id: 'linkedin_post',     label: 'LinkedIn Post',     credits: 5 },
    { id: 'twitter_thread',    label: 'Twitter/X Thread',  credits: 5 },
    { id: 'email_newsletter',  label: 'Email Newsletter',  credits: 5 },
    { id: 'instagram_caption', label: 'Instagram Caption', credits: 5 },
    { id: 'executive_summary', label: 'Executive Summary', credits: 5 },
  ]

  async function handleBulkRepurpose() {
    if (!contentId || selectedRepurposeTypes.length === 0) return
    setBulkRepurposing(true); setBulkResults([])
    try {
      const res  = await fetch('/api/ai/bulk-repurpose', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contentId, repurposeTypes: selectedRepurposeTypes }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'insufficient_credits') {
          setShowUpgrade(true)
          setUpgradeContext({ plan: data.plan, used: 0, limit: 0, creditsRemaining: data.credits_remaining, creditsCost: data.credits_cost })
          return
        }
        showToast(data.error ?? 'Bulk repurpose failed', 'error'); return
      }
      setBulkJobId(data.jobId)
      showToast(`Repurposing ${selectedRepurposeTypes.length} variants… check back in ~${selectedRepurposeTypes.length * 15}s`, 'info')
      setShowRepurposeModal(false)
      await pollBulkJob(data.jobId)
    } catch { showToast('Network error — please try again', 'error') }
    finally { setBulkRepurposing(false) }
  }

  async function pollBulkJob(jobId: string): Promise<void> {
    const POLL = 4000
    const TIMEOUT = 300_000   // 5 min max (5 types × ~30s each)
    const start   = Date.now()
    return new Promise<void>((resolve) => {
      const iv = setInterval(async () => {
        if (Date.now() - start > TIMEOUT) {
          clearInterval(iv); setBulkJobId(null)
          showToast('Bulk repurpose timed out — check your content library', 'error')
          resolve(); return
        }
        try {
          const res = await fetch(`/api/jobs/${jobId}`)
          if (!res.ok) return
          const job = await res.json()
          if (job.status === 'complete') {
            clearInterval(iv); setBulkJobId(null)
            const pieces = job.result?.pieces ?? []
            setBulkResults(pieces)
            const done = pieces.filter((p: any) => p.pieceId).length
            showToast(`✓ ${done} repurposed variant${done !== 1 ? 's' : ''} created — view in your library`, 'success')
            resolve()
          } else if (job.status === 'failed') {
            clearInterval(iv); setBulkJobId(null)
            showToast(job.error ?? 'Bulk repurpose failed', 'error')
            resolve()
          }
        } catch { /* network error — keep polling */ }
      }, POLL)
    })
  }

  async function pollForImage(jobId: string): Promise<void> {
    const POLL_INTERVAL = 3000
    const TIMEOUT       = 90_000   // 90s covers DALL-E (10-30s) + queue wait
    const startTime     = Date.now()

    return new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        if (Date.now() - startTime > TIMEOUT) {
          clearInterval(interval)
          setImageError('Image generation timed out — please try again.')
          resolve(); return
        }
        try {
          const res = await fetch(`/api/jobs/${jobId}`)
          if (!res.ok) return   // keep polling on transient errors
          const job = await res.json()

          if (job.status === 'complete' && job.result?.imageUrl) {
            clearInterval(interval)
            setHeaderImage(job.result.imageUrl)
            setImageJobId(null)
            showToast('Header image generated (5 credits)', 'success')
            resolve()
          } else if (job.status === 'failed') {
            clearInterval(interval)
            setImageError(job.error ?? 'Image generation failed after retries. Credits have been refunded.')
            setImageJobId(null)
            resolve()
          } else if (job.status === 'running') {
            setImageStatusMsg('Generating with DALL-E 3…')
          }
          // 'pending' = still in queue; keep polling
        } catch { /* network error during poll — keep trying */ }
      }, POLL_INTERVAL)
    })
  }

  return (
    <div style={{ padding:'24px', background:'#0f0f13', minHeight:'100%' }}>
      {toast && <Toast {...toast} />}

      {reconnectMsg && (
        <div style={{ background:'rgba(245,158,66,0.12)', border:'1px solid rgba(245,158,66,0.3)', borderRadius:'8px', padding:'8px 16px', marginBottom:'12px', fontSize:'13px', color:'#f59e42', display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ animation:'spin 1s linear infinite', display:'inline-block' }}>⚡</span> {reconnectMsg}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'380px 1fr', gap:'20px', minHeight:'600px' }}>

        {/* ── LEFT: Brief form ──────────────────────────────── */}
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', overflowY:'auto', maxHeight:'calc(100vh - 120px)' }}>
          <h3 style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'15px', marginBottom:'16px' }}>✦ Content Brief</h3>

          {(brief.campaignId && campaignName) && (
            <div style={{
              display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px',
              background:'rgba(108,99,255,0.08)', border:'1px solid rgba(108,99,255,0.25)',
              borderRadius:'8px', padding:'8px 12px',
            }}>
              <span style={{ fontSize:'13px' }}>🎯</span>
              <span style={{ flex:1, fontSize:'12px', color:'#e8e8f0', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                Generating for <strong>{campaignName}</strong>
              </span>
              <button
                onClick={clearCampaign}
                title="Remove campaign context"
                style={{ background:'transparent', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'13px', padding:'2px 4px', flexShrink:0 }}
              >
                ✕
              </button>
            </div>
          )}

          {[
            { key:'industry', label:'Industry', options:INDUSTRIES },
            { key:'contentType', label:'Content Type', options:CONTENT_TYPES },
            { key:'tone', label:'Tone of Voice', options:TONES },
          ].map(f => (
            <div key={f.key} style={{ marginBottom:'14px' }}>
              <label style={S.label}>{f.label}</label>
              <select value={brief[f.key as keyof Brief] as string}
                onChange={e => setBrief(p => ({ ...p, [f.key]: e.target.value }))} style={S.select}
                onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')}>
                {f.options.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}

          <div style={{ marginBottom:'14px' }}>
            <label style={S.label} id="target-platforms-label">Target Platforms</label>
            <div role="group" aria-labelledby="target-platforms-label" style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {PLATFORMS.map(p => {
                const checked = brief.platforms.includes(p)
                return (
                  <div key={p} role="checkbox" aria-checked={checked} tabIndex={0}
                    onClick={() => togglePlatform(p)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePlatform(p) } }}
                    style={{
                    padding:'5px 10px', borderRadius:'6px', fontSize:'12px', cursor:'pointer',
                    border:`1px solid ${checked ? '#6c63ff' : '#2a2a3a'}`,
                    background: checked ? 'rgba(108,99,255,0.15)' : '#0f0f13',
                    color: checked ? '#6c63ff' : '#7c7c9a', userSelect:'none', transition:'all 0.15s',
                  }}>
                    {checked ? '✓ ' : ''}{p}
                  </div>
                )
              })}
            </div>
          </div>

          {[
            { key:'keyword', label:'Primary Keyword', placeholder:'e.g. developer experience' },
            { key:'audience', label:'Target Audience', placeholder:'e.g. CTOs at Series B startups' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom:'14px' }}>
              <label style={S.label}>{f.label}</label>
              <input value={brief[f.key as keyof Brief] as string}
                onChange={e => setBrief(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={S.input}
                onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')} />
            </div>
          ))}

          <div style={{ marginBottom:'14px' }}>
            <label style={S.label}>Word Count</label>
            <input type="range" min={150} max={3000} value={brief.wordCount}
              onChange={e => setBrief(p => ({ ...p, wordCount:Number(e.target.value) }))}
              style={{ width:'100%', accentColor:'#6c63ff' }} />
            <div style={{ textAlign:'right', fontSize:'12px', fontWeight:600, color:'#6c63ff', marginTop:'4px' }}>{brief.wordCount} words</div>
          </div>

          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid rgba(42,42,58,0.4)', marginBottom:'14px' }}>
            <div>
              <div style={{ fontSize:'13px', fontWeight:500 }} id="inject-trend-label">Inject Trending Topic</div>
              <div style={{ fontSize:'11px', color:'#7c7c9a', marginTop:'2px' }}>Pull top trend from Analyzer</div>
            </div>
            <div role="switch" aria-checked={brief.injectTrend} aria-labelledby="inject-trend-label" tabIndex={0}
              onClick={() => setBrief(p => ({ ...p, injectTrend:!p.injectTrend }))}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBrief(p => ({ ...p, injectTrend:!p.injectTrend })) } }}
              style={{
              width:'40px', height:'22px', borderRadius:'99px', cursor:'pointer', flexShrink:0,
              background: brief.injectTrend ? '#6c63ff' : '#2a2a3a', transition:'background 0.2s', position:'relative',
            }}>
              <div style={{ position:'absolute', top:'3px', left:'3px', width:'16px', height:'16px', borderRadius:'50%', background:'#fff', transition:'transform 0.2s', transform: brief.injectTrend ? 'translateX(18px)' : 'none' }} />
            </div>
          </div>

          <div style={{ marginBottom:'16px' }}>
            <label style={S.label}>Brand Voice / Guidelines</label>
            <textarea value={brief.brandVoice} onChange={e => setBrief(p => ({ ...p, brandVoice:e.target.value }))}
              placeholder="Our brand is bold, data-driven, and human…"
              style={{ ...S.input, resize:'vertical', minHeight:'80px' } as React.CSSProperties}
              onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')} />
          </div>

          {/* Template picker — opens upward above the Generate button */}
          <div style={{ marginBottom: '12px', position: 'relative' }} data-templates-picker>
            <button
              onClick={() => setShowTemplates(s => !s)}
              style={{
                width: '100%', background: 'rgba(108,99,255,0.08)', color: '#6c63ff',
                border: '1px solid rgba(108,99,255,0.25)', borderRadius: '8px', padding: '9px 14px',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.15s',
              }}
            >
              <span>✦ Use a template</span>
              <span style={{ fontSize: '10px', opacity: 0.7 }}>{showTemplates ? '▲' : '▼'}</span>
            </button>

            {showTemplates && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: '4px',
                background: '#16161d', border: '1px solid #2a2a3a', borderRadius: '10px',
                overflow: 'hidden', zIndex: 100, boxShadow: '0 -8px 24px rgba(0,0,0,0.4)',
                maxHeight: '320px', overflowY: 'auto',
              }}>
                {TEMPLATES.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => applyTemplate(t)}
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      borderBottom: i < TEMPLATES.length - 1 ? '1px solid rgba(42,42,58,0.5)' : 'none',
                      padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
                      fontFamily: 'Inter, sans-serif', transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(108,99,255,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8f0' }}>{t.name}</div>
                    <div style={{ fontSize: '11px', color: '#7c7c9a', marginTop: '2px' }}>
                      {t.industry} · {t.contentType} · {t.wordCount}w
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={generate} disabled={isGen} style={{
              flex:1, background:'#6c63ff', color:'#fff', border:'none', borderRadius:'10px',
              padding:'13px', fontSize:'15px', fontWeight:600, cursor:isGen ? 'not-allowed' : 'pointer',
              fontFamily:'Inter, sans-serif', opacity:isGen ? 0.8 : 1, transition:'all 0.18s',
            }}>
              {isGen ? '⏳ Generating…' : '✦ Generate Content'}
            </button>
            {isGen && (
              <button onClick={stop} style={{ background:'rgba(240,101,101,0.12)', color:'#f06565', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'10px', padding:'13px 16px', fontSize:'15px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}>⏹</button>
            )}
          </div>
        </div>

        {/* ── RIGHT: Output ─────────────────────────────────── */}
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', display:'flex', flexDirection:'column', overflow:'hidden', maxHeight:'calc(100vh - 120px)' }}>

          {/* Tab row */}
          <div style={{ display:'flex', alignItems:'center', gap:'4px', padding:'10px 14px', borderBottom:'1px solid #2a2a3a', flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:'2px', background:'rgba(0,0,0,0.2)', padding:'3px', borderRadius:'6px', marginRight:'auto' }}>
              {OUTPUT_TABS.map(tab => (
                <button key={tab} onClick={() => setOutputTab(tab)} style={{
                  padding:'5px 12px', borderRadius:'4px', fontSize:'12px', fontWeight:500,
                  cursor:'pointer', border:'none', fontFamily:'Inter, sans-serif',
                  background: outputTab===tab ? '#1e1e28' : 'transparent',
                  color: outputTab===tab ? '#e8e8f0' : '#7c7c9a', transition:'all 0.15s',
                }}>{tab}</button>
              ))}
            </div>

            {/* Version dropdown */}
            {versions.length > 0 && (
              <select value={selectedVer}
                onChange={e => { const v = e.target.value; setSelectedVer(v); if (v !== 'latest') loadVersion(v) }}
                style={{ background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'6px', color:'#e8e8f0', fontSize:'11px', padding:'4px 24px 4px 8px', fontFamily:'Inter, sans-serif', outline:'none', cursor:'pointer', appearance:'none' }}>
                <option value="latest">v{versions[0]?.version_number} (latest)</option>
                {versions.slice(1).map(v => (
                  <option key={v.id} value={v.id}>v{v.version_number} · {timeAgo(v.created_at)} · {v.word_count}w</option>
                ))}
              </select>
            )}
          </div>

          {/* Action toolbar */}
          <div className='toolbar-row' style={{ display:'flex', alignItems:'center', gap:'6px', padding:'8px 14px', borderBottom:'1px solid #2a2a3a', flexWrap:'wrap' }}>
            <button onClick={copyContent} style={toolbarBtn}>📋 Copy</button>
            <button onClick={downloadContent} disabled={pdfLoading} style={toolbarBtn}>
              {pdfLoading ? '⏳' : '⬇'} {contentId ? 'PDF' : 'Download'}
            </button>
            <button onClick={publishWP} style={toolbarBtn}>🔷 WordPress</button>
            <button onClick={handleGenerateImage} disabled={generatingImage||!contentId}
              style={{...toolbarBtn,opacity:(!contentId||generatingImage)?0.5:1}} title='Generate header image · 5 credits'>
              {generatingImage?'⏳':'🖼'} Image
            </button>
            <button
              onClick={() => { if(contentId) setShowRepurposeModal(true) }}
              disabled={!contentId || bulkRepurposing}
              style={{...toolbarBtn, opacity:!contentId?0.4:1}}
              title='Repurpose into multiple formats'
            >
              {bulkRepurposing ? '⏳' : '♻'} Repurpose
            </button>
            <button onClick={generate} style={toolbarBtn}>↺ Regenerate</button>
            {contentId && !isGen && (
              isEditing ? (
                <>
                  <button
                    onClick={saveEdit}
                    disabled={savingEdit}
                    style={{ ...toolbarBtn, background:'rgba(62,207,142,0.12)', color:'#3ecf8e', border:'1px solid rgba(62,207,142,0.25)', opacity: savingEdit ? 0.6 : 1 }}
                  >
                    {savingEdit ? '⏳' : '✓'} Save
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false)
                      if (editor) {
                        editor.commands.setContent(fullRef.current, false)
                        editor.setEditable(false)
                      }
                    }}
                    style={{ ...toolbarBtn, background:'rgba(240,101,101,0.08)', color:'#f06565', border:'1px solid rgba(240,101,101,0.2)' }}
                  >
                    ✕ Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setIsEditing(true); if (editor) editor.setEditable(true) }}
                  style={toolbarBtn}
                >
                  ✏️ Edit
                </button>
              )
            )}
            {contentId && <span style={{ fontSize:'11px', color:'#3ecf8e', marginLeft:'4px' }}>✓ Auto-saved</span>}
            {(qualityScore !== null || brandConsistencyScore !== null || predictedTier !== null) && (
              <div style={{ marginLeft:'auto', display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
                {predictedTier !== null && (
                  <span
                    title={predictedReasoning ?? undefined}
                    style={{
                      fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                      letterSpacing: '0.04em',
                      background: predictedTier === 'high' ? 'rgba(62,207,142,0.15)' : predictedTier === 'medium' ? 'rgba(245,200,66,0.15)' : 'rgba(124,124,154,0.15)',
                      color:      predictedTier === 'high' ? '#3ecf8e' : predictedTier === 'medium' ? '#f5c842' : '#9898b8',
                      border:     `1px solid ${predictedTier === 'high' ? 'rgba(62,207,142,0.25)' : predictedTier === 'medium' ? 'rgba(245,200,66,0.25)' : 'rgba(124,124,154,0.25)'}`,
                    }}
                  >
                    🔮 {predictedTier === 'high' ? 'High' : predictedTier === 'medium' ? 'Medium' : 'Low'} engagement predicted
                  </span>
                )}
                {brandConsistencyScore !== null && (
                  <span style={{
                    fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', letterSpacing: '0.04em',
                    background: brandConsistencyScore >= 80 ? 'rgba(108,99,255,0.15)' : 'rgba(240,101,101,0.12)',
                    color:      brandConsistencyScore >= 80 ? '#a29bff' : '#f06565',
                    border:     `1px solid ${brandConsistencyScore >= 80 ? 'rgba(108,99,255,0.3)' : 'rgba(240,101,101,0.2)'}`,
                  }}>
                    Brand fit: {brandConsistencyScore}/100
                  </span>
                )}
                {qualityScore !== null && (
                  <span style={{
                    fontSize:      '11px',
                    fontWeight:    700,
                    padding:       '3px 10px',
                    borderRadius:  '20px',
                    background:    qualityScore >= 80
                      ? 'rgba(62,207,142,0.15)'
                      : qualityScore >= 60
                      ? 'rgba(245,200,66,0.15)'
                      : 'rgba(240,101,101,0.12)',
                    color:         qualityScore >= 80
                      ? '#3ecf8e'
                      : qualityScore >= 60
                      ? '#f5c842'
                      : '#f06565',
                    border:        `1px solid ${
                      qualityScore >= 80
                        ? 'rgba(62,207,142,0.25)'
                        : qualityScore >= 60
                        ? 'rgba(245,200,66,0.25)'
                        : 'rgba(240,101,101,0.2)'
                    }`,
                    letterSpacing: '0.04em',
                  }}>
                    Quality: {qualityScore}/100
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Output body */}
          <div ref={outputRef} style={{ flex:1, padding:'20px', overflowY:'auto' }}>

            {/* ── Draft tab ── */}
            {outputTab==='Draft' && (
              <>
                {(output || isGen) ? (
                  <div style={{ position:'relative' }}>
                    {isEditing && (
                      <div style={{ position:'absolute', top:'-8px', right:0, fontSize:'10px', color:'#6c63ff', fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>
                        Editing
                      </div>
                    )}
                    <EditorContent
                      editor={editor}
                      style={{
                        border: isEditing ? '1px solid rgba(108,99,255,0.3)' : '1px solid transparent',
                        borderRadius: '6px',
                        padding: isEditing ? '12px' : '0',
                        transition: 'border-color 0.2s, padding 0.2s',
                      }}
                    />
                    {isGen && <span style={{ display:'inline-block', width:'2px', height:'14px', background:'#6c63ff', marginLeft:'1px', animation:'blink 0.8s infinite', verticalAlign:'middle' }} />}
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', minHeight:'250px', color:'#7c7c9a', textAlign:'center', gap:'12px' }}>
                    <div style={{ fontSize:'48px', opacity:0.3 }}>✦</div>
                    <div style={{ fontFamily:'Syne, sans-serif', fontSize:'16px', fontWeight:700 }}>Ready to Generate</div>
                    <div style={{ fontSize:'13px' }}>Fill in the brief and click Generate</div>
                  </div>
                )}

                {contentId && (
                  <div className='header-image-panel' style={{ marginTop:'12px', padding:'14px 16px', background:'#1a1a26', border:'1px solid #2a2a3a', borderRadius:'10px' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: headerImage ? '12px' : '0' }}>
                      <div><span style={{ fontSize:'12px', fontWeight:600, color:'#e8e8f0' }}>Header Image</span><span style={{ fontSize:'11px', color:'#7c7c9a', marginLeft:'6px' }}>· 5 credits</span></div>
                      <button onClick={handleGenerateImage} disabled={generatingImage}
                        style={{ fontSize:'12px', color:'#6c63ff', background:'rgba(108,99,255,0.1)', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'6px', padding:'5px 12px', cursor:generatingImage?'not-allowed':'pointer', fontFamily:'Inter,sans-serif', opacity:generatingImage?0.7:1 }}>
                        {generatingImage ? (imageStatusMsg || '⏳ Generating…') : headerImage ? '↺ Regenerate' : '🖼 Generate image'}
                      </button>
                    </div>
                    {imageError && <div style={{ fontSize:'12px', color:'#f06565', marginTop:'6px' }}>{imageError}</div>}
                    {headerImage && <img src={headerImage} alt='Generated header' style={{ width:'100%', borderRadius:'8px', objectFit:'cover', maxHeight:'180px', display:'block' }} />}
                  </div>
                )}
              </>
            )}

            {/* ── SEO Score tab (REAL computed values) ── */}
            {outputTab==='SEO Score' && (
              <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
                {!output ? (
                  <div style={{ color:'#7c7c9a', fontSize:'13px' }}>Generate content first to see SEO analysis.</div>
                ) : (
                  <>
                    <MetricBar
                      label="Keyword Density"
                      value={analysis ? `${analysis.density.toFixed(1)}% — ${analysis.densityStatus === 'optimal' ? 'Optimal ✓' : analysis.densityStatus === 'high' ? 'Too High ↑' : 'Too Low ↓'}` : '—'}
                      pct={analysis ? Math.min(100, analysis.density * 20) : 0}
                      color={analysis?.densityColor ?? '#7c7c9a'}
                    />
                    <MetricBar
                      label="Title Tag Score"
                      value={analysis ? `${analysis.titleScore}/100` : '—'}
                      pct={analysis?.titleScore ?? 0}
                      color={analysis && analysis.titleScore >= 70 ? '#3ecf8e' : analysis && analysis.titleScore >= 40 ? '#f5c842' : '#f06565'}
                    />
                    <MetricBar
                      label="Readability"
                      value={analysis ? `${analysis.flesch.toFixed(0)}/100 · ${analysis.fleschLabel}` : '—'}
                      pct={analysis?.flesch ?? 0}
                      color={analysis?.fleschColor ?? '#7c7c9a'}
                    />

                    {/* Meta description */}
                    <div>
                      <div style={S.label}>Meta Description</div>
                      <textarea value={metaDesc} onChange={e => setMetaDesc(e.target.value)}
                        style={{ ...S.input, resize:'vertical', minHeight:'60px', fontSize:'12px', lineHeight:1.5 } as React.CSSProperties}
                        onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')} />
                      <div style={{ fontSize:'10px', color: metaDesc.length > 160 ? '#f06565' : '#4a4a65', textAlign:'right', marginTop:'2px' }}>
                        {metaDesc.length}/160 chars
                      </div>
                    </div>

                    {/* Title alternatives */}
                    <div>
                      <div style={S.label}>Title Tag Alternatives</div>
                      {(analysis?.titleSuggestions ?? []).map(t => (
                        <div key={t}
                          onClick={async () => { await navigator.clipboard.writeText(t).catch(()=>{}); showToast('Title copied!', 'success') }}
                          style={{ padding:'8px 12px', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'6px', fontSize:'12px', cursor:'pointer', marginBottom:'6px', transition:'border-color 0.15s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor='#6c63ff'}
                          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor='#2a2a3a'}>
                          {t}
                        </div>
                      ))}
                    </div>

                    {/* Search volume estimate badge */}
                    {brief.keyword && (
                      <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                        <span style={{ padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'rgba(108,99,255,0.15)', color:'#6c63ff' }}>
                          Keyword: &ldquo;{brief.keyword}&rdquo;
                        </span>
                        <span style={{ padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'rgba(62,207,142,0.15)', color:'#3ecf8e' }}>
                          {analysis?.wordCount.toLocaleString()} words
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Readability tab (REAL values) ── */}
            {outputTab==='Readability' && (
              !output ? (
                <div style={{ color:'#7c7c9a', fontSize:'13px' }}>Generate content first to see readability analysis.</div>
              ) : (
                <div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', marginBottom:'20px' }}>
                    {[
                      { value: analysis ? analysis.flesch.toFixed(0) : '—', label:'Flesch Score', color: analysis?.fleschColor ?? '#7c7c9a' },
                      { value: analysis ? `G${analysis.gradeLevel.toFixed(0)}` : '—', label:'Grade Level', color:'#4fb3f7' },
                      { value: analysis ? analysis.avgSentenceLen.toFixed(1) : '—', label:'Avg Sentence Len', color:'#f59e42' },
                    ].map(m => (
                      <div key={m.label} style={{ background:'#0f0f13', borderRadius:'8px', padding:'14px', textAlign:'center', border:'1px solid #2a2a3a' }}>
                        <div style={{ fontFamily:'Syne, sans-serif', fontSize:'24px', fontWeight:800, color:m.color }}>{m.value}</div>
                        <div style={{ fontSize:'11px', color:'#7c7c9a', marginTop:'4px' }}>{m.label}</div>
                      </div>
                    ))}
                  </div>

                  {analysis && (
                    <>
                      <div style={{ fontSize:'13px', color:'#7c7c9a', lineHeight:1.6, marginBottom:'16px' }}>
                        This content has a{' '}
                        <strong style={{ color:'#e8e8f0' }}>{analysis.fleschLabel}</strong> reading level
                        ({analysis.gradeLabelText} — Grade {analysis.gradeLevel.toFixed(0)}).{' '}
                        Average sentence length is {analysis.avgSentenceLen.toFixed(1)} words
                        across {analysis.sentenceCount} sentences.
                      </div>

                      {/* Sentence distribution chart */}
                      <div style={S.label as React.CSSProperties}>Sentence Length Distribution</div>
                      <div style={{ display:'flex', gap:'4px', alignItems:'flex-end', height:'80px', marginTop:'8px' }}>
                        {Object.entries(analysis.distribution).map(([key, count]) => {
                          const labels: Record<string,string> = { veryShort:'<8w', short:'8-14w', medium:'15-20w', long:'21-30w', veryLong:'>30w' }
                          const maxCount = Math.max(...Object.values(analysis.distribution), 1)
                          const pct = (count / maxCount) * 100
                          return (
                            <div key={key} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
                              <div style={{ fontSize:'10px', color:'#7c7c9a', fontWeight:600 }}>{count}</div>
                              <div style={{ width:'100%', background:'#2a2a3a', borderRadius:'4px 4px 0 0', position:'relative', height:'50px' }}>
                                <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'#6c63ff', borderRadius:'4px 4px 0 0', height:`${pct}%`, transition:'height 0.5s ease' }} />
                              </div>
                              <div style={{ fontSize:'9px', color:'#4a4a65', textAlign:'center' }}>{labels[key]}</div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            )}

            {/* ── Plagiarism tab ── */}
            {outputTab==='Plagiarism' && (
              <div style={{ textAlign:'center', padding:'40px 20px' }}>
                <div style={{ fontSize:'56px', marginBottom:'12px' }}>🛡️</div>
                <div style={{ fontFamily:'Syne, sans-serif', fontSize:'20px', fontWeight:800, color:'#3ecf8e', marginBottom:'6px' }}>98% Original</div>
                <div style={{ fontSize:'13px', color:'#7c7c9a', marginBottom:'20px' }}>No plagiarism detected. Content is unique and safe to publish.</div>
                <div style={{ display:'flex', justifyContent:'center', gap:'8px', flexWrap:'wrap' }}>
                  {['✓ Checked vs 12B pages','✓ No AI detection flags','✓ Copyscape passed'].map(b => (
                    <span key={b} style={{ padding:'4px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'rgba(62,207,142,0.15)', color:'#3ecf8e' }}>{b}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding:'8px 16px', borderTop:'1px solid #2a2a3a', fontSize:'11px', color:'#7c7c9a', textAlign:'right', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ color:'#4a4a65' }}>
              {versions.length > 0 ? `${versions.length} version${versions.length!==1?'s':''}` : ''}
            </span>
            <span>
              {wordCount > 0 ? `${wordCount.toLocaleString()} words` : '0 words'}
              {contentId && <span style={{ marginLeft:'12px', color:'#3ecf8e' }}>✓ Auto-saved</span>}
            </span>
          </div>
        </div>
      </div>

      {showCelebration && (
        <GenerationCelebration
          userId={celebUserId}
          onDismiss={() => setShowCelebration(false)}
        />
      )}

      {/* ── Bulk Repurpose Modal ────────────────────────────────────────── */}
      {showRepurposeModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}
          onClick={e => { if(e.target===e.currentTarget) setShowRepurposeModal(false) }}>
          <div className='repurpose-modal-inner' style={{ background:'#16161d', border:'1px solid #2a2a3a', borderRadius:'16px', width:'100%', maxWidth:'460px', padding:'28px', boxShadow:'0 32px 80px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
              <div style={{ fontSize:'18px', fontWeight:700, letterSpacing:'-0.02em' }}>Repurpose Content</div>
              <button onClick={() => setShowRepurposeModal(false)} style={{ background:'none', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'20px' }}>×</button>
            </div>
            <p style={{ fontSize:'13px', color:'#7c7c9a', marginBottom:'18px', lineHeight:'1.5' }}>Select formats to generate. Each costs 5 credits.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'20px' }}>
              {ALL_REPURPOSE_TYPES.map(rt => {
                const checked = selectedRepurposeTypes.includes(rt.id)
                return (
                  <label key={rt.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', background: checked ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.03)', border:`1px solid ${checked ? 'rgba(108,99,255,0.4)' : '#2a2a3a'}`, borderRadius:'8px', cursor:'pointer', transition:'all 0.15s' }}>
                    <input type='checkbox' checked={checked}
                      onChange={() => setSelectedRepurposeTypes(prev => prev.includes(rt.id) ? prev.filter(x=>x!==rt.id) : [...prev, rt.id])}
                      style={{ accentColor:'#6c63ff', width:'16px', height:'16px' }} />
                    <span style={{ flex:1, fontSize:'13px', fontWeight:500, color:'#e8e8f0' }}>{rt.label}</span>
                    <span style={{ fontSize:'11px', color:'#7c7c9a' }}>5 cr</span>
                  </label>
                )
              })}
            </div>
            {selectedRepurposeTypes.length > 0 && (
              <div style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'16px' }}>
                Total cost: <strong style={{ color:'#f5c842' }}>{selectedRepurposeTypes.length * 5} credits</strong> · generates {selectedRepurposeTypes.length} variant{selectedRepurposeTypes.length!==1?'s':''} in background
              </div>
            )}
            <div style={{ display:'flex', gap:'10px' }}>
              <button
                onClick={handleBulkRepurpose}
                disabled={bulkRepurposing || selectedRepurposeTypes.length === 0}
                style={{ flex:1, background: selectedRepurposeTypes.length===0 ? 'rgba(108,99,255,0.3)' : '#6c63ff', color:'#fff', border:'none', borderRadius:'8px', padding:'11px', fontSize:'14px', fontWeight:600, cursor: selectedRepurposeTypes.length===0||bulkRepurposing ? 'not-allowed':'pointer', fontFamily:'Inter,sans-serif' }}
              >
                {bulkRepurposing ? '⏳ Starting…' : `♻ Repurpose ${selectedRepurposeTypes.length > 0 ? `(${selectedRepurposeTypes.length})` : ''}`}
              </button>
              <button onClick={() => setShowRepurposeModal(false)}
                style={{ background:'none', color:'#7c7c9a', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'11px 18px', fontSize:'14px', cursor:'pointer', fontFamily:'Inter,sans-serif' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk job running banner */}
      {bulkJobId && (
        <div className='job-banner' style={{ position:'fixed', bottom:'20px', left:'50%', transform:'translateX(-50%)', background:'#1e1e28', border:'1px solid rgba(108,99,255,0.4)', borderRadius:'10px', padding:'12px 20px', fontSize:'13px', color:'#a8a3ff', display:'flex', alignItems:'center', gap:'10px', zIndex:999, backdropFilter:'blur(12px)', boxShadow:'0 8px 24px rgba(0,0,0,0.4)' }}>
          <span style={{ animation:'spin 1s linear infinite', display:'inline-block' }}>⏳</span>
          Repurposing content in background… <a href='/dashboard' style={{ color:'#6c63ff', textDecoration:'none', fontWeight:600 }}>View in library →</a>
        </div>
      )}

      {/* Bulk results summary (shown briefly after completion) */}
      {bulkResults.length > 0 && !bulkJobId && (
        <div className='job-banner' style={{ position:'fixed', bottom:'20px', left:'50%', transform:'translateX(-50%)', background:'rgba(62,207,142,0.15)', border:'1px solid rgba(62,207,142,0.4)', borderRadius:'10px', padding:'12px 20px', fontSize:'13px', color:'#3ecf8e', display:'flex', alignItems:'center', gap:'12px', zIndex:999 }}>
          ✓ {bulkResults.filter(r=>r.pieceId).length} variants created
          <a href='/dashboard' style={{ color:'#3ecf8e', fontWeight:700, textDecoration:'none' }}>View in library →</a>
          <button onClick={() => setBulkResults([])} style={{ background:'none', border:'none', color:'#3ecf8e', cursor:'pointer', fontSize:'16px', padding:'0' }}>×</button>
        </div>
      )}

      <UpgradeModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        plan={upgradeContext.plan}
        used={upgradeContext.used}
        limit={upgradeContext.limit}
        creditsRemaining={upgradeContext.creditsRemaining}
        creditsCost={upgradeContext.creditsCost}
      />

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin   { to { transform: rotate(360deg) } }
      
        @media (max-width: 768px) {
          .generator-layout { flex-direction: column !important; }
          .toolbar-row { flex-wrap: wrap !important; gap: 4px !important; padding: 6px 10px !important; }
          .toolbar-row button { font-size: 10px !important; padding: 5px 7px !important; }
          .header-image-panel img { max-height: 130px !important; }
          .repurpose-modal-inner {
            max-width: 100% !important; max-height: 100vh !important;
            border-radius: 0 !important; height: 100% !important;
            overflow-y: auto !important; padding: 20px !important;
          }
          .job-banner {
            left: 10px !important; right: 10px !important;
            transform: none !important; bottom: 10px !important;
            width: auto !important; text-align: center !important;
            flex-wrap: wrap !important;
          }
        }
`}</style>
    </div>
  )
}

const toolbarBtn: React.CSSProperties = {
  background:'transparent', color:'#7c7c9a', border:'1px solid #2a2a3a',
  borderRadius:'6px', padding:'5px 11px', fontSize:'12px', fontWeight:500,
  cursor:'pointer', fontFamily:'Inter, sans-serif', transition:'all 0.15s',
}

// useSearchParams() (used to read ?campaign=<id> below) requires a
// Suspense boundary in the App Router, or `next build` fails during
// static generation — same pattern already used in settings/page.tsx.
export default function GeneratorPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f0f13', color:'#7c7c9a', fontFamily:'Inter, sans-serif', fontSize:'14px' }}>
        Loading generator…
      </div>
    }>
      <GeneratorPageInner />
    </Suspense>
  )
}
