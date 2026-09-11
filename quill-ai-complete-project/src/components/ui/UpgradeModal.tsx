'use client'

import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// UpgradeModal
//
// Handles two contexts:
//   1. Old format — usage_limit_reached: shows plan comparison
//   2. New format — insufficient_credits: shows credits needed + add-on packs
//
// Add-on packs (one-time purchases via Stripe Checkout):
//   small  → 100 credits / $39
//   medium → 300 credits / $99   ← "Best value"
//   large  → 750 credits / $199
// ─────────────────────────────────────────────────────────────────────────────

interface UpgradeModalProps {
  isOpen:            boolean
  onClose:           () => void
  plan:              string
  // Legacy props (usage_limit_reached)
  used?:             number
  limit?:            number
  // New credit props (insufficient_credits)
  creditsRemaining?: number
  creditsCost?:      number
  creditsMonthly?:   number
}

const PLANS = [
  { id: 'starter', label: 'Starter',  price: '$299/mo', credits: 120,  highlight: false },
  { id: 'growth',  label: 'Growth',   price: '$599/mo', credits: 400,  highlight: true  },
  { id: 'agency',  label: 'Agency',   price: '$1,299/mo',credits: 2000, highlight: false },
]

const ADDON_PACKS = [
  { size: 'small',  label: '100 credits', price: '$39',   note: '',           cpp: '$0.39/credit' },
  { size: 'medium', label: '300 credits', price: '$99',   note: 'Best value', cpp: '$0.33/credit' },
  { size: 'large',  label: '750 credits', price: '$199',  note: '',           cpp: '$0.27/credit' },
]

