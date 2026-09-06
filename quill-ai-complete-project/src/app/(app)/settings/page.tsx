'use client'

import { useEffect, useState, useRef, FormEvent, Suspense } from 'react'
import { SEAT_LIMITS } from '@/lib/seats'
import { formatBytes } from '@/lib/storage-quota'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useSearchParams } from 'next/navigation'
import { track } from '@/lib/posthog'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface BrandKnowledge {
  products:      { name: string; description: string; differentiators: string }[]
  competitors:   string[]
  toneExamples:  string[]
  bannedPhrases: string[]
}

const DEFAULT_BRAND_KNOWLEDGE: BrandKnowledge = {
  products:      [{ name: '', description: '', differentiators: '' }],
  competitors:   [''],
  toneExamples:  ['', '', ''],
  bannedPhrases: [''],
}

// ── BYOK provider presets ────────────────────────────────────────────────
// Convenience layer only — every one of these ultimately stores either
// 'anthropic' (native Messages API) or 'openai_compatible' (generic, via
// baseUrl) in the database. Presets just pre-fill the base URL and give
// people a recognizable name to pick instead of hand-typing an endpoint.
// 'custom' covers anything not listed — any endpoint that speaks the
// OpenAI chat-completions protocol works, not just these five.
const BYOK_PRESETS = [
  { key: 'anthropic', label: 'Anthropic (Claude)', dbProvider: 'anthropic' as const,
    baseUrl: null, modelPlaceholder: 'claude-sonnet-4-20250514', keyPlaceholder: 'sk-ant-api03-…' },
  { key: 'openai', label: 'OpenAI', dbProvider: 'openai_compatible' as const,
    baseUrl: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-4o', keyPlaceholder: 'sk-…' },
  { key: 'gemini', label: 'Google Gemini', dbProvider: 'openai_compatible' as const,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', modelPlaceholder: 'gemini-2.0-flash', keyPlaceholder: 'AIza…' },
  { key: 'nvidia', label: 'NVIDIA NIM', dbProvider: 'openai_compatible' as const,
    baseUrl: 'https://integrate.api.nvidia.com/v1', modelPlaceholder: 'nvidia/llama-3.1-nemotron-70b-instruct', keyPlaceholder: 'nvapi-…' },
  { key: 'groq', label: 'Groq', dbProvider: 'openai_compatible' as const,
    baseUrl: 'https://api.groq.com/openai/v1', modelPlaceholder: 'llama-3.3-70b-versatile', keyPlaceholder: 'gsk_…' },
  { key: 'custom', label: 'Custom (OpenAI-compatible)', dbProvider: 'openai_compatible' as const,
    baseUrl: '', modelPlaceholder: 'model-name', keyPlaceholder: 'API key' },
] as const

interface Workspace {
  id: string; name: string; slug: string; plan: string
  usage_count: number; usage_limit: number
  storage_used_bytes: number; storage_limit_bytes: number
  brand_voice: string | null; industry: string | null; logo_url: string | null
  stripe_subscription_id: string | null; stripe_customer_id: string | null
  subscription_status: string | null; trial_ends_at: string | null
  deletion_requested_at: string | null; scheduled_purge_at: string | null
}
interface Integration { provider: string; status: string; config: Record<string, unknown> }
interface Member { user_id: string; role: string; status: string }
interface PendingInvite { id: string; email: string; role: string; expires_at: string; created_at: string }

const INTEGRATIONS_META = [
  { provider:'linkedin',  name:'LinkedIn',  icon:'🔷', type:'oauth',     note:'60-day tokens · Reconnect monthly',         desc:'Publish directly to LinkedIn. No Buffer required.' },
  { provider:'wordpress', name:'WordPress', icon:'🌐', type:'form',      note:'',                                           desc:'Publish blog posts to your WordPress site.' },
  { provider:'buffer',    name:'Buffer',    icon:'📱', type:'oauth',     note:'',                                           desc:'Schedule to LinkedIn, X, Instagram, Facebook.' },
  { provider:'hubspot',   name:'HubSpot',   icon:'🟠', type:'waitlist',  note:'',                                           desc:'Sync content to your HubSpot CRM.' },
  { provider:'mailchimp', name:'Mailchimp', icon:'🐵', type:'waitlist',  note:'',                                           desc:'Send newsletters via Mailchimp.' },
  { provider:'hootsuite', name:'Hootsuite', icon:'🦉', type:'waitlist',  note:'',                                           desc:'Advanced social scheduling.' },
  { provider:'medium',    name:'Medium',    icon:'Ⓜ️',  type:'waitlist',  note:'',                                           desc:'Cross-post to Medium.' },
]
const ROLE_OPTIONS = [
  { value:'admin',  label:'Admin',  desc:'Can manage team and settings' },
  { value:'editor', label:'Editor', desc:'Can create and publish content' },
  { value:'viewer', label:'Viewer', desc:'Can view content only' },
]
const PLAN_BADGE: Record<string,{bg:string;color:string}> = {
  starter:   { bg:'rgba(124,124,154,0.15)', color:'#7c7c9a' },
  growth:    { bg:'rgba(108,99,255,0.15)',  color:'#6c63ff' },
  agency:    { bg:'rgba(245,200,66,0.15)',  color:'#f5c842' },
  cancelled: { bg:'rgba(240,101,101,0.15)', color:'#f06565' },
}
const STATUS_LABELS: Record<string,{label:string;color:string}> = {
  active:     { label:'Active',   color:'#3ecf8e' },
  trialing:   { label:'Trialing', color:'#4fb3f7' },
  past_due:   { label:'Past Due', color:'#f06565' },
  cancelled:  { label:'Cancelled',color:'#f59e42' },
  incomplete: { label:'Incomplete',color:'#f59e42' },
}

const S = {
  card:       { background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', marginBottom:'16px' } as React.CSSProperties,
  label:      { display:'block' as const, fontSize:'11px', fontWeight:600, textTransform:'uppercase' as const, letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'6px' },
  input:      { width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none' } as React.CSSProperties,
  textarea:   { width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none', resize:'vertical' as const, minHeight:'80px' } as React.CSSProperties,
  select:     { width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none', appearance:'none' as const } as React.CSSProperties,
  btnPrimary: { background:'#6c63ff', color:'#fff', border:'none', borderRadius:'8px', padding:'9px 18px', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' } as React.CSSProperties,
  btnGhost:   { background:'transparent', color:'#e8e8f0', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'8px 14px', fontSize:'13px', fontWeight:500, cursor:'pointer', fontFamily:'Inter, sans-serif' } as React.CSSProperties,
  btnDanger:  { background:'rgba(240,101,101,0.1)', color:'#f06565', border:'1px solid rgba(240,101,101,0.25)', borderRadius:'8px', padding:'9px 18px', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' } as React.CSSProperties,
}

function Toast({ message, type }: { message:string; type:'success'|'error'|'info' }) {
  const c = { success:'#3ecf8e', error:'#f06565', info:'#6c63ff' }[type]
  return <div style={{ position:'fixed', bottom:'80px', right:'20px', zIndex:9999, background:'#16161d', border:`1px solid #2a2a3a`, borderLeft:`3px solid ${c}`, borderRadius:'10px', padding:'12px 16px', fontSize:'13px', fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.4)', maxWidth:'300px' }}>{message}</div>
}
function ToggleRow({ label, defaultOn }: { label:string; defaultOn:boolean }) {
  const [on, setOn] = useState(defaultOn)
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid rgba(42,42,58,0.3)' }}>
      <span style={{ fontSize:'13px', fontWeight:500 }}>{label}</span>
      <div role="switch" aria-checked={on} aria-label={label} tabIndex={0}
        onClick={()=>setOn(!on)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOn(!on) } }}
        style={{ width:'40px', height:'22px', borderRadius:'99px', cursor:'pointer', background:on?'#6c63ff':'#2a2a3a', transition:'background 0.2s', position:'relative', flexShrink:0 }}>
        <div style={{ position:'absolute', top:'3px', left:'3px', width:'16px', height:'16px', borderRadius:'50%', background:'#fff', transition:'transform 0.2s', transform:on?'translateX(18px)':'none' }} />
      </div>
    </div>
  )
}

function SettingsPageInner() {
  const supabase = createSupabaseBrowserClient()
  const searchParams = useSearchParams()

  const [workspace,      setWorkspace]      = useState<Workspace|null>(null)
  const [myRole,         setMyRole]         = useState<string>('member')
  const [integrations,   setIntegrations]   = useState<Integration[]>([])
  const [members,        setMembers]        = useState<Member[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [loading,        setLoading]        = useState(true)
  const [seatLimit,      setSeatLimit]      = useState(1)
  // Webhooks state
  const [webhooks,       setWebhooks]       = useState<any[]>([])
  const [showNewSecret,  setShowNewSecret]  = useState<string|null>(null)
  const [webhookUrl,     setWebhookUrl]     = useState('')
  const [webhookEvents,  setWebhookEvents]  = useState<string[]>([])
  const [webhookDesc,    setWebhookDesc]    = useState('')
  const [webhookLoading, setWebhookLoading] = useState(false)
  // Branding state (Agency only)
  const [brandColor,     setBrandColor]     = useState('#6c63ff')
  const [brandName,      setBrandName]      = useState('')
  const [whiteLabelOn,   setWhiteLabelOn]   = useState(false)
  const [brandSaving,    setBrandSaving]    = useState(false)
  const [domainData,     setDomainData]     = useState<any>(null)
  const [newDomain,      setNewDomain]      = useState('')
  const [domainLoading,  setDomainLoading]  = useState(false)
  const [seatsUsed,      setSeatsUsed]      = useState(0)
  const [seatsPending,   setSeatsPending]   = useState(0)
  const [saving,         setSaving]         = useState(false)
  const [toast,          setToast]          = useState<{message:string;type:'success'|'error'|'info'}|null>(null)

  // ── BYOK (Bring Your Own Key) state ────────────────────────────────────
  const [byokStatus, setByokStatus] = useState<{
    configured: boolean; useOwnKey: boolean; provider: string|null; baseUrl: string|null; model: string|null
    addedAt: string|null; lastError: string|null; lastErrorAt: string|null
  } | null>(null)
  const [byokPresetKey, setByokPresetKey] = useState('anthropic')
  const [byokKeyInput,  setByokKeyInput]  = useState('')
  const [byokBaseUrl,   setByokBaseUrl]   = useState('')
  const [byokModel,     setByokModel]     = useState('')
  const [byokShowInput, setByokShowInput] = useState(false)
  const [byokSaving,    setByokSaving]    = useState(false)
  const [byokRemoving,  setByokRemoving]  = useState(false)
  // Unified confirmation-dialog state for every destructive action on this
  // page — found during a ruthless test pass that KB doc delete, BYOK key
  // removal, invite revoke, webhook delete, and domain removal all fired
  // immediately with zero confirmation. One shared dialog + this discriminated
  // union covers all five instead of five bespoke modals.
  const [pendingConfirm, setPendingConfirm] = useState<
    | { action: 'kb-delete';    id: string; label: string }
    | { action: 'byok-remove' }
    | { action: 'invite-revoke'; id: string; label: string }
    | { action: 'webhook-delete'; id: string; label: string }
    | { action: 'domain-remove'; label: string }
    | null
  >(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  // ── AI Knowledge Base state ────────────────────────────────────────────
  interface KbDocument {
    id: string; filename: string; file_type: string; file_size_bytes: number|null
    status: 'processing'|'ready'|'failed'; error_message: string|null
    chunk_count: number; created_at: string
    flagged_content: boolean; flagged_reasons: string[]|null
    scan_status: 'skipped'|'clean'|'flagged'; scan_detail: string|null
  }
  const [kbDocuments, setKbDocuments] = useState<KbDocument[]>([])
  const [kbUploading,  setKbUploading]  = useState(false)
  const [kbDeleting,   setKbDeleting]   = useState<string|null>(null)
  const kbFileInputRef = useRef<HTMLInputElement>(null)

  // ── Approval workflow stages ────────────────────────────────────────────
  interface StageDraft { name: string; requiredRole: 'owner'|'admin'|'editor' }
  const [stageDrafts, setStageDrafts] = useState<StageDraft[]>([])
  const [stagesSaving, setStagesSaving] = useState(false)
  const [stagesDirty, setStagesDirty] = useState(false)

  const [brandForm, setBrandForm] = useState({ name:'', industry:'', brandVoice:'' })
  const [bk, setBk] = useState<BrandKnowledge>(DEFAULT_BRAND_KNOWLEDGE)

  // WordPress modal
  const [wpModal,  setWpModal]  = useState(false)
  const [wpForm,   setWpForm]   = useState({ siteUrl:'', username:'', appPassword:'' })
  const [wpSaving, setWpSaving] = useState(false)

  // Invite modal
  const [inviteModal, setInviteModal] = useState(false)
  const [inviteForm,  setInviteForm]  = useState({ email:'', role:'editor' })
  const [inviting,    setInviting]    = useState(false)

  // Waitlist modal
  const [waitlistModal, setWaitlistModal] = useState<string|null>(null)
  const [waitlistEmail, setWaitlistEmail] = useState('')

  // Billing portal loading
  const [billingLoading, setBillingLoading] = useState(false)

  // Export loading
  const [exportLoading, setExportLoading] = useState(false)

  // Delete account modal
  const [deleteModal,    setDeleteModal]    = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting,       setDeleting]       = useState(false)
  const [cancellingDeletion, setCancellingDeletion] = useState(false)

  function showToast(message:string, type:'success'|'error'|'info'='success') {
    setToast({ message, type }); setTimeout(()=>setToast(null), 3500)
  }

  useEffect(() => {
    if (searchParams.get('connected')==='buffer')   showToast('Buffer connected!','success')
    if (searchParams.get('connected')==='linkedin') showToast('LinkedIn connected!','success')
    const integrationError = searchParams.get('error')
    if (integrationError) {
      // LinkedIn's callback sends short known codes; GSC's callback
      // already sends a real, readable message directly — show that
      // verbatim instead of discarding it for a generic fallback.
      const knownCodes: Record<string,string> = {
        workspace_pending_deletion: 'This workspace is scheduled for deletion — cancel it below before connecting integrations.',
        no_workspace: 'Workspace not found. Try refreshing and reconnecting.',
        linkedin_denied: 'LinkedIn authorization was denied or cancelled.',
        linkedin_state_mismatch: 'Security check failed — please try connecting again.',
      }
      showToast(knownCodes[integrationError] ?? decodeURIComponent(integrationError) ?? 'Integration failed. Try again.', 'error')
    }
    if (searchParams.get('billing')==='success') showToast('Subscription activated!','success')
    fetchAll()
  }, [])

  useEffect(() => {
    fetch('/api/webhooks').then(r=>r.ok?r.json():null).then(d=>{ if(d) setWebhooks(d.endpoints??[]) })
    fetch('/api/branding').then(r=>r.ok?r.json():null).then(d=>{
      if(d){ setBrandColor(d.brand_primary_color??'#6c63ff'); setBrandName(d.brand_company_name??''); setWhiteLabelOn(d.white_label_enabled??false) }
    })
    fetch('/api/domains').then(r=>r.ok?r.json():null).then(d=>{ if(d?.domain) setDomainData(d.domain) })
    fetch('/api/workspace/byok').then(r=>r.ok?r.json():null).then(d=>{ if(d) setByokStatus(d) })
    fetchKbDocuments()
    fetch('/api/workspace/approval-stages').then(r => r.ok ? r.json() : null).then(d => {
      if (d) setStageDrafts((d.stages ?? []).map((s: any) => ({ name: s.name, requiredRole: s.required_role })))
    })
  }, [])

  // Poll while any document is still processing — a fixed interval is
  // simpler than a websocket for something that finishes in seconds to a
  // couple minutes, and this only runs while the tab is actually open.
  useEffect(() => {
    if (!kbDocuments.some(d => d.status === 'processing')) return
    const interval = setInterval(fetchKbDocuments, 4000)
    return () => clearInterval(interval)
  }, [kbDocuments])

  async function fetchKbDocuments() {
    const res = await fetch('/api/knowledge-base')
    if (res.ok) {
      const d = await res.json()
      setKbDocuments(d.items ?? [])
    }
  }

  async function uploadKbFile(file: File) {
    setKbUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/knowledge-base/upload', { method: 'POST', body: formData })
    const d = await res.json().catch(() => ({}))
    setKbUploading(false)
    if (!res.ok) { showToast(d.error ?? 'Upload failed', 'error'); return }
    showToast(`${file.name} uploaded — processing…`, 'success')
    fetchKbDocuments()
  }

  async function deleteKbDocument(id: string) {
    setKbDeleting(id)
    const res = await fetch(`/api/knowledge-base/${id}`, { method: 'DELETE' })
    setKbDeleting(null)
    setConfirmLoading(false)
    setPendingConfirm(null)
    if (!res.ok) { showToast('Failed to delete document', 'error'); return }
    setKbDocuments(prev => prev.filter(d => d.id !== id))
    showToast('Document removed', 'info')
  }

  function fmtFileSize(bytes: number | null) {
    if (!bytes) return ''
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function addStage() {
    setStageDrafts(prev => [...prev, { name: '', requiredRole: 'admin' }])
    setStagesDirty(true)
  }

  function updateStage(index: number, patch: Partial<StageDraft>) {
    setStageDrafts(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
    setStagesDirty(true)
  }

  function removeStage(index: number) {
    setStageDrafts(prev => prev.filter((_, i) => i !== index))
    setStagesDirty(true)
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= stageDrafts.length) return
    setStageDrafts(prev => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setStagesDirty(true)
  }

  async function saveStages() {
    if (stageDrafts.some(s => !s.name.trim())) { showToast('Every stage needs a name', 'error'); return }
    setStagesSaving(true)
    const res = await fetch('/api/workspace/approval-stages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stages: stageDrafts.map(s => ({ name: s.name.trim(), requiredRole: s.requiredRole })) }),
    })
    setStagesSaving(false)
    if (res.ok) { showToast('Approval workflow saved', 'success'); setStagesDirty(false) }
    else showToast('Failed to save workflow', 'error')
  }

  async function saveByokKey() {
    if (!byokKeyInput.trim() || !byokModel.trim()) return
    const preset = BYOK_PRESETS.find(p => p.key === byokPresetKey) ?? BYOK_PRESETS[0]
    if (preset.dbProvider === 'openai_compatible' && !byokBaseUrl.trim()) return

    setByokSaving(true)
    const res = await fetch('/api/workspace/byok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        preset.dbProvider === 'anthropic'
          ? { provider: 'anthropic', apiKey: byokKeyInput.trim(), model: byokModel.trim() }
          : { provider: 'openai_compatible', apiKey: byokKeyInput.trim(), baseUrl: byokBaseUrl.trim(), model: byokModel.trim() }
      ),
    })
    const d = await res.json().catch(() => ({}))
    setByokSaving(false)
    if (!res.ok) { showToast(d.error ?? 'Could not validate this key', 'error'); return }
    showToast(`${preset.label} key connected — generations now run on your account.`, 'success')
    setByokKeyInput(''); setByokBaseUrl(''); setByokModel('')
    setByokShowInput(false)
    fetch('/api/workspace/byok').then(r=>r.ok?r.json():null).then(d=>{ if(d) setByokStatus(d) })
  }

  async function removeByokKey() {
    setByokRemoving(true)
    const res = await fetch('/api/workspace/byok', { method: 'DELETE' })
    setByokRemoving(false)
    setConfirmLoading(false)
    setPendingConfirm(null)
    if (!res.ok) { showToast('Could not remove key','error'); return }
    showToast('Key removed — generations now run on Quill.AI\'s platform key.', 'info')
    setByokStatus({ configured:false, useOwnKey:false, provider:null, baseUrl:null, model:null, addedAt:null, lastError:null, lastErrorAt:null })
  }

  async function fetchAll() {
    setLoading(true)
    const { data:{ user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Cast to any: this loose Database stub can't resolve Supabase's
    // nested-join type inference for aliased relations like
    // `workspace:workspaces(...)`. Real generated types would resolve
    // this correctly — see src/lib/types/database.ts for details.
    const { data:member } = await (supabase
      .from('workspace_members')
      .select(`
        workspace:workspaces (
          id, name, slug, plan, usage_count, usage_limit,
          storage_used_bytes, storage_limit_bytes,
          brand_voice, industry, logo_url,
          stripe_subscription_id, stripe_customer_id, subscription_status, trial_ends_at,
          deletion_requested_at, scheduled_purge_at
        ),
        role
      `)
      .eq('user_id', user.id).eq('status','active').limit(1).single() as any)

    const ws = member?.workspace as unknown as Workspace
    if (ws) {
      setWorkspace(ws)
      setMyRole((member as any)?.role ?? 'member')
      setBrandForm({ name:ws.name??'', industry:ws.industry??'', brandVoice:ws.brand_voice??'' })
      // Load structured brand knowledge base if present
      const rawBk = (ws as any).brand_knowledge
      if (rawBk && typeof rawBk === 'object') {
        setBk({
          products:      rawBk.products      ?? DEFAULT_BRAND_KNOWLEDGE.products,
          competitors:   rawBk.competitors   ?? DEFAULT_BRAND_KNOWLEDGE.competitors,
          toneExamples:  rawBk.toneExamples  ?? DEFAULT_BRAND_KNOWLEDGE.toneExamples,
          bannedPhrases: rawBk.bannedPhrases ?? DEFAULT_BRAND_KNOWLEDGE.bannedPhrases,
        })
      }
      const [intsRes, memsRes, invRes] = await Promise.all([
        supabase.from('integrations').select('provider,status,config').eq('workspace_id',ws.id),
        supabase.from('workspace_members').select('user_id,role,status').eq('workspace_id',ws.id),
        fetch('/api/workspace/invites'),
      ])
      setIntegrations(intsRes.data ?? [])
      setMembers((memsRes.data ?? []) as unknown as Member[])
      if (invRes.ok) {
        const d = await invRes.json()
        setPendingInvites(d.invites ?? [])
        if (d.seats) {
          setSeatLimit(d.seats.limit)
          setSeatsUsed(d.seats.total)
          setSeatsPending(d.seats.pending)
        } else if (ws) {
          setSeatLimit(SEAT_LIMITS[ws.plan] ?? 1)
          setSeatsUsed(memsRes.data?.length ?? 0)
        }
      }
    }
    setLoading(false)
  }

  async function saveBrand(e:FormEvent) {
    e.preventDefault(); if (!workspace) return; setSaving(true)
    const { error } = await supabase.from('workspaces').update({
      name:            brandForm.name,
      industry:        brandForm.industry,
      brand_voice:     brandForm.brandVoice,
      brand_knowledge: bk,
    }).eq('id',workspace.id)
    setSaving(false)
    error ? showToast('Save failed: '+error.message,'error') : showToast('Brand profile saved!')
  }

  async function openBillingPortal() {
    setBillingLoading(true)
    try {
      const res = await fetch('/api/stripe/billing-portal', { method:'POST' })
      const data = await res.json()
      if (data.url) { window.location.href = data.url; return }
      showToast(data.error === 'no_subscription' ? 'No active subscription yet.' : (data.error ?? 'Could not open billing portal.'), 'error')
    } catch {
      // Found alongside the create-checkout stuck-spinner bug: res.json()
      // itself throws if the server ever returns something that isn't
      // valid JSON (exactly what an unhandled backend exception produces
      // — Next.js's own error page, not a clean error body). Without this
      // catch, that throw skips every line below it, including
      // setBillingLoading(false), and the button stays in its loading
      // state indefinitely with zero feedback — precisely the "only the
      // timer icon changes" symptom reported live.
      showToast('Could not open billing portal — please try again.', 'error')
    } finally {
      setBillingLoading(false)
    }
  }

  async function openUpgradeCheckout(priceId: string) {
    setBillingLoading(true)
    try {
      const res = await fetch('/api/stripe/create-checkout', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ priceId }) })
      const data = await res.json()
      if (data.url) { window.location.href = data.url; return }
      showToast(data.error ?? 'Could not start checkout.', 'error')
    } catch {
      showToast('Could not start checkout — please try again.', 'error')
    } finally {
      setBillingLoading(false)
    }
  }

  async function exportData() {
    setExportLoading(true)
    try {
      const res = await fetch('/api/gdpr/export')
      if (!res.ok) { const d = await res.json(); showToast(d.error ?? 'Export failed','error'); setExportLoading(false); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'quill-ai-data-export.json'; a.click()
      URL.revokeObjectURL(url)
      showToast('Data exported successfully!','success')
    } catch { showToast('Export failed. Try again.','error') }
    setExportLoading(false)
  }

  async function deleteAccount(e:FormEvent) {
    e.preventDefault(); if (!deletePassword) return; setDeleting(true)
    const res = await fetch('/api/gdpr/delete', {
      method:'DELETE', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ confirm:true, password:deletePassword }),
    })
    const data = await res.json()
    setDeleting(false)
    if (!res.ok) { showToast(data.error ?? 'Deletion failed','error'); return }
    setDeleteModal(false); setDeletePassword('')
    const purgeDate = data.scheduledPurgeAt ? new Date(data.scheduledPurgeAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : 'in 30 days'
    showToast(`Deletion scheduled for ${purgeDate}. You can cancel anytime before then.`, 'success')
    fetchAll() // pulls deletion_requested_at/scheduled_purge_at so the banner below shows immediately
  }

  async function cancelDeletion() {
    setCancellingDeletion(true)
    const res = await fetch('/api/gdpr/delete/cancel', { method:'POST' })
    const data = await res.json()
    setCancellingDeletion(false)
    if (!res.ok) { showToast(data.error ?? 'Could not cancel deletion','error'); return }
    showToast('Deletion cancelled — your workspace is safe.','success')
    fetchAll()
  }

  async function connectWordPress(e:FormEvent) {
    e.preventDefault(); setWpSaving(true)
    const res = await fetch('/api/integrations/wordpress/publish', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(wpForm) })
    const data = await res.json(); setWpSaving(false)
    if (!res.ok) { showToast(data.error??'Connection failed','error'); return }
    showToast('WordPress connected!'); track.integrationConnected({ provider:'wordpress' })
    setWpModal(false); setWpForm({ siteUrl:'', username:'', appPassword:'' }); fetchAll()
  }

  async function sendInvite(e:FormEvent) {
    e.preventDefault(); setInviting(true)
    const res = await fetch('/api/workspace/invites', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(inviteForm) })
    const data = await res.json(); setInviting(false)
    if (!res.ok) {
      if (data.error === 'seat_limit_reached') {
        showToast(`Seat limit reached (${data.seats_used}/${data.seats_limit}). Upgrade your plan to add more teammates.`, 'error')
      } else {
        showToast(data.error ?? 'Invite failed', 'error')
      }
      setInviting(false); return
    }
    showToast(`Invitation sent to ${inviteForm.email}!`); track.teamInviteSent({ role:inviteForm.role })
    setInviteModal(false); setInviteForm({ email:'', role:'editor' }); fetchAll()
  }

  async function revokeInvite(id:string) {
    setConfirmLoading(true)
    const res = await fetch('/api/workspace/invites', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id}) })
    setConfirmLoading(false)
    setPendingConfirm(null)
    if (res.ok) { showToast('Invite revoked'); setPendingInvites(p=>p.filter(i=>i.id!==id)) }
    else showToast('Failed to revoke','error')
  }

  async function joinWaitlist() {
    if (!waitlistEmail) return
    const { error } = await supabase.from('waitlist').insert({ email: waitlistEmail, provider: waitlistModal })
    if (error && error.code !== '23505') {
      console.error('[joinWaitlist] insert failed:', error.message)
    }
    showToast(`You're on the ${waitlistModal} waitlist!`)
    setWaitlistModal(null); setWaitlistEmail('')
  }

  const getInt = (p:string) => integrations.find(i=>i.provider===p)

  async function createWebhook() {
    if (!webhookUrl.trim()) return
    setWebhookLoading(true)
    const res  = await fetch('/api/webhooks',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url:webhookUrl.trim(), events:webhookEvents, description:webhookDesc||undefined }) })
    const data = await res.json()
    if (res.ok) {
      setWebhooks(prev=>[data.endpoint,...prev])
      setShowNewSecret(data.secret)
      setWebhookUrl(''); setWebhookEvents([]); setWebhookDesc('')
      showToast('Webhook endpoint created!')
    } else { showToast(data.error??'Failed to create webhook','error') }
    setWebhookLoading(false)
  }

  async function deleteWebhook(id:string) {
    setConfirmLoading(true)
    const res = await fetch(`/api/webhooks?id=${id}`,{ method:'DELETE' })
    setConfirmLoading(false)
    setPendingConfirm(null)
    if (res.ok) {
      setWebhooks(prev=>prev.filter(w=>w.id!==id))
      showToast('Webhook deleted')
    } else {
      showToast('Failed to delete webhook', 'error')
    }
  }

  async function toggleWebhook(id:string, is_active:boolean) {
    await fetch(`/api/webhooks?id=${id}`,{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ is_active }) })
    setWebhooks(prev=>prev.map(w=>w.id===id?{...w,is_active}:w))
  }

  async function saveBranding() {
    setBrandSaving(true)
    const res = await fetch('/api/branding',{ method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ brand_primary_color:brandColor, brand_company_name:brandName||null, white_label_enabled:whiteLabelOn }) })
    const d   = await res.json()
    if (res.ok) showToast('Branding saved!')
    else showToast(d.error??'Failed to save branding','error')
    setBrandSaving(false)
  }

  async function addDomain() {
    if (!newDomain.trim()) return
    setDomainLoading(true)
    const res = await fetch('/api/domains',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ domain:newDomain.trim() }) })
    const d   = await res.json()
    if (res.ok) { setDomainData({ domain:d.domain, status:'pending', verification_txt:d.verificationTxt }); setNewDomain(''); showToast('Domain added — configure DNS to verify') }
    else showToast(d.error??'Failed to add domain','error')
    setDomainLoading(false)
  }

  async function verifyDomain() {
    const res = await fetch('/api/domains?action=verify')
    const d   = await res.json()
    if (res.ok) { setDomainData(d.domain); showToast(d.verified?'Domain verified! SSL is being provisioned.':'DNS not verified yet — check your TXT record.', d.verified?'success':'error') }
  }

  async function removeDomain() {
    setConfirmLoading(true)
    const res = await fetch('/api/domains',{ method:'DELETE' })
    setConfirmLoading(false)
    setPendingConfirm(null)
    if (res.ok) {
      setDomainData(null); showToast('Custom domain removed')
    } else {
      showToast('Failed to remove domain', 'error')
    }
  }
  const usagePct = workspace ? Math.min(100,Math.round((workspace.usage_count/workspace.usage_limit)*100)) : 0
  const storagePct = workspace && workspace.storage_limit_bytes
    ? Math.min(100, Math.round((workspace.storage_used_bytes / workspace.storage_limit_bytes) * 100))
    : 0
  const hasSubscription = !!workspace?.stripe_subscription_id
  const subStatus = workspace?.subscription_status ?? 'trialing'
  const statusStyle = STATUS_LABELS[subStatus] ?? { label: subStatus, color:'#7c7c9a' }
  const planBadge = PLAN_BADGE[workspace?.plan ?? 'starter'] ?? PLAN_BADGE.starter

  if (loading) return <div style={{ padding:'24px', color:'#7c7c9a' }}>Loading settings…</div>

  // Resolves the active pendingConfirm into what the shared ConfirmDialog
  // needs — title/description/action per destructive-action type, plus
  // the correct existing loading flag (kbDeleting / byokRemoving already
  // exist and drive their own per-row disabled states; confirmLoading
  // covers the other three, which didn't have individual loading state
  // before this fix).
  function confirmDialogProps() {
    if (!pendingConfirm) return null
    switch (pendingConfirm.action) {
      case 'kb-delete':
        return {
          title: `Remove "${pendingConfirm.label}"?`,
          description: 'This deletes the document and its indexed chunks from your Knowledge Base. Content generation will no longer be able to reference it. This can\'t be undone.',
          confirmLabel: 'Remove Document',
          loading: kbDeleting === pendingConfirm.id,
          onConfirm: () => deleteKbDocument(pendingConfirm.id),
        }
      case 'byok-remove':
        return {
          title: 'Remove your API key?',
          description: 'Future generations will run on Quill.AI\'s shared platform key and count against your plan\'s credits instead of your own key.',
          confirmLabel: 'Remove Key',
          loading: byokRemoving,
          onConfirm: removeByokKey,
        }
      case 'invite-revoke':
        return {
          title: `Revoke invite for ${pendingConfirm.label}?`,
          description: 'They will no longer be able to use this invite link to join the workspace.',
          confirmLabel: 'Revoke Invite',
          loading: confirmLoading,
          onConfirm: () => revokeInvite(pendingConfirm.id),
        }
      case 'webhook-delete':
        return {
          title: 'Delete this webhook?',
          description: `Quill.AI will stop sending events to ${pendingConfirm.label}. Any external tool relying on this endpoint will stop receiving updates.`,
          confirmLabel: 'Delete Webhook',
          loading: confirmLoading,
          onConfirm: () => deleteWebhook(pendingConfirm.id),
        }
      case 'domain-remove':
        return {
          title: `Remove ${pendingConfirm.label}?`,
          description: 'Your workspace reverts to the default Quill.AI domain for published content and PDF exports. You\'ll need to re-verify DNS if you reconnect this domain later.',
          confirmLabel: 'Remove Domain',
          loading: confirmLoading,
          onConfirm: removeDomain,
        }
    }
  }
  const activeConfirm = confirmDialogProps()

  return (
    <div style={{ padding:'24px', background:'#0f0f13', minHeight:'100%' }}>
      {toast && <Toast {...toast} />}

      {/* ── BILLING SECTION ─────────────────────────────────────────── */}
      <div style={{ marginBottom:'28px' }}>
        <h2 style={{ fontFamily:'Syne, sans-serif', fontSize:'16px', fontWeight:700, marginBottom:'16px' }}>Billing &amp; Subscription</h2>

        {/* Past-due warning */}
        {subStatus === 'past_due' && (
          <div style={{ background:'rgba(240,101,101,0.12)', border:'1px solid rgba(240,101,101,0.3)', borderRadius:'10px', padding:'14px 18px', marginBottom:'16px', display:'flex', alignItems:'center', gap:'12px' }}>
            <span style={{ fontSize:'20px' }}>⚠️</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:'#f06565', fontSize:'14px' }}>Payment failed — update your card</div>
              <div style={{ fontSize:'12px', color:'#7c7c9a', marginTop:'2px' }}>Your subscription is past due. Update your payment method to avoid service interruption.</div>
            </div>
            <button onClick={openBillingPortal} style={{ ...S.btnDanger, whiteSpace:'nowrap' }}>Update Card →</button>
          </div>
        )}

        {/* Current plan card */}
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', marginBottom:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
                  <div style={{ fontFamily:'Syne, sans-serif', fontSize:'18px', fontWeight:800 }}>{workspace?.plan?.charAt(0).toUpperCase()+(workspace?.plan?.slice(1)??'')} Plan</div>
                  <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', background:planBadge.bg, color:planBadge.color }}>
                    {workspace?.plan?.toUpperCase()}
                  </span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'13px', color:'#7c7c9a' }}>
                  <span>Status:</span>
                  <span style={{ fontWeight:600, color:statusStyle.color }}>{statusStyle.label}</span>
                  {workspace?.trial_ends_at && subStatus==='trialing' && (
                    <span style={{ fontSize:'12px', color:'#4a4a65' }}>
                      · Trial ends {new Date(workspace.trial_ends_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              {hasSubscription ? (
                <>
                  <button onClick={openBillingPortal} disabled={billingLoading}
                    style={{ ...S.btnPrimary, opacity:billingLoading?0.7:1 }}>
                    {billingLoading ? '⏳ Opening…' : 'Manage Billing →'}
                  </button>
                  <button onClick={openBillingPortal} disabled={billingLoading}
                    style={{ ...S.btnGhost, fontSize:'12px' }}>
                    View Invoices
                  </button>
                </>
              ) : (
                <button onClick={()=>openUpgradeCheckout(process.env.NEXT_PUBLIC_STRIPE_GROWTH_PRICE_ID!)}
                  disabled={billingLoading}
                  style={{ ...S.btnPrimary, background:'#f5c842', color:'#1a1a0a', opacity:billingLoading?0.7:1 }}>
                  {billingLoading ? '⏳' : '⚡ Upgrade Plan'}
                </button>
              )}
            </div>
          </div>

          {/* Usage bar */}
          <div style={{ marginTop:'16px', paddingTop:'14px', borderTop:'1px solid rgba(42,42,58,0.4)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
              <span style={{ fontSize:'12px', color:'#7c7c9a' }}>Monthly Usage</span>
              <span style={{ fontSize:'12px', fontWeight:600, color:'#f5c842' }}>{workspace?.usage_count}/{workspace?.usage_limit} pieces</span>
            </div>
            <div style={{ height:'6px', background:'#2a2a3a', borderRadius:'99px', overflow:'hidden' }}>
              <div style={{ width:`${usagePct}%`, height:'100%', background:usagePct>=80?'linear-gradient(90deg,#f59e42,#f06565)':'linear-gradient(90deg,#6c63ff,#f5c842)', borderRadius:'99px', transition:'width 1s ease' }}/>
            </div>
          </div>

          {/* Storage usage bar */}
          <div style={{ marginTop:'14px', paddingTop:'14px', borderTop:'1px solid rgba(42,42,58,0.4)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'6px' }}>
              <span style={{ fontSize:'12px', color:'#7c7c9a' }}>Storage</span>
              <span style={{ fontSize:'12px', fontWeight:600, color:'#f5c842' }}>
                {workspace ? `${formatBytes(workspace.storage_used_bytes)} / ${formatBytes(workspace.storage_limit_bytes)}` : '…'}
              </span>
            </div>
            <div style={{ height:'6px', background:'#2a2a3a', borderRadius:'99px', overflow:'hidden' }}>
              <div style={{ width:`${storagePct}%`, height:'100%', background:storagePct>=80?'linear-gradient(90deg,#f59e42,#f06565)':'linear-gradient(90deg,#6c63ff,#f5c842)', borderRadius:'99px', transition:'width 1s ease' }}/>
            </div>
            {storagePct>=80 && (
              <div style={{ fontSize:'10px', color:'#f59e42', marginTop:'6px' }}>
                Running low on storage — delete unused assets in the Asset Library, or upgrade your plan.
              </div>
            )}
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'16px' }}>
          {[
            { name:'Starter', price:'$299', features:['120 credits/month','1 seat','Blog, social & repurposing','Basic analytics'], key:'starter', priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID },
            { name:'Growth',  price:'$599', features:['400 credits/month','5 seats','Full analytics','Header image generation'], key:'growth', popular:true, priceId: process.env.NEXT_PUBLIC_STRIPE_GROWTH_PRICE_ID },
            { name:'Agency',  price:'$1,299', features:['2,000 credits/month','20 seats','White-label branding','Custom domain'], key:'agency', priceId: process.env.NEXT_PUBLIC_STRIPE_AGENCY_PRICE_ID },
          ].map(plan => {
            const isCurrent = workspace?.plan === plan.key
            return (
              <div key={plan.key} style={{ background:'#1e1e28', border:isCurrent?'1px solid #6c63ff':'1px solid #2a2a3a', borderRadius:'12px', padding:'16px', textAlign:'center', position:'relative', boxShadow:isCurrent?'0 0 16px rgba(108,99,255,0.2)':'none' }}>
                {plan.popular && <div style={{ position:'absolute', top:'-9px', left:'50%', transform:'translateX(-50%)', background:'#f5c842', color:'#1a1a0a', fontSize:'9px', fontWeight:800, padding:'2px 10px', borderRadius:'20px', letterSpacing:'0.1em' }}>POPULAR</div>}
                <div style={{ fontFamily:'Syne, sans-serif', fontSize:'15px', fontWeight:800, marginBottom:'2px' }}>{plan.name}</div>
                <div style={{ fontFamily:'Syne, sans-serif', fontSize:'24px', fontWeight:800, color:'#6c63ff', margin:'6px 0' }}>
                  {plan.price}<span style={{ fontSize:'12px', fontWeight:400, color:'#7c7c9a' }}>/mo</span>
                </div>
                <div style={{ fontSize:'11px', lineHeight:1.9, color:'#7c7c9a', textAlign:'left', marginBottom:'12px' }}>
                  {plan.features.map(f=><div key={f}>✓ {f}</div>)}
                </div>
                <button
                  disabled={isCurrent}
                  onClick={()=> {
                    if (plan.priceId) openUpgradeCheckout(plan.priceId as string)
                    else showToast('Plan pricing is not configured yet — contact support.','error')
                  }}
                  style={{ ...S.btnPrimary, width:'100%', fontSize:'12px', padding:'7px', background:isCurrent?'#2a2a3a':plan.key==='agency'?'#f5c842':'#6c63ff', color:plan.key==='agency'?'#1a1a0a':'#fff', opacity:isCurrent?0.5:1, cursor:isCurrent?'default':'pointer' }}>
                  {isCurrent ? 'Current Plan' : plan.key==='agency' ? 'Contact Sales' : 'Upgrade'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── MAIN 2-COL GRID ─────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>

        {/* LEFT */}
        <div>
          {/* Brand Profile */}
          <div style={S.card}>
            <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'16px' }}>Brand Profile</div>
            <form onSubmit={saveBrand}>
              <div style={{ marginBottom:'14px' }}>
                <label style={S.label}>Company Name</label>
                <input value={brandForm.name} onChange={e=>setBrandForm(p=>({...p,name:e.target.value}))} style={S.input} onFocus={e=>(e.target.style.borderColor='#6c63ff')} onBlur={e=>(e.target.style.borderColor='#2a2a3a')}/>
              </div>
              <div style={{ marginBottom:'16px' }}>
                <label style={S.label}>Industry</label>
                <select value={brandForm.industry} onChange={e=>setBrandForm(p=>({...p,industry:e.target.value}))} style={S.select}>
                  {['Tech & SaaS','Healthcare','Finance','E-commerce','Legal','Real Estate','Other'].map(i=><option key={i}>{i}</option>)}
                </select>
              </div>

              {/* ── Brand Knowledge Base ─────────────────────────────── */}
              <div style={{ marginBottom:'16px' }}>
                <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'15px', marginBottom:'4px' }}>
                  Brand Knowledge Base
                </div>
                <div style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'16px', lineHeight:1.55 }}>
                  The more you fill in here, the better every generated piece matches your brand.
                  This context is injected into every generation automatically.
                </div>

                {/* Products / Services */}
                <div style={{ marginBottom:'16px' }}>
                  <div style={{ fontSize:'12px', fontWeight:600, color:'#7c7c9a', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'8px' }}>
                    Products / Services
                  </div>
                  {bk.products.map((p, i) => (
                    <div key={i} style={{ background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'12px', marginBottom:'8px' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'6px' }}>
                        <input
                          placeholder="Product name"
                          value={p.name}
                          onChange={e => {
                            const updated = [...bk.products]
                            updated[i] = { ...updated[i], name: e.target.value }
                            setBk(prev => ({ ...prev, products: updated }))
                          }}
                          style={S.input}
                          onFocus={e=>(e.target.style.borderColor='#6c63ff')}
                          onBlur={e=>(e.target.style.borderColor='#2a2a3a')}
                        />
                        <input
                          placeholder="One-line description"
                          value={p.description}
                          onChange={e => {
                            const updated = [...bk.products]
                            updated[i] = { ...updated[i], description: e.target.value }
                            setBk(prev => ({ ...prev, products: updated }))
                          }}
                          style={S.input}
                          onFocus={e=>(e.target.style.borderColor='#6c63ff')}
                          onBlur={e=>(e.target.style.borderColor='#2a2a3a')}
                        />
                      </div>
                      <input
                        placeholder="Key differentiators (what makes it unique)"
                        value={p.differentiators}
                        onChange={e => {
                          const updated = [...bk.products]
                          updated[i] = { ...updated[i], differentiators: e.target.value }
                          setBk(prev => ({ ...prev, products: updated }))
                        }}
                        style={{ ...S.input, width:'100%' }}
                        onFocus={e=>(e.target.style.borderColor='#6c63ff')}
                        onBlur={e=>(e.target.style.borderColor='#2a2a3a')}
                      />
                      {bk.products.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setBk(prev => ({ ...prev, products: prev.products.filter((_,j) => j !== i) }))}
                          style={{ marginTop:'6px', background:'transparent', border:'none', color:'#f06565', fontSize:'11px', cursor:'pointer', padding:0 }}
                        >
                          ✕ Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBk(prev => ({ ...prev, products: [...prev.products, { name:'', description:'', differentiators:'' }] }))}
                    style={{ fontSize:'12px', color:'#6c63ff', background:'transparent', border:'1px dashed rgba(108,99,255,0.3)', borderRadius:'6px', padding:'6px 12px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}
                  >
                    + Add product
                  </button>
                </div>

                {/* Competitors to avoid */}
                <div style={{ marginBottom:'16px' }}>
                  <div style={{ fontSize:'12px', fontWeight:600, color:'#7c7c9a', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'8px' }}>
                    Competitors to Avoid Mentioning
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'6px' }}>
                    {bk.competitors.map((c, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                        <input
                          placeholder="Competitor name"
                          value={c}
                          onChange={e => {
                            const updated = [...bk.competitors]
                            updated[i] = e.target.value
                            setBk(prev => ({ ...prev, competitors: updated }))
                          }}
                          style={{ ...S.input, width:'160px' }}
                          onFocus={e=>(e.target.style.borderColor='#6c63ff')}
                          onBlur={e=>(e.target.style.borderColor='#2a2a3a')}
                        />
                        {bk.competitors.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setBk(prev => ({ ...prev, competitors: prev.competitors.filter((_,j) => j!==i) }))}
                            style={{ background:'transparent', border:'none', color:'#f06565', cursor:'pointer', fontSize:'13px', padding:'0 4px' }}
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBk(prev => ({ ...prev, competitors: [...prev.competitors, ''] }))}
                    style={{ fontSize:'12px', color:'#6c63ff', background:'transparent', border:'1px dashed rgba(108,99,255,0.3)', borderRadius:'6px', padding:'6px 12px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}
                  >
                    + Add competitor
                  </button>
                </div>

                {/* Approved tone examples */}
                <div style={{ marginBottom:'16px' }}>
                  <div style={{ fontSize:'12px', fontWeight:600, color:'#7c7c9a', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'4px' }}>
                    Approved Tone Examples
                  </div>
                  <div style={{ fontSize:'11px', color:'#4a4a65', marginBottom:'8px' }}>
                    Paste up to 3 examples of copy that perfectly represents your brand voice.
                    The AI uses these as style references.
                  </div>
                  {bk.toneExamples.map((ex, i) => (
                    <textarea
                      key={i}
                      placeholder={`Example ${i+1} — paste a paragraph of approved copy`}
                      value={ex}
                      rows={3}
                      onChange={e => {
                        const updated = [...bk.toneExamples]
                        updated[i] = e.target.value
                        setBk(prev => ({ ...prev, toneExamples: updated }))
                      }}
                      style={{ ...S.textarea, marginBottom:'6px', lineHeight:1.5 }}
                      onFocus={e=>(e.target.style.borderColor='#6c63ff')}
                      onBlur={e=>(e.target.style.borderColor='#2a2a3a')}
                    />
                  ))}
                </div>

                {/* Banned phrases */}
                <div style={{ marginBottom:'8px' }}>
                  <div style={{ fontSize:'12px', fontWeight:600, color:'#7c7c9a', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'4px' }}>
                    Banned Phrases
                  </div>
                  <div style={{ fontSize:'11px', color:'#4a4a65', marginBottom:'8px' }}>
                    Words or phrases the AI should never use (clichés, legal restrictions, competitor brand names).
                  </div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'6px' }}>
                    {bk.bannedPhrases.map((ph, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                        <input
                          placeholder="banned phrase"
                          value={ph}
                          onChange={e => {
                            const updated = [...bk.bannedPhrases]
                            updated[i] = e.target.value
                            setBk(prev => ({ ...prev, bannedPhrases: updated }))
                          }}
                          style={{ ...S.input, width:'140px' }}
                          onFocus={e=>(e.target.style.borderColor='#6c63ff')}
                          onBlur={e=>(e.target.style.borderColor='#2a2a3a')}
                        />
                        {bk.bannedPhrases.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setBk(prev => ({ ...prev, bannedPhrases: prev.bannedPhrases.filter((_,j) => j!==i) }))}
                            style={{ background:'transparent', border:'none', color:'#f06565', cursor:'pointer', fontSize:'13px', padding:'0 4px' }}
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBk(prev => ({ ...prev, bannedPhrases: [...prev.bannedPhrases, ''] }))}
                    style={{ fontSize:'12px', color:'#6c63ff', background:'transparent', border:'1px dashed rgba(108,99,255,0.3)', borderRadius:'6px', padding:'6px 12px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}
                  >
                    + Add phrase
                  </button>
                </div>
              </div>
              <button type="submit" disabled={saving} style={{...S.btnPrimary,width:'100%'}}>{saving?'Saving…':'Save Brand Profile'}</button>
            </form>
          </div>

          {/* Team Members */}
          <div style={S.card}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
              <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a' }}>Team Members</div>
              <button onClick={()=>setInviteModal(true)} style={{ background:'rgba(108,99,255,0.12)', color:'#6c63ff', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'6px', padding:'5px 10px', fontSize:'11px', fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' }}>+ Invite</button>
            </div>
            {/* Seat usage bar */}
            <div className='seat-progress-row' style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px' }}>
              <span style={{ fontSize:'12px', color:'#7c7c9a', whiteSpace:'nowrap' }}>
                {seatsUsed} of {seatLimit} seat{seatLimit!==1?'s':''} used
              </span>
              <div style={{ flex:1, height:'4px', background:'#2a2a3a', borderRadius:'99px', overflow:'hidden' }}>
                <div style={{
                  height:'100%',
                  width:`${seatLimit>0?Math.min(100,Math.round(seatsUsed/seatLimit*100)):100}%`,
                  background: seatsUsed>=seatLimit ? '#f06565' : seatsUsed/seatLimit>=0.8 ? '#f59e42' : '#6c63ff',
                  borderRadius:'99px', transition:'width 0.4s ease',
                }}/>
              </div>
              {seatsUsed >= seatLimit && (
                <span style={{ fontSize:'11px', color:'#f06565', whiteSpace:'nowrap' }}>Limit reached</span>
              )}
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Member','Role','Status'].map(h=><th key={h} style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', padding:'8px 10px', borderBottom:'1px solid #2a2a3a', textAlign:'left' }}>{h}</th>)}</tr></thead>
              <tbody>
                {members.map((m,i)=>(
                  <tr key={i}>
                    <td style={{ padding:'10px', fontSize:'13px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>
                      <div style={{ display:'inline-flex', alignItems:'center', gap:'8px' }}>
                        <div style={{ width:'26px', height:'26px', borderRadius:'50%', background:'linear-gradient(135deg,#6c63ff,#f5c842)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:700, color:'#fff' }}>{m.user_id.substring(0,2).toUpperCase()}</div>
                        <span style={{ textTransform:'capitalize' }}>{m.role==='owner'?'You (Owner)':m.role}</span>
                      </div>
                    </td>
                    <td style={{ padding:'10px', fontSize:'12px', color:'#7c7c9a', borderBottom:'1px solid rgba(42,42,58,0.5)', textTransform:'capitalize' }}>{m.role}</td>
                    <td style={{ padding:'10px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>
                      <span style={{ padding:'2px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:m.status==='active'?'rgba(62,207,142,0.15)':'rgba(245,200,66,0.15)', color:m.status==='active'?'#3ecf8e':'#f5c842' }}>{m.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pendingInvites.length>0 && (
              <div style={{ marginTop:'14px', paddingTop:'12px', borderTop:'1px solid rgba(42,42,58,0.4)' }}>
                <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'8px' }}>Pending Invites</div>
                {pendingInvites.map(inv=>(
                  <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', background:'rgba(245,200,66,0.05)', border:'1px solid rgba(245,200,66,0.15)', borderRadius:'8px', marginBottom:'6px' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:'12px', fontWeight:500 }}>{inv.email}</div>
                      <div style={{ fontSize:'10px', color:'#7c7c9a', textTransform:'capitalize' }}>{inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                    </div>
                    <button onClick={()=>setPendingConfirm({ action: 'invite-revoke', id: inv.id, label: inv.email })} style={{ background:'rgba(240,101,101,0.1)', color:'#f06565', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'5px', padding:'3px 8px', fontSize:'10px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Privacy & Data */}
          <div style={S.card}>
            <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'16px' }}>Privacy &amp; Data</div>
            <p style={{ fontSize:'13px', color:'#7c7c9a', lineHeight:1.6, marginBottom:'16px' }}>
              Download a copy of your workspace data, or request deletion. GDPR / DPDP Act 2023 compliant.
            </p>

            {/* Export */}
            <div style={{ padding:'16px', background:'#0f0f13', borderRadius:'8px', border:'1px solid #2a2a3a', marginBottom:'12px' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, marginBottom:'4px' }}>📦 Export My Data</div>
              <div style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'12px', lineHeight:1.5 }}>
                Download all your content, calendar events, and workspace data as a JSON file.
              </div>
              <button onClick={exportData} disabled={exportLoading} style={{ ...S.btnPrimary, fontSize:'12px', opacity:exportLoading?0.7:1 }}>
                {exportLoading ? '⏳ Exporting…' : '⬇ Download My Data'}
              </button>
            </div>

            {/* Delete */}
            {workspace?.deletion_requested_at ? (
              <div style={{ padding:'16px', background:'rgba(240,101,101,0.05)', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'8px' }}>
                <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, color:'#f06565', marginBottom:'4px' }}>⏳ Deletion Scheduled</div>
                <div style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'12px', lineHeight:1.5 }}>
                  This workspace and all its content will be permanently deleted on{' '}
                  {workspace.scheduled_purge_at ? new Date(workspace.scheduled_purge_at).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : 'the scheduled date'}.
                  You can cancel anytime before then.
                </div>
                {myRole==='owner' ? (
                  <button onClick={cancelDeletion} disabled={cancellingDeletion} style={{ ...S.btnPrimary, fontSize:'12px', opacity:cancellingDeletion?0.7:1 }}>
                    {cancellingDeletion ? '⏳ Cancelling…' : 'Cancel Deletion'}
                  </button>
                ) : (
                  <div style={{ fontSize:'12px', color:'#7c7c9a' }}>Only the workspace owner can cancel this.</div>
                )}
              </div>
            ) : (
              <div style={{ padding:'16px', background:'rgba(240,101,101,0.05)', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'8px' }}>
                <div style={{ fontFamily:'Syne, sans-serif', fontSize:'14px', fontWeight:700, color:'#f06565', marginBottom:'4px' }}>⚠️ Delete This Workspace</div>
                <div style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'12px', lineHeight:1.5 }}>
                  Schedules this workspace and all its content for permanent deletion after a 30-day grace period —
                  cancel anytime before then. Requires an already-cancelled subscription and owner access.
                </div>
                {myRole==='owner' ? (
                  <button onClick={()=>setDeleteModal(true)} style={S.btnDanger}>Delete Workspace…</button>
                ) : (
                  <div style={{ fontSize:'12px', color:'#7c7c9a' }}>Only the workspace owner can request deletion.</div>
                )}
              </div>
            )}
          </div>
        </div>


        {/* RIGHT */}
        <div>
          {/* BYOK — Bring Your Own AI Provider Key */}
          <div style={S.card}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
              <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a' }}>AI Provider API Key</div>
              {byokStatus?.useOwnKey && (
                <span style={{ fontSize:'10px', fontWeight:700, color:'#3ecf8e', background:'rgba(62,207,142,0.12)', borderRadius:'4px', padding:'2px 8px', letterSpacing:'0.04em' }}>
                  ACTIVE — YOUR KEY
                </span>
              )}
            </div>
            <p style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'14px', lineHeight:1.5 }}>
              Optional. Connect your own API key — Anthropic, OpenAI, Google Gemini, NVIDIA NIM, Groq, or any other OpenAI-compatible endpoint — to run content generation on your own account instead of Quill.AI&rsquo;s. Generations on your key don&rsquo;t use your plan&rsquo;s credits.
            </p>

            {byokStatus?.lastError && (
              <div style={{ background:'rgba(240,101,101,0.08)', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px', fontSize:'12px', color:'#f06565', lineHeight:1.5 }}>
                Your key stopped working{byokStatus.lastErrorAt ? ` on ${new Date(byokStatus.lastErrorAt).toLocaleDateString()}` : ''}: {byokStatus.lastError}.
                Generations are currently falling back to the platform key.
              </div>
            )}

            {myRole !== 'owner' ? (
              <div style={{ fontSize:'12px', color:'#7c7c9a' }}>
                {byokStatus?.configured
                  ? 'A BYOK key is configured for this workspace. Only the owner can change it.'
                  : 'Only the workspace owner can configure a BYOK API key.'}
              </div>
            ) : byokStatus?.configured ? (
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:'10px', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'10px 12px', marginBottom:'12px' }}>
                  <span style={{ fontSize:'16px' }}>🔑</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:'13px', fontWeight:600 }}>
                      {BYOK_PRESETS.find(p => p.dbProvider === byokStatus.provider && (p.dbProvider === 'anthropic' || p.baseUrl === byokStatus.baseUrl))?.label
                        ?? (byokStatus.provider === 'anthropic' ? 'Anthropic (Claude)' : 'Custom (OpenAI-compatible)')}
                      {' — '}{byokStatus.model}
                    </div>
                    <div style={{ fontSize:'11px', color:'#7c7c9a' }}>
                      {byokStatus.addedAt ? `Added ${new Date(byokStatus.addedAt).toLocaleDateString()}` : 'Key connected'}
                      {byokStatus.baseUrl ? ` · ${byokStatus.baseUrl}` : ''}
                    </div>
                  </div>
                </div>
                <button onClick={() => setPendingConfirm({ action: 'byok-remove' })} disabled={byokRemoving} style={{ ...S.btnDanger, opacity: byokRemoving ? 0.6 : 1 }}>
                  {byokRemoving ? 'Removing…' : 'Remove key & revert to platform key'}
                </button>
              </div>
            ) : byokShowInput ? (
              <div>
                <select
                  value={byokPresetKey}
                  onChange={e => {
                    const key = e.target.value
                    setByokPresetKey(key)
                    const preset = BYOK_PRESETS.find(p => p.key === key)
                    setByokBaseUrl(preset?.baseUrl ?? '')
                  }}
                  style={{ ...S.select, marginBottom:'10px' }}
                >
                  {BYOK_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>

                {BYOK_PRESETS.find(p => p.key === byokPresetKey)?.dbProvider === 'openai_compatible' && (
                  <input
                    type="text"
                    value={byokBaseUrl}
                    onChange={e => setByokBaseUrl(e.target.value)}
                    placeholder="Base URL, e.g. https://api.openai.com/v1"
                    style={{ ...S.input, marginBottom:'10px' }}
                    onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')}
                  />
                )}

                <input
                  type="text"
                  value={byokModel}
                  onChange={e => setByokModel(e.target.value)}
                  placeholder={`Model, e.g. ${BYOK_PRESETS.find(p => p.key === byokPresetKey)?.modelPlaceholder ?? 'model-name'}`}
                  style={{ ...S.input, marginBottom:'10px' }}
                  onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')}
                />

                <input
                  type="password"
                  value={byokKeyInput}
                  onChange={e => setByokKeyInput(e.target.value)}
                  placeholder={BYOK_PRESETS.find(p => p.key === byokPresetKey)?.keyPlaceholder ?? 'API key'}
                  style={{ ...S.input, marginBottom:'10px' }}
                  onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')}
                />

                <div style={{ display:'flex', gap:'8px' }}>
                  <button
                    onClick={saveByokKey}
                    disabled={
                      byokSaving || !byokKeyInput.trim() || !byokModel.trim() ||
                      (BYOK_PRESETS.find(p => p.key === byokPresetKey)?.dbProvider === 'openai_compatible' && !byokBaseUrl.trim())
                    }
                    style={{ ...S.btnPrimary, flex:1, opacity: byokSaving ? 0.6 : 1 }}
                  >
                    {byokSaving ? 'Validating…' : 'Connect key'}
                  </button>
                  <button onClick={() => { setByokShowInput(false); setByokKeyInput(''); setByokBaseUrl(''); setByokModel('') }} style={S.btnGhost}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setByokShowInput(true)} style={S.btnGhost}>+ Connect your own API key</button>
            )}
          </div>

          {/* AI Knowledge Base */}
          <div style={S.card}>
            <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'6px' }}>Knowledge Base</div>
            <p style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'14px', lineHeight:1.5 }}>
              Upload brand guidelines, product docs, or case studies (PDF, DOCX, TXT — up to 20MB). Quill.AI retrieves relevant excerpts automatically when generating content, so it writes using your actual company knowledge.
            </p>

            <input
              ref={kbFileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadKbFile(f); e.target.value = '' }}
            />
            <button
              onClick={() => kbFileInputRef.current?.click()}
              disabled={kbUploading}
              style={{ ...S.btnGhost, marginBottom: kbDocuments.length > 0 ? '14px' : 0, opacity: kbUploading ? 0.6 : 1 }}
            >
              {kbUploading ? 'Uploading…' : '+ Upload document'}
            </button>

            {kbDocuments.map(doc => (
              <div key={doc.id} style={{ marginBottom:'8px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius: doc.flagged_content ? '8px 8px 0 0' : '8px' }}>
                  <span style={{ fontSize:'16px', flexShrink:0 }}>
                    {doc.file_type === 'pdf' ? '📄' : doc.file_type === 'docx' ? '📝' : '📃'}
                  </span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:'13px', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.filename}</div>
                    <div style={{ fontSize:'11px', color:'#7c7c9a' }}>
                      {fmtFileSize(doc.file_size_bytes)}
                      {doc.status === 'ready' && ` · ${doc.chunk_count} chunk${doc.chunk_count === 1 ? '' : 's'} indexed`}
                      {doc.status === 'ready' && doc.scan_status === 'clean' && ` · ✓ scanned, clean`}
                      {doc.status === 'failed' && doc.error_message && ` · ${doc.error_message}`}
                    </div>
                  </div>
                  {doc.status === 'processing' && (
                    <span style={{ fontSize:'10px', fontWeight:700, color:'#f5c842', background:'rgba(245,200,66,0.12)', borderRadius:'20px', padding:'3px 10px', textTransform:'uppercase', letterSpacing:'0.04em', flexShrink:0 }}>Processing</span>
                  )}
                  {doc.status === 'ready' && (
                    <span style={{ fontSize:'10px', fontWeight:700, color:'#3ecf8e', background:'rgba(62,207,142,0.12)', borderRadius:'20px', padding:'3px 10px', textTransform:'uppercase', letterSpacing:'0.04em', flexShrink:0 }}>Ready</span>
                  )}
                  {doc.status === 'failed' && (
                    <span style={{ fontSize:'10px', fontWeight:700, color:'#f06565', background:'rgba(240,101,101,0.12)', borderRadius:'20px', padding:'3px 10px', textTransform:'uppercase', letterSpacing:'0.04em', flexShrink:0 }}>Failed</span>
                  )}
                  <button
                    onClick={() => setPendingConfirm({ action: 'kb-delete', id: doc.id, label: doc.filename })}
                    disabled={kbDeleting === doc.id}
                    title="Remove document"
                    style={{ flexShrink:0, background:'transparent', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'13px', padding:'4px' }}
                  >
                    {kbDeleting === doc.id ? '⏳' : '✕'}
                  </button>
                </div>
                {doc.flagged_content && (
                  <div style={{ fontSize:'11px', color:'#f5c842', background:'rgba(245,200,66,0.08)', border:'1px solid rgba(245,200,66,0.25)', borderTop:'none', borderRadius:'0 0 8px 8px', padding:'8px 12px', lineHeight:1.5 }}>
                    ⚠ This document&rsquo;s text matched pattern(s) sometimes seen in prompt-injection attempts
                    {doc.flagged_reasons && doc.flagged_reasons.length > 0 ? ` (${doc.flagged_reasons.join(', ')})` : ''}.
                    It&rsquo;s still indexed and used normally — this is a heads-up to review the source, not an automatic block. Legitimate documents (e.g. security training material) can trigger this too.
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Approval Workflow */}
          <div style={S.card}>
            <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'6px' }}>Approval Workflow</div>
            <p style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'14px', lineHeight:1.5 }}>
              Optional. Define an ordered chain of review stages (e.g. Writer → Editor → Brand → Legal → Marketing Head) that content must pass through before it&rsquo;s approved. Leave empty to keep the simple single-review flow.
            </p>

            {myRole !== 'owner' && myRole !== 'admin' ? (
              <div style={{ fontSize:'12px', color:'#7c7c9a' }}>
                {stageDrafts.length > 0 ? `A ${stageDrafts.length}-stage approval chain is configured. Only owners and admins can change it.` : 'Only owners and admins can configure an approval workflow.'}
              </div>
            ) : (
              <>
                {stageDrafts.map((stage, i) => (
                  <div key={i} style={{ display:'flex', gap:'6px', alignItems:'center', marginBottom:'8px' }}>
                    <span style={{ fontSize:'11px', color:'#7c7c9a', width:'18px', flexShrink:0 }}>{i + 1}.</span>
                    <input
                      value={stage.name} onChange={e => updateStage(i, { name: e.target.value })}
                      placeholder="Stage name, e.g. Legal Review"
                      style={{ flex:1, background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'6px', padding:'7px 10px', color:'#e8e8f0', fontSize:'12px', fontFamily:'Inter, sans-serif', outline:'none' }}
                      onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')}
                    />
                    <select
                      value={stage.requiredRole} onChange={e => updateStage(i, { requiredRole: e.target.value as any })}
                      style={{ background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'6px', padding:'7px 6px', color:'#e8e8f0', fontSize:'11px', fontFamily:'Inter, sans-serif', outline:'none' }}
                    >
                      <option value="editor">Editor+</option>
                      <option value="admin">Admin+</option>
                      <option value="owner">Owner only</option>
                    </select>
                    <button onClick={() => moveStage(i, -1)} disabled={i === 0} style={{ background:'transparent', border:'none', color: i === 0 ? '#3a3a4a' : '#7c7c9a', cursor: i === 0 ? 'default' : 'pointer', fontSize:'12px', padding:'4px' }}>↑</button>
                    <button onClick={() => moveStage(i, 1)} disabled={i === stageDrafts.length - 1} style={{ background:'transparent', border:'none', color: i === stageDrafts.length - 1 ? '#3a3a4a' : '#7c7c9a', cursor: i === stageDrafts.length - 1 ? 'default' : 'pointer', fontSize:'12px', padding:'4px' }}>↓</button>
                    <button onClick={() => removeStage(i)} style={{ background:'transparent', border:'none', color:'#f06565', cursor:'pointer', fontSize:'13px', padding:'4px' }}>✕</button>
                  </div>
                ))}

                <button onClick={addStage} style={{ ...S.btnGhost, marginTop: '4px', marginBottom: '14px' }}>+ Add stage</button>

                {stagesDirty && (
                  <button onClick={saveStages} disabled={stagesSaving} style={{ ...S.btnPrimary, width: '100%', opacity: stagesSaving ? 0.7 : 1 }}>
                    {stagesSaving ? 'Saving…' : stageDrafts.length === 0 ? 'Save (disable workflow)' : `Save ${stageDrafts.length}-stage workflow`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Integrations */}
          <div style={S.card}>
            <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'14px' }}>Integrations</div>
            <div className='integrations-grid' style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px' }}>
              {INTEGRATIONS_META.map(meta=>{
                const int = getInt(meta.provider)
                const connected = int?.status==='connected'
                return (
                  <div key={meta.provider} style={{ background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'10px', padding:'14px', textAlign:'center' }}>
                    <div style={{ fontSize:'24px', marginBottom:'6px' }}>{meta.icon}</div>
                    <div style={{ fontSize:'12px', fontWeight:600, marginBottom:'4px' }}>{meta.name}</div>
                    {meta.desc && <div style={{ fontSize:'10px', color:'#7c7c9a', marginBottom:'8px', lineHeight:1.4 }}>{meta.desc}</div>}
                    {connected?(
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px', alignItems:'center' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:'4px', padding:'3px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:700, background:'rgba(62,207,142,0.15)', color:'#3ecf8e' }}>● Connected</span>
                        {meta.provider==='wordpress' && Boolean(int?.config?.site_url) && (
                          <div style={{ fontSize:'9px', color:'#7c7c9a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>{String(int.config.site_url).replace('https://','')}</div>
                        )}
                        {meta.provider==='linkedin' && Boolean(int?.config?.encrypted_config) && (
                          <div style={{ fontSize:'9px', color:'#7c7c9a' }}>{meta.note}</div>
                        )}
                        {meta.note && meta.provider!=='linkedin' && (
                          <div style={{ fontSize:'9px', color:'#7c7c9a' }}>{meta.note}</div>
                        )}
                        <button onClick={()=>meta.provider==='wordpress'?setWpModal(true):meta.type==='oauth'?window.location.href=`/api/integrations/${meta.provider}/connect`:showToast('Disconnecting…','info')} style={{ background:'transparent', border:'1px solid #2a2a3a', borderRadius:'5px', color:'#7c7c9a', fontSize:'9px', padding:'2px 6px', cursor:'pointer', fontFamily:'Inter, sans-serif', marginTop:'2px' }}>
                          {meta.provider==='wordpress'?'Reconnect':meta.type==='oauth'?'Reconnect':'Disconnect'}
                        </button>
                      </div>
                    ):(
                      <button onClick={()=>{
                        if (meta.type==='oauth') window.location.href=`/api/integrations/${meta.provider}/connect`
                        else if (meta.type==='form'&&meta.provider==='wordpress') setWpModal(true)
                        else setWaitlistModal(meta.name)
                      }} style={{ background:'transparent', border:'1px solid #2a2a3a', borderRadius:'20px', color:'#7c7c9a', fontSize:'10px', fontWeight:700, padding:'4px 10px', cursor:'pointer', fontFamily:'Inter, sans-serif', display:'inline-flex', alignItems:'center', gap:'4px' }}>
                        ○ Connect
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Notifications */}
          <div style={S.card}>
            <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'#7c7c9a', marginBottom:'14px' }}>Notification Preferences</div>
            {[['Content Generated',true],['Review Required',true],['Performance Reports',false],['Trending Topic Alerts',true],['Usage Limit Warnings',true]].map(([l,d])=>(
              <ToggleRow key={String(l)} label={String(l)} defaultOn={Boolean(d)}/>
            ))}
          </div>
        </div>
      </div>

      {/* WordPress modal */}
      {wpModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(4px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }} onClick={()=>setWpModal(false)}>
          <div style={{ background:'#16161d', border:'1px solid #2a2a3a', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'440px' }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'16px' }}>🔷 Connect WordPress</div>
              <button onClick={()=>setWpModal(false)} style={{ background:'transparent', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'18px' }}>✕</button>
            </div>
            <form onSubmit={connectWordPress}>
              {[{key:'siteUrl',label:'Site URL',placeholder:'https://your-site.com'},{key:'username',label:'WP Username',placeholder:'admin'},{key:'appPassword',label:'Application Password',placeholder:'xxxx xxxx xxxx xxxx'}].map(f=>(
                <div key={f.key} style={{ marginBottom:'14px' }}>
                  <label style={S.label}>{f.label}</label>
                  <input required placeholder={f.placeholder} type={f.key==='appPassword'?'password':'text'} value={wpForm[f.key as keyof typeof wpForm]} onChange={e=>setWpForm(p=>({...p,[f.key]:e.target.value}))} style={S.input} onFocus={e=>(e.target.style.borderColor='#6c63ff')} onBlur={e=>(e.target.style.borderColor='#2a2a3a')}/>
                </div>
              ))}
              <div style={{ fontSize:'11px', color:'#7c7c9a', marginBottom:'16px', lineHeight:1.5 }}>Generate in WP Admin → Users → Profile → Application Passwords</div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button type="submit" disabled={wpSaving} style={{...S.btnPrimary,flex:1}}>{wpSaving?'Connecting…':'Connect WordPress'}</button>
                <button type="button" onClick={()=>setWpModal(false)} style={S.btnGhost}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(4px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }} onClick={()=>setInviteModal(false)}>
          <div style={{ background:'#16161d', border:'1px solid #2a2a3a', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'420px' }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'20px' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'16px' }}>Invite Team Member</div>
              <button onClick={()=>setInviteModal(false)} style={{ background:'transparent', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'18px' }}>✕</button>
            </div>
            <form onSubmit={sendInvite}>
              <div style={{ marginBottom:'16px' }}>
                <label style={S.label}>Email Address</label>
                <input required type="email" placeholder="colleague@company.com" value={inviteForm.email} onChange={e=>setInviteForm(p=>({...p,email:e.target.value}))} style={S.input} onFocus={e=>(e.target.style.borderColor='#6c63ff')} onBlur={e=>(e.target.style.borderColor='#2a2a3a')}/>
              </div>
              <div style={{ marginBottom:'20px' }}>
                <label style={S.label} id="invite-role-label">Role</label>
                <div role="radiogroup" aria-labelledby="invite-role-label">
                {ROLE_OPTIONS.map((r,ri)=>(
                  <div key={r.value} role="radio" aria-checked={inviteForm.role===r.value}
                    tabIndex={inviteForm.role===r.value ? 0 : -1}
                    onClick={()=>setInviteForm(p=>({...p,role:r.value}))}
                    onKeyDown={e=>{
                      if (e.key===' '||e.key==='Enter') { e.preventDefault(); setInviteForm(p=>({...p,role:r.value})) }
                      else if (e.key==='ArrowDown'||e.key==='ArrowRight') {
                        e.preventDefault()
                        const next = ROLE_OPTIONS[(ri+1)%ROLE_OPTIONS.length]
                        setInviteForm(p=>({...p,role:next.value}))
                        ;(e.currentTarget.parentElement?.children[(ri+1)%ROLE_OPTIONS.length] as HTMLElement | undefined)?.focus()
                      } else if (e.key==='ArrowUp'||e.key==='ArrowLeft') {
                        e.preventDefault()
                        const prevIdx = (ri-1+ROLE_OPTIONS.length)%ROLE_OPTIONS.length
                        setInviteForm(p=>({...p,role:ROLE_OPTIONS[prevIdx].value}))
                        ;(e.currentTarget.parentElement?.children[prevIdx] as HTMLElement | undefined)?.focus()
                      }
                    }}
                    style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 12px', borderRadius:'8px', border:`1px solid ${inviteForm.role===r.value?'#6c63ff':'#2a2a3a'}`, background:inviteForm.role===r.value?'rgba(108,99,255,0.1)':'transparent', cursor:'pointer', marginBottom:'6px', transition:'all 0.15s' }}>
                    <div style={{ width:'16px', height:'16px', borderRadius:'50%', border:`2px solid ${inviteForm.role===r.value?'#6c63ff':'#2a2a3a'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {inviteForm.role===r.value && <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#6c63ff' }}/>}
                    </div>
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:600 }}>{r.label}</div>
                      <div style={{ fontSize:'11px', color:'#7c7c9a' }}>{r.desc}</div>
                    </div>
                  </div>
                ))}
                </div>
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button type="submit" disabled={inviting} style={{...S.btnPrimary,flex:1}}>{inviting?'Sending…':'Send Invitation'}</button>
                <button type="button" onClick={()=>setInviteModal(false)} style={S.btnGhost}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Waitlist modal */}
      {waitlistModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(4px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }} onClick={()=>setWaitlistModal(null)}>
          <div style={{ background:'#16161d', border:'1px solid #2a2a3a', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'380px', textAlign:'center' }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:'40px', marginBottom:'12px' }}>🚀</div>
            <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'18px', marginBottom:'8px' }}>{waitlistModal} Integration</div>
            <div style={{ fontSize:'13px', color:'#7c7c9a', marginBottom:'20px' }}>Coming soon — join the waitlist to be first.</div>
            <input type="email" placeholder="your@email.com" value={waitlistEmail} onChange={e=>setWaitlistEmail(e.target.value)} style={{...S.input,marginBottom:'12px'}} onFocus={e=>(e.target.style.borderColor='#6c63ff')} onBlur={e=>(e.target.style.borderColor='#2a2a3a')}/>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={joinWaitlist} style={{...S.btnPrimary,flex:1}}>Join Waitlist</button>
              <button onClick={()=>setWaitlistModal(null)} style={S.btnGhost}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete account modal */}

      {/* ── WEBHOOKS SECTION ──────────────────────────────────────── */}
      <div style={{ marginBottom:'28px' }}>
        <h2 style={{ fontFamily:'Syne, sans-serif', fontSize:'16px', fontWeight:700, marginBottom:'6px' }}>Webhooks</h2>
        <p style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'16px' }}>Send signed event payloads to Zapier, Make.com, Slack, or any HTTP endpoint.</p>

        {/* New webhook secret reveal */}
        {showNewSecret && (
          <div style={{ background:'rgba(62,207,142,0.1)', border:'1px solid rgba(62,207,142,0.3)', borderRadius:'10px', padding:'16px', marginBottom:'16px' }}>
            <div style={{ fontSize:'12px', fontWeight:700, color:'#3ecf8e', marginBottom:'6px' }}>✓ Webhook created — copy your secret now</div>
            <div style={{ fontSize:'11px', color:'#7c7c9a', marginBottom:'8px' }}>This is the only time this secret is shown. Use it to verify the <code style={{ background:'#0f0f13', padding:'1px 4px', borderRadius:'3px' }}>X-Quill-Signature</code> header.</div>
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <code style={{ flex:1, background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'6px', padding:'8px 12px', fontSize:'11px', fontFamily:'monospace', color:'#f5c842', wordBreak:'break-all' }}>{showNewSecret}</code>
              <button onClick={()=>{ navigator.clipboard.writeText(showNewSecret??''); showToast('Secret copied!') }} style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:'6px', padding:'8px 12px', fontSize:'12px', cursor:'pointer', whiteSpace:'nowrap', fontFamily:'Inter,sans-serif' }}>Copy</button>
            </div>
            <button onClick={()=>setShowNewSecret(null)} style={{ marginTop:'10px', background:'none', border:'none', color:'#7c7c9a', fontSize:'11px', cursor:'pointer', fontFamily:'Inter,sans-serif' }}>I&rsquo;ve saved it — dismiss</button>
          </div>
        )}

        {/* Add endpoint form */}
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'18px', marginBottom:'16px' }}>
          <div style={{ fontSize:'12px', fontWeight:600, color:'#9898b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'12px' }}>Add Endpoint</div>
          <input value={webhookUrl} onChange={e=>setWebhookUrl(e.target.value)} placeholder='https://hooks.zapier.com/hooks/catch/...' style={{ width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'7px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter,sans-serif', outline:'none', marginBottom:'10px', boxSizing:'border-box' as any }} />
          <input value={webhookDesc} onChange={e=>setWebhookDesc(e.target.value)} placeholder='Description (optional — e.g. Zapier CRM sync)' style={{ width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'7px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter,sans-serif', outline:'none', marginBottom:'10px', boxSizing:'border-box' as any }} />
          <div style={{ fontSize:'11px', color:'#7c7c9a', marginBottom:'8px' }}>Events to subscribe (leave blank = all events):</div>
          <div className='webhook-events-grid' style={{ display:'flex', flexWrap:'wrap', gap:'10px', marginBottom:'14px' }}>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#c8c8e0', cursor:'pointer' }}>
              <input type='checkbox' checked={webhookEvents.includes('content.generated')} onChange={()=>setWebhookEvents(prev=>prev.includes('content.generated')?prev.filter(x=>x!=='content.generated'):[...prev,'content.generated'])} />content.generated
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#c8c8e0', cursor:'pointer' }}>
              <input type='checkbox' checked={webhookEvents.includes('content.approved')} onChange={()=>setWebhookEvents(prev=>prev.includes('content.approved')?prev.filter(x=>x!=='content.approved'):[...prev,'content.approved'])} />content.approved
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#c8c8e0', cursor:'pointer' }}>
              <input type='checkbox' checked={webhookEvents.includes('content.published')} onChange={()=>setWebhookEvents(prev=>prev.includes('content.published')?prev.filter(x=>x!=='content.published'):[...prev,'content.published'])} />content.published
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'12px', color:'#c8c8e0', cursor:'pointer' }}>
              <input type='checkbox' checked={webhookEvents.includes('usage.limit_warning')} onChange={()=>setWebhookEvents(prev=>prev.includes('usage.limit_warning')?prev.filter(x=>x!=='usage.limit_warning'):[...prev,'usage.limit_warning'])} />usage.limit_warning
            </label>
          </div>
          <button onClick={createWebhook} disabled={webhookLoading||!webhookUrl.trim()} style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:'7px', padding:'9px 20px', fontSize:'13px', fontWeight:600, cursor:webhookLoading||!webhookUrl.trim()?'not-allowed':'pointer', opacity:webhookLoading||!webhookUrl.trim()?0.5:1, fontFamily:'Inter,sans-serif' }}>{webhookLoading?'Creating…':'Add Endpoint'}</button>
        </div>

        {/* Endpoint list */}
        {webhooks.length===0
          ? <div style={{ textAlign:'center', padding:'28px', color:'#7c7c9a', fontSize:'13px', background:'#1e1e28', border:'1px dashed #2a2a3a', borderRadius:'12px' }}>No webhooks yet. Add your first endpoint above.</div>
          : webhooks.map((w:any)=>(
            <div key={w.id} className='webhook-endpoint-row' style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'10px', padding:'14px 16px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:'13px', fontWeight:600, color:'#e8e8f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{w.url}</div>
                <div style={{ fontSize:'11px', color:'#7c7c9a', marginTop:'2px' }}>{w.description||'—'} · {w.events?.length?w.events.join(', '):'All events'}</div>
                {w.last_fired_at && <div style={{ fontSize:'10px', color:'#4a4a65', marginTop:'2px' }}>Last fired: {new Date(w.last_fired_at).toLocaleString()}</div>}
                {w.consecutive_failures > 0 && (
                  <div style={{ fontSize:'11px', color:'#f06565', marginTop:'4px', display:'flex', alignItems:'center', gap:'5px' }} title={w.last_failure_reason ?? undefined}>
                    ⚠ Failing — {w.consecutive_failures} consecutive {w.consecutive_failures === 1 ? 'attempt' : 'attempts'}, last failed {new Date(w.last_failure_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className='webhook-endpoint-actions' style={{ display:'flex', gap:'6px', flexShrink:0 }}>
                <button onClick={()=>toggleWebhook(w.id,!w.is_active)} style={{ background:w.is_active?'rgba(62,207,142,0.1)':'rgba(124,124,154,0.1)', color:w.is_active?'#3ecf8e':'#7c7c9a', border:`1px solid ${w.is_active?'rgba(62,207,142,0.3)':'#2a2a3a'}`, borderRadius:'6px', padding:'5px 10px', fontSize:'11px', cursor:'pointer', fontFamily:'Inter,sans-serif', whiteSpace:'nowrap' }}>{w.is_active?'Active':'Paused'}</button>
                <button onClick={()=>setPendingConfirm({ action: 'webhook-delete', id: w.id, label: w.url })} style={{ background:'rgba(240,101,101,0.08)', color:'#f06565', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'6px', padding:'5px 10px', fontSize:'11px', cursor:'pointer', fontFamily:'Inter,sans-serif' }}>Delete</button>
              </div>
            </div>
          ))
        }
      </div>

      {/* ── BRANDING SECTION (Agency only) ──────────────────────── */}
      {workspace?.plan==='agency' && (
        <div style={{ marginBottom:'28px' }}>
          <h2 style={{ fontFamily:'Syne, sans-serif', fontSize:'16px', fontWeight:700, marginBottom:'6px' }}>Branding <span style={{ fontSize:'11px', fontWeight:600, color:'#f5c842', background:'rgba(245,200,66,0.12)', borderRadius:'4px', padding:'2px 7px', marginLeft:'6px' }}>Agency</span></h2>
          <p style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'16px' }}>White-label Quill.AI for your clients — custom colors, company name, and domain.</p>

          {/* Visual identity */}
          <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px', marginBottom:'14px' }}>
            <div style={{ fontSize:'12px', fontWeight:600, color:'#9898b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'14px' }}>Visual Identity</div>
            <div className='branding-identity-grid' style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px' }}>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:600, color:'#7c7c9a', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'6px' }}>Brand Color</label>
                <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                  <input type='color' value={brandColor} onChange={e=>setBrandColor(e.target.value)} style={{ width:'40px', height:'36px', border:'1px solid #2a2a3a', borderRadius:'6px', cursor:'pointer', background:'none', padding:'2px' }} />
                  <input value={brandColor} onChange={e=>setBrandColor(e.target.value)} style={{ flex:1, background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'7px', padding:'8px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'monospace', outline:'none' }} placeholder='#6c63ff' />
                </div>
              </div>
              <div>
                <label style={{ display:'block', fontSize:'11px', fontWeight:600, color:'#7c7c9a', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'6px' }}>Company Name</label>
                <input value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder='Your Company Name' style={{ width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'7px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter,sans-serif', outline:'none', boxSizing:'border-box' as any }} />
                <div style={{ fontSize:'10px', color:'#4a4a65', marginTop:'4px' }}>Replaces &lsquo;Quill.AI&rsquo; in PDF exports</div>
              </div>
            </div>
            {/* Preview */}
            <div style={{ background:'#0f0f13', borderRadius:'8px', padding:'12px 16px', marginBottom:'14px', display:'flex', alignItems:'center', gap:'10px' }}>
              <div style={{ fontSize:'12px', color:'#7c7c9a' }}>Preview:</div>
              <div style={{ background:brandColor, color:'#fff', borderRadius:'6px', padding:'5px 14px', fontSize:'12px', fontWeight:600 }}>{brandName||'Your Company'}</div>
              <div style={{ width:'60px', height:'4px', background:brandColor, borderRadius:'99px', opacity:0.4 }} />
            </div>
            {/* White-label toggle */}
            <label style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer', marginBottom:'16px' }}>
              <input type='checkbox' checked={whiteLabelOn} onChange={e=>setWhiteLabelOn(e.target.checked)} />
              <div>
                <div style={{ fontSize:'13px', fontWeight:500, color:'#e8e8f0' }}>Enable white-label mode</div>
                <div style={{ fontSize:'11px', color:'#7c7c9a' }}>Apply branding to PDF exports and future UI elements</div>
              </div>
            </label>
            <button onClick={saveBranding} disabled={brandSaving} style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:'8px', padding:'10px 22px', fontSize:'13px', fontWeight:600, cursor:brandSaving?'not-allowed':'pointer', opacity:brandSaving?0.7:1, fontFamily:'Inter,sans-serif' }}>{brandSaving?'Saving…':'Save Branding'}</button>
          </div>

          {/* Custom domain */}
          <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'20px' }}>
            <div style={{ fontSize:'12px', fontWeight:600, color:'#9898b8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'12px' }}>Custom Domain</div>
            {domainData ? (
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px' }}>
                  <span style={{ fontSize:'13px', fontWeight:600, color:'#e8e8f0' }}>{domainData.domain}</span>
                  <span style={{ fontSize:'10px', fontWeight:600, padding:'2px 7px', borderRadius:'4px', background:domainData.status==='active'?'rgba(62,207,142,0.12)':domainData.status==='pending'?'rgba(245,200,66,0.12)':'rgba(240,101,101,0.12)', color:domainData.status==='active'?'#3ecf8e':domainData.status==='pending'?'#f5c842':'#f06565' }}>{domainData.status?.toUpperCase()}</span>
                </div>
                {domainData.status!=='active' && domainData.verification_txt && (
                  <div style={{ background:'#0f0f13', borderRadius:'8px', padding:'12px', marginBottom:'12px' }}>
                    <div style={{ fontSize:'11px', color:'#7c7c9a', marginBottom:'6px' }}>Add this TXT record to your DNS provider:</div>
                    <code style={{ fontSize:'11px', fontFamily:'monospace', color:'#f5c842', wordBreak:'break-all' }}>{domainData.verification_txt}</code>
                  </div>
                )}
                <div style={{ display:'flex', gap:'8px' }}>
                  {domainData.status!=='active' && <button onClick={verifyDomain} style={{ background:'rgba(108,99,255,0.1)', color:'#6c63ff', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'7px', padding:'8px 16px', fontSize:'12px', fontWeight:600, cursor:'pointer', fontFamily:'Inter,sans-serif' }}>Verify DNS</button>}
                  <button onClick={()=>setPendingConfirm({ action: 'domain-remove', label: domainData.domain })} style={{ background:'rgba(240,101,101,0.08)', color:'#f06565', border:'1px solid rgba(240,101,101,0.2)', borderRadius:'7px', padding:'8px 14px', fontSize:'12px', cursor:'pointer', fontFamily:'Inter,sans-serif' }}>Remove</button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize:'12px', color:'#7c7c9a', marginBottom:'12px' }}>Add a custom subdomain (e.g. content.youragency.com). SSL is auto-provisioned by Vercel after DNS verification.</p>
                <div className='domain-input-row' style={{ display:'flex', gap:'8px' }}>
                  <input value={newDomain} onChange={e=>setNewDomain(e.target.value)} placeholder='content.youragency.com' style={{ flex:1, background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'7px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter,sans-serif', outline:'none' }} />
                  <button onClick={addDomain} disabled={domainLoading||!newDomain.trim()} style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:'7px', padding:'9px 18px', fontSize:'13px', fontWeight:600, cursor:domainLoading||!newDomain.trim()?'not-allowed':'pointer', opacity:domainLoading?0.7:1, fontFamily:'Inter,sans-serif' }}>{domainLoading?'Adding…':'Add Domain'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }} onClick={()=>setDeleteModal(false)}>
          <div style={{ background:'#16161d', border:'1px solid rgba(240,101,101,0.4)', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'420px' }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'18px', color:'#f06565', marginBottom:'16px' }}>⚠️ Delete This Workspace</div>
            <p style={{ fontSize:'13px', color:'#7c7c9a', lineHeight:1.6, marginBottom:'16px' }}>
              This schedules the workspace for permanent deletion in 30 days — you can cancel anytime before then.
              After 30 days, this permanently deletes:
            </p>
            <ul style={{ listStyle:'none', padding:0, marginBottom:'12px' }}>
              {['All content pieces, calendar events, and campaigns','All brand assets and knowledge base documents','Your workspace and team data'].map(item=>(
                <li key={item} style={{ fontSize:'13px', color:'#e8e8f0', padding:'4px 0', display:'flex', gap:'8px' }}>
                  <span style={{ color:'#f06565' }}>•</span>{item}
                </li>
              ))}
            </ul>
            <p style={{ fontSize:'12px', color:'#7c7c9a', lineHeight:1.6, marginBottom:'20px' }}>
              If you have an active subscription, cancel it in Billing first — this won&apos;t cancel it for you.
            </p>
            <form onSubmit={deleteAccount}>
              <div style={{ marginBottom:'16px' }}>
                <label style={S.label}>Enter your password to confirm</label>
                <input required type="password" placeholder="Your password" value={deletePassword} onChange={e=>setDeletePassword(e.target.value)} style={S.input} onFocus={e=>(e.target.style.borderColor='#f06565')} onBlur={e=>(e.target.style.borderColor='#2a2a3a')}/>
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button type="submit" disabled={deleting} style={{ ...S.btnDanger, flex:1, opacity:deleting?0.7:1 }}>
                  {deleting ? '⏳ Scheduling…' : 'Schedule Deletion'}
                </button>
                <button type="button" onClick={()=>{ setDeleteModal(false); setDeletePassword('') }} style={S.btnGhost}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <style>{`
        @media (max-width: 768px) {
          .webhook-events-grid { flex-direction: column !important; gap: 8px !important; }
          .webhook-endpoint-row { flex-direction: column !important; align-items: flex-start !important; gap: 8px !important; }
          .webhook-endpoint-actions { align-self: flex-end !important; }
          .webhook-secret-box { overflow-x: auto !important; word-break: break-all !important; }
          .branding-identity-grid { grid-template-columns: 1fr !important; }
          .domain-input-row { flex-direction: column !important; }
          .domain-input-row input, .domain-input-row button { width: 100% !important; }
          .seat-progress-row { flex-wrap: wrap !important; gap: 4px !important; }
          .integrations-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <ConfirmDialog
        isOpen={!!pendingConfirm}
        title={activeConfirm?.title ?? ''}
        description={activeConfirm?.description ?? ''}
        confirmLabel={activeConfirm?.confirmLabel}
        loading={activeConfirm?.loading ?? false}
        onConfirm={() => activeConfirm?.onConfirm()}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f0f13', color:'#7c7c9a', fontFamily:'Inter, sans-serif', fontSize:'14px' }}>
        Loading settings…
      </div>
    }>
      <SettingsPageInner />
    </Suspense>
  )
}
