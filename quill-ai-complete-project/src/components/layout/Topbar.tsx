'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/analyzer': 'Social Media Analyzer',
  '/generator': 'Content Generator',
  '/calendar': 'Content Calendar',
  '/performance': 'Performance Tracker',
  '/review': 'Review Queue',
  '/settings': 'Settings',
}

interface SearchResult {
  id: string
  title: string | null
  platforms: string[] | null
  status: string
  content_type: string | null
  created_at: string
}

const PLATFORM_COLORS: Record<string, string> = {
  linkedin: '#3b82f6', twitter: '#4fb3f7', instagram: '#f472b6',
  blog: '#3ecf8e', email: '#f59e42',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function Topbar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [initials, setInitials] = useState('?')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)

  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const title = PAGE_TITLES[pathname] ?? 'Quill.AI'

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        const name = user.user_metadata?.full_name ?? user.email ?? ''
        const parts = name.split(' ')
        setInitials(
          parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : name.substring(0, 2).toUpperCase()
        )
      }
    })
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setSelectedIdx(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const performSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setShowDropdown(false); return }
    setSearching(true)
    setShowDropdown(true)
    try {
      const res = await fetch(`/api/content?q=${encodeURIComponent(q)}&limit=5`)
      if (res.ok) {
        const data = await res.json()
        setResults(data.items ?? [])
      }
    } catch { /* ignore */ }
    setSearching(false)
  }, [])

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    setSelectedIdx(-1)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 2) { setShowDropdown(false); setResults([]); return }

    debounceRef.current = setTimeout(() => performSearch(val), 300)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIdx >= 0 && results[selectedIdx]) {
        openResult(results[selectedIdx])
      } else if (query.trim()) {
        router.push(`/generator?q=${encodeURIComponent(query)}`)
        setShowDropdown(false)
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      inputRef.current?.blur()
    }
  }

  function openResult(result: SearchResult) {
    router.push(`/generator?contentId=${result.id}`)
    setShowDropdown(false)
    setQuery('')
    setResults([])
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    background: '#1e1e28',
    border: '1px solid #2a2a3a',
    borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    zIndex: 1000,
    overflow: 'hidden',
  }

  return (
    <div style={{
      height: '60px', display: 'flex', alignItems: 'center',
      padding: '0 24px', borderBottom: '1px solid #2a2a3a',
      gap: '16px', background: '#0f0f13', flexShrink: 0,
    }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '18px', fontWeight: 700, flexShrink: 0 }}>
        {title}
      </div>

      {/* Search with dropdown */}
      <div ref={searchRef} style={{ flex: 1, maxWidth: '340px', marginLeft: '16px', position: 'relative' }}>
        <span style={{
          position: 'absolute', left: '10px', top: '50%',
          transform: 'translateY(-50%)', fontSize: '12px', pointerEvents: 'none',
          zIndex: 1,
        }}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search content…"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query.length >= 2 && setShowDropdown(true)}
          style={{
            width: '100%', background: '#1e1e28', border: '1px solid #2a2a3a',
            borderRadius: '8px', padding: '7px 12px 7px 34px',
            color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif',
            outline: 'none', transition: 'border-color 0.18s',
          }}
          onFocusCapture={e => (e.target.style.borderColor = '#6c63ff')}
          onBlur={e => (e.target.style.borderColor = '#2a2a3a')}
        />

        {/* Dropdown */}
        {showDropdown && (
          <div style={dropdownStyle}>
            {searching ? (
              <div style={{ padding: '14px 16px', fontSize: '13px', color: '#7c7c9a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> Searching…
              </div>
            ) : results.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: '13px', color: '#7c7c9a' }}>
                No content found for &ldquo;{query}&rdquo;
              </div>
            ) : (
              <>
                {results.map((r, i) => {
                  const platform = r.platforms?.[0] ?? 'blog'
                  const pc = PLATFORM_COLORS[platform] ?? '#7c7c9a'
                  const isSelected = i === selectedIdx
                  return (
                    <div
                      key={r.id}
                      onClick={() => openResult(r)}
                      style={{
                        padding: '10px 16px',
                        cursor: 'pointer',
                        borderBottom: i < results.length - 1 ? '1px solid rgba(42,42,58,0.5)' : 'none',
                        background: isSelected ? 'rgba(108,99,255,0.08)' : 'transparent',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(108,99,255,0.06)'
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#e8e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title ?? 'Untitled'}
                        </span>
                        <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', background: pc + '22', color: pc, flexShrink: 0 }}>
                          {platform}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#4a4a65' }}>
                        <span style={{ padding: '1px 6px', borderRadius: '20px', background: 'rgba(124,124,154,0.12)', color: '#7c7c9a' }}>{r.status}</span>
                        <span>{timeAgo(r.created_at)}</span>
                      </div>
                    </div>
                  )
                })}
                <div
                  onClick={() => { router.push(`/generator?q=${encodeURIComponent(query)}`); setShowDropdown(false) }}
                  style={{
                    padding: '10px 16px', fontSize: '12px', color: '#6c63ff',
                    fontWeight: 600, cursor: 'pointer', borderTop: '1px solid #2a2a3a',
                    background: 'rgba(108,99,255,0.04)',
                  }}
                >
                  View all results →
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
        <button
          type="button"
          aria-label="Notifications"
          title="Notifications"
          style={{
            width: '36px', height: '36px', borderRadius: '8px', background: '#1e1e28',
            border: '1px solid #2a2a3a', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', fontSize: '16px',
            color: '#7c7c9a', position: 'relative', transition: 'all 0.18s',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#6c63ff'; (e.currentTarget as HTMLButtonElement).style.color = '#6c63ff' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a3a'; (e.currentTarget as HTMLButtonElement).style.color = '#7c7c9a' }}>
          🔔
          <div style={{ position: 'absolute', top: '6px', right: '6px', width: '7px', height: '7px', background: '#f06565', borderRadius: '50%', border: '1px solid #0f0f13' }} />
        </button>
        <Link href="/settings" aria-label="Your profile — go to Settings" title="Profile" style={{
          width: '36px', height: '36px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #6c63ff, #f5c842)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '13px', cursor: 'pointer', color: '#fff', flexShrink: 0,
          textDecoration: 'none',
        }}>{initials}</Link>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
