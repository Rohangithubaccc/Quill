'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { onCreditsChanged } from '@/lib/credits-events'

interface WorkspaceInfo {
  id:                string
  name:              string
  plan:              string
  usage_count:       number
  usage_limit:       number
  // Credit fields added in migration 012
  credits_remaining: number
  credits_monthly:   number
  logo_url?:         string
  role?:             string
}

const NAV_ITEMS = [
  { href: '/dashboard',   icon: '◉',  label: 'Dashboard'                         },
  { href: '/campaigns',   icon: '🎯', label: 'Campaigns'                          },
  { href: '/assets',      icon: '🖼️', label: 'Assets'                             },
  { href: '/analyzer',    icon: '📊', label: 'Analyze'                            },
  { href: '/generator',   icon: '✦',  label: 'Generate'                           },
  { href: '/calendar',    icon: '📅', label: 'Calendar'                           },
  { href: '/performance', icon: '📈', label: 'Performance'                        },
  { href: '/review',      icon: '✏️', label: 'Review Queue', badge: true          },
  { href: '/settings',    icon: '⚙️', label: 'Settings'                           },
]

const PLAN_COLORS: Record<string, string> = {
  starter: '#7c7c9a', growth: '#6c63ff', agency: '#f5c842', cancelled: '#f06565',
}

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [collapsed,      setCollapsed]      = useState(false)

  // Mount-time only, not a resize listener — this is specifically for
  // "someone opens the app on a phone and the sidebar is instantly
  // unusable," not for fighting a user's manual expand/collapse while
  // they're actively resizing a desktop window. 768px matches the
  // breakpoint every other responsive page in this app already uses
  // (generator, settings, calendar, marketing/try) — this was the one
  // place that breakpoint was never actually applied, which meant those
  // pages' own mobile CSS had barely 768-240=528px (or less, on a real
  // phone) to work with instead of the full viewport.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setCollapsed(true)
    }
  }, [])
  const [currentWs,      setCurrentWs]      = useState<WorkspaceInfo | null>(null)
  const [allWorkspaces,  setAllWorkspaces]  = useState<WorkspaceInfo[]>([])
  const [reviewCount,    setReviewCount]    = useState(0)
  const [showWsSwitcher, setShowWsSwitcher] = useState(false)
  const [switching,      setSwitching]      = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchData()
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowWsSwitcher(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    // Generate/image/bulk-repurpose all live outside this component and
    // have no other way to tell it their action just spent credits — see
    // credits-events.ts for why this exists instead of a shared context.
    const unsubscribe = onCreditsChanged(fetchData)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      unsubscribe()
    }
  }, [])

  async function fetchData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const res = await fetch('/api/workspace/list')
    if (!res.ok) return

    const data = await res.json()
    setAllWorkspaces(data.workspaces ?? [])

    // ── Fetch current workspace with credit fields ──────────────────────────
    // credits_remaining and credits_monthly added to the select (migration 012)
    // Cast to any: this loose Database stub can't resolve Supabase's
    // nested-join type inference for aliased relations like
    // `workspace:workspaces(...)`. Real generated types would resolve
    // this correctly — see src/lib/types/database.ts for details.
    const { data: member } = await (supabase
      .from('workspace_members')
      .select(`
        role,
        workspace:workspaces(
          id, name, plan,
          usage_count, usage_limit,
          credits_remaining, credits_monthly,
          logo_url
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .single() as any)

    if (member?.workspace) {
      const ws = member.workspace as unknown as WorkspaceInfo
      setCurrentWs({ ...ws, role: member.role })

      const { count } = await supabase
        .from('content_pieces')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws.id)
        .eq('status', 'review')
        .is('deleted_at', null)
      setReviewCount(count ?? 0)
    }
  }

  async function switchWorkspace(wsId: string) {
    if (wsId === currentWs?.id) { setShowWsSwitcher(false); return }
    setSwitching(true)
    const res = await fetch('/api/workspace/switch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ workspaceId: wsId }),
    })
    setSwitching(false)
    if (res.ok) {
      setShowWsSwitcher(false)
      router.push('/dashboard')
      router.refresh()
      fetchData()
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // ── Credit calculations ─────────────────────────────────────────────────────
  const creditsRemaining = currentWs?.credits_remaining ?? 0
  const creditsMonthly   = currentWs?.credits_monthly   ?? 1    // avoid div/0
  const creditPct        = Math.min(100, Math.round((creditsRemaining / creditsMonthly) * 100))
  // Colour: green when plenty, amber < 20%, red < 5%
  const creditBarColor   = creditPct <= 5 ? '#f06565' : creditPct <= 20 ? '#f59e42' : '#6c63ff'
  const creditBarGrad    = creditPct <= 5
    ? 'linear-gradient(90deg,#f06565,#f06565)'
    : creditPct <= 20
    ? 'linear-gradient(90deg,#f59e42,#f06565)'
    : 'linear-gradient(90deg,#6c63ff,#f5c842)'

  const w          = collapsed ? '64px' : '240px'
  const wsInitial  = currentWs?.name?.charAt(0).toUpperCase() ?? 'W'

  return (
    <nav style={{
      width: w, minWidth: w, maxWidth: w,
      background: '#16161d', borderRight: '1px solid #2a2a3a',
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.3s cubic-bezier(.4,0,.2,1)',
      flexShrink: 0, zIndex: 100, overflow: 'hidden',
      height: '100vh', position: 'sticky', top: 0,
    }}>

      {/* ── Workspace switcher header ────────────────────────────────── */}
      <div ref={switcherRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setShowWsSwitcher(s => !s)}
          disabled={collapsed}
          aria-label={collapsed ? undefined : `Switch workspace — currently ${currentWs?.name ?? 'Quill.AI'}`}
          aria-expanded={showWsSwitcher}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '16px',
            minHeight: '60px', cursor: collapsed ? 'default' : 'pointer',
            transition: 'background 0.15s',
            background: showWsSwitcher ? 'rgba(108,99,255,0.08)' : 'transparent',
            border: 'none', borderBottom: '1px solid #2a2a3a',
            width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit',
          }}
          onMouseEnter={e => { if (!collapsed) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(108,99,255,0.06)' }}
          onMouseLeave={e => { if (!showWsSwitcher) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >
          <div style={{
            width: '34px', height: '34px', flexShrink: 0,
            background: 'linear-gradient(135deg, #6c63ff, #f5c842)',
            borderRadius: '8px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: collapsed ? '16px' : '18px',
            boxShadow: '0 0 12px rgba(108,99,255,0.3)', fontWeight: 700, color: '#fff',
          }}>{collapsed ? wsInitial : '✦'}</div>

          <div style={{ flex: 1, minWidth: 0, opacity: collapsed ? 0 : 1, transition: 'opacity 0.2s' }}>
            <div style={{
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '15px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: 'linear-gradient(135deg, #fff 40%, #f5c842)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{currentWs?.name ?? 'Quill.AI'}</div>
            <div style={{ fontSize: '10px', color: PLAN_COLORS[currentWs?.plan ?? 'starter'], fontWeight: 600, textTransform: 'capitalize', marginTop: '1px' }}>
              {currentWs?.plan ?? 'starter'} plan
            </div>
          </div>
          {!collapsed && (
            <div style={{ fontSize: '10px', color: '#7c7c9a', flexShrink: 0, transition: 'transform 0.2s', transform: showWsSwitcher ? 'rotate(180deg)' : 'none' }}>▾</div>
          )}
        </button>

        {/* Workspace dropdown */}
        {showWsSwitcher && !collapsed && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            background: '#16161d', border: '1px solid #2a2a3a',
            borderTop: 'none', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#4a4a65' }}>
              Your Workspaces
            </div>
            {allWorkspaces.map(ws => (
              <div
                key={ws.id}
                onClick={() => switchWorkspace(ws.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px', cursor: switching ? 'wait' : 'pointer',
                  background: ws.id === currentWs?.id ? 'rgba(108,99,255,0.1)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (ws.id !== currentWs?.id) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (ws.id !== currentWs?.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{ fontSize: '12px', color: ws.id === currentWs?.id ? '#6c63ff' : '#4a4a65', flexShrink: 0 }}>
                  {ws.id === currentWs?.id ? '●' : '○'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: ws.id === currentWs?.id ? 600 : 400, color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ws.name}
                  </div>
                  <div style={{ fontSize: '10px', color: PLAN_COLORS[ws.plan] ?? '#7c7c9a', textTransform: 'capitalize' }}>
                    {ws.plan} plan
                  </div>
                </div>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #2a2a3a', padding: '4px 0' }}>
              <div
                onClick={() => { setShowWsSwitcher(false); router.push('/signup?new_workspace=1') }}
                style={{ padding: '10px 12px', fontSize: '12px', color: '#6c63ff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(108,99,255,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
              >
                + Create New Workspace
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Nav items ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const badge    = item.badge && reviewCount > 0 ? reviewCount : null
          return (
            <Link key={item.href} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 12px', borderRadius: '8px',
              textDecoration: 'none', whiteSpace: 'nowrap',
              position: 'relative', transition: 'all 0.18s ease',
              color:      isActive ? '#6c63ff' : '#7c7c9a',
              background: isActive ? 'rgba(108,99,255,0.15)' : 'transparent',
              fontWeight: isActive ? 600 : 400,
            }}>
              {isActive && (
                <div style={{ position: 'absolute', left: 0, top: '4px', bottom: '4px', width: '3px', background: '#6c63ff', borderRadius: '0 3px 3px 0' }} />
              )}
              <span style={{ fontSize: '18px', flexShrink: 0, width: '22px', textAlign: 'center' }}>{item.icon}</span>
              <span style={{ fontSize: '13.5px', fontWeight: 500, opacity: collapsed ? 0 : 1, transition: 'opacity 0.2s', pointerEvents: collapsed ? 'none' : 'auto' }}>
                {item.label}
              </span>
              {badge && !collapsed && (
                <span style={{ marginLeft: 'auto', background: '#6c63ff', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', flexShrink: 0 }}>
                  {badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* ── Bottom: credit balance + sign out ───────────────────────── */}
      <div style={{ padding: '12px 8px', borderTop: '1px solid #2a2a3a' }}>
        <div style={{ background: '#1e1e28', borderRadius: '8px', padding: collapsed ? '10px 6px' : '12px', marginBottom: '8px', overflow: 'hidden', transition: 'padding 0.3s' }}>
          {!collapsed ? (
            <>
              {/* Header row: label + credit count */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7c7c9a' }}>
                  Credits
                </span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: creditPct <= 5 ? '#f06565' : creditPct <= 20 ? '#f59e42' : '#f5c842' }}>
                  {currentWs ? creditsRemaining.toLocaleString() : '…'}
                </span>
              </div>

              {/* Progress bar — fills LEFT to RIGHT showing credits remaining */}
              <div style={{ height: '6px', background: '#2a2a3a', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{
                  width:        `${creditPct}%`,
                  height:       '100%',
                  borderRadius: '99px',
                  background:   creditBarGrad,
                  transition:   'width 1s ease',
                }} />
              </div>

              {/* Subtext: "X of Y credits remaining" */}
              <div style={{ fontSize: '10px', color: '#4a4a65', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', display: 'flex', justifyContent: 'space-between' }}>
                <span>{currentWs ? `${creditsRemaining.toLocaleString()} of ${creditsMonthly.toLocaleString()} left` : '…'}</span>
                {creditPct <= 20 && (
                  <Link href="/settings?tab=billing" style={{ color: '#6c63ff', textDecoration: 'none', fontWeight: 600, fontSize: '10px' }}>
                    Top up →
                  </Link>
                )}
              </div>

              {/* Plan label */}
              <div style={{ fontSize: '10px', color: PLAN_COLORS[currentWs?.plan ?? 'starter'], marginTop: '4px', textTransform: 'capitalize', fontWeight: 600 }}>
                {currentWs?.plan ?? '…'} plan
              </div>
            </>
          ) : (
            /* Collapsed: show credit percentage as a number */
            <div style={{ textAlign: 'center', fontSize: '10px', color: creditBarColor, fontWeight: 700 }}>
              {creditPct}%
            </div>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          title="Sign out"
          style={{
            width: '100%', background: 'transparent', border: 'none', color: '#7c7c9a',
            cursor: 'pointer', padding: '8px', borderRadius: '8px', fontSize: '12px',
            fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: '8px',
            transition: 'all 0.18s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(240,101,101,0.1)'; (e.currentTarget as HTMLButtonElement).style.color = '#f06565' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#7c7c9a' }}
        >
          <span>↪</span>
          <span style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 0.2s', whiteSpace: 'nowrap' }}>Sign Out</span>
        </button>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '28px', height: '28px', background: '#1e1e28', border: '1px solid #2a2a3a',
            borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
            margin: '8px auto 0', color: '#7c7c9a', transition: 'all 0.18s',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(108,99,255,0.15)'; (e.currentTarget as HTMLButtonElement).style.color = '#6c63ff' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1e1e28'; (e.currentTarget as HTMLButtonElement).style.color = '#7c7c9a' }}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>
    </nav>
  )
}