export default function UpgradeModal({
  isOpen,
  onClose,
  plan,
  used,
  limit,
  creditsRemaining,
  creditsCost,
  creditsMonthly,
}: UpgradeModalProps) {
  const [addonLoading, setAddonLoading] = useState<string | null>(null)
  const [tab,          setTab]          = useState<'topup' | 'upgrade'>('topup')

  const isCreditMode = creditsRemaining !== undefined || creditsCost !== undefined
  const needsCredits = creditsCost ?? 0
  const hasCredits   = creditsRemaining ?? 0

  if (!isOpen) return null

  async function handleBuyAddon(packSize: string) {
    setAddonLoading(packSize)
    try {
      const res = await fetch('/api/stripe/create-addon-checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ packSize }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d.error ?? 'Could not start checkout. Please try again.')
        return
      }
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch {
      alert('Checkout unavailable — please try again.')
    } finally {
      setAddonLoading(null)
    }
  }

  function handleUpgradePlan(planId: string) {
    const priceMap: Record<string, string> = {
      starter: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID ?? '',
      growth:  process.env.NEXT_PUBLIC_STRIPE_GROWTH_PRICE_ID  ?? '',
      agency:  process.env.NEXT_PUBLIC_STRIPE_AGENCY_PRICE_ID  ?? '',
    }
    const priceId = priceMap[planId]
    if (!priceId) {
      window.location.href = '/settings?tab=billing'
      return
    }
    fetch('/api/stripe/create-checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ priceId }),
    })
      .then(r => r.json())
      .then(d => { if (d.url) window.location.href = d.url })
      .catch(() => { window.location.href = '/settings?tab=billing' })
  }

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{ background:'#16161d', border:'1px solid #2a2a3a', borderRadius:'16px', width:'100%', maxWidth:'460px', maxHeight:'90vh', overflow:'auto', boxShadow:'0 32px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding:'24px 24px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:'18px', fontWeight:700, letterSpacing:'-0.02em', marginBottom:'4px' }}>
              {isCreditMode ? '⚡ Not enough credits' : '🚀 Upgrade your plan'}
            </div>
            {isCreditMode && needsCredits > 0 && (
              <div style={{ fontSize:'13px', color:'#7c7c9a', lineHeight:1.5 }}>
                This action needs <strong style={{ color:'#f59e42' }}>{needsCredits} credits</strong>.
                You have <strong style={{ color: hasCredits === 0 ? '#f06565' : '#e8e8f0' }}>{hasCredits}</strong> remaining.
              </div>
            )}
            {!isCreditMode && used !== undefined && limit !== undefined && (
              <div style={{ fontSize:'13px', color:'#7c7c9a' }}>
                You&rsquo;ve used {used} of {limit} pieces this month.
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'20px', lineHeight:1, padding:'0', flexShrink:0 }}>×</button>
        </div>

        {/* Tabs — only show when in credit mode (both options available) */}
        {isCreditMode && (
          <div style={{ display:'flex', gap:'4px', margin:'16px 24px 0', background:'rgba(255,255,255,0.04)', borderRadius:'8px', padding:'3px' }}>
            {[['topup','Top up credits'],['upgrade','Upgrade plan']].map(([t,label]) => (
              <button
                key={t}
                onClick={() => setTab(t as 'topup' | 'upgrade')}
                style={{ flex:1, background: tab===t ? '#6c63ff' : 'none', color: tab===t ? '#fff' : '#7c7c9a', border:'none', borderRadius:'6px', padding:'7px', fontSize:'13px', fontWeight:500, cursor:'pointer', fontFamily:'Inter,sans-serif', transition:'all 0.15s' }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding:'20px 24px 24px' }}>

          {/* ── Top-up tab (credit mode) ────────────────────────────────────── */}
          {(tab === 'topup' || !isCreditMode) && isCreditMode && (
            <div>
              <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'10px' }}>
                One-time credit packs
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px', marginBottom:'16px' }}>
                {ADDON_PACKS.map(pack => (
                  <button
                    key={pack.size}
                    onClick={() => handleBuyAddon(pack.size)}
                    disabled={!!addonLoading}
                    style={{
                      position:'relative', background: pack.note ? 'rgba(108,99,255,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${pack.note ? 'rgba(108,99,255,0.4)' : '#2a2a3a'}`,
                      borderRadius:'10px', padding:'16px 8px 12px', cursor: addonLoading ? 'not-allowed' : 'pointer',
                      fontFamily:'Inter,sans-serif', textAlign:'center', opacity: addonLoading && addonLoading !== pack.size ? 0.5 : 1,
                      transition:'all 0.15s',
                    }}
                  >
                    {pack.note && (
                      <div style={{ position:'absolute', top:'-9px', left:'50%', transform:'translateX(-50%)', background:'#6c63ff', color:'#fff', fontSize:'9px', fontWeight:700, borderRadius:'99px', padding:'2px 8px', whiteSpace:'nowrap', letterSpacing:'0.04em' }}>
                        {pack.note}
                      </div>
                    )}
                    <div style={{ fontSize:'15px', fontWeight:700, color:'#e8e8f0', marginBottom:'2px' }}>
                      {addonLoading === pack.size ? '⏳' : pack.label}
                    </div>
                    <div style={{ fontSize:'16px', fontWeight:700, color:'#6c63ff', marginBottom:'2px' }}>{pack.price}</div>
                    <div style={{ fontSize:'10px', color:'#7c7c9a' }}>{pack.cpp}</div>
                  </button>
                ))}
              </div>
              <div style={{ fontSize:'11px', color:'#4a4a6a', textAlign:'center' }}>
                Credits are added instantly after payment. No subscription required.
              </div>
              <div style={{ marginTop:'14px', paddingTop:'14px', borderTop:'1px solid #2a2a3a', textAlign:'center' }}>
                <button
                  onClick={() => setTab('upgrade')}
                  style={{ background:'none', border:'none', color:'#6c63ff', fontSize:'12px', cursor:'pointer', fontFamily:'Inter,sans-serif' }}
                >
                  Or upgrade your monthly plan for more credits →
                </button>
              </div>
            </div>
          )}

          {/* ── Upgrade plan tab / legacy non-credit mode ──────────────────── */}
          {(tab === 'upgrade' || !isCreditMode) && (
            <div>
              {!isCreditMode && (
                <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'10px' }}>
                  Upgrade plan
                </div>
              )}
              <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginBottom:'16px' }}>
                {PLANS.filter(p => p.id !== plan || !isCreditMode).map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleUpgradePlan(p.id)}
                    style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between',
                      background: p.highlight ? 'rgba(108,99,255,0.1)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${p.highlight ? 'rgba(108,99,255,0.4)' : '#2a2a3a'}`,
                      borderRadius:'10px', padding:'12px 14px', cursor:'pointer',
                      fontFamily:'Inter,sans-serif', textAlign:'left', width:'100%',
                      transition:'all 0.15s',
                    }}
                  >
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'2px' }}>
                        <span style={{ fontSize:'13px', fontWeight:600, color:'#e8e8f0' }}>{p.label}</span>
                        {p.highlight && <span style={{ fontSize:'9px', fontWeight:700, background:'#6c63ff', color:'#fff', borderRadius:'99px', padding:'1px 6px', letterSpacing:'0.04em' }}>POPULAR</span>}
                      </div>
                      <div style={{ fontSize:'12px', color:'#7c7c9a' }}>{p.credits.toLocaleString()} credits/month</div>
                    </div>
                    <div style={{ fontSize:'15px', fontWeight:700, color: p.highlight ? '#6c63ff' : '#e8e8f0' }}>{p.price}</div>
                  </button>
                ))}
              </div>
              <div style={{ fontSize:'11px', color:'#4a4a6a', textAlign:'center' }}>
                14-day free trial · Cancel anytime · Billed monthly
              </div>
              {isCreditMode && (
                <div style={{ marginTop:'14px', paddingTop:'14px', borderTop:'1px solid #2a2a3a', textAlign:'center' }}>
                  <button
                    onClick={() => setTab('topup')}
                    style={{ background:'none', border:'none', color:'#6c63ff', fontSize:'12px', cursor:'pointer', fontFamily:'Inter,sans-serif' }}
                  >
                    ← Or buy a one-time credit pack
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
