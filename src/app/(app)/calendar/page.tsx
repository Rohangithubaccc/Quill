'use client'

import EmptyState from '@/components/ui/EmptyState'
import { useEffect, useState, useCallback } from 'react'
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { track } from '@/lib/posthog'

interface CalEvent {
  id: string; title: string; platform: string | null
  scheduled_at: string; status: string; content_id: string | null
}

interface ApprovedPiece { id: string; title: string | null; platforms: string[] | null }

const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const PC: Record<string,string> = {
  twitter:'#4fb3f7', linkedin:'#3b82f6', instagram:'#f472b6', blog:'#3ecf8e', email:'#f59e42',
}
function pad2(n: number) { return String(n).padStart(2,'0') }

// ── Draggable event pill ─────────────────────────────────────────────────────
function DraggableEvent({ ev, isDimmed }: { ev: CalEvent; isDimmed: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ev.id, data: { ev } })
  const pc = PC[ev.platform ?? 'blog'] ?? '#6c63ff'
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      style={{
        fontSize:'10px', padding:'2px 5px', borderRadius:'3px', marginBottom:'2px',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight:500,
        background: pc + '30', color: pc, cursor:'grab',
        opacity: isDragging ? 0 : isDimmed ? 0.4 : 1,
        transition:'opacity 0.15s',
        transform: isDragging ? 'scale(1.02)' : 'none',
        touchAction: 'none',
      }}>
      {ev.title}
    </div>
  )
}

// ── Droppable cell ────────────────────────────────────────────────────────────
function DroppableCell({
  cellId, day, isOtherMonth, isToday, children, onCellClick, isOver,
}: {
  cellId: string; day: number | null; isOtherMonth: boolean; isToday: boolean
  children: React.ReactNode; onCellClick: () => void; isOver: boolean
}) {
  const { setNodeRef } = useDroppable({ id: cellId, disabled: isOtherMonth || !day })
  return (
    <div ref={setNodeRef}
      onClick={onCellClick}
      style={{
        minHeight:'90px', padding:'8px',
        borderRight:'1px solid #2a2a3a', borderBottom:'1px solid #2a2a3a',
        cursor: day && !isOtherMonth ? 'pointer' : 'default',
        opacity: isOtherMonth ? 0.25 : 1,
        background: isOver && !isOtherMonth ? 'rgba(108,99,255,0.12)' : 'transparent',
        border: isOver && !isOtherMonth ? '2px solid #6c63ff' : '1px solid #2a2a3a',
        transition:'all 0.1s',
        position:'relative',
      }}>
      {isOver && !isOtherMonth && (
        <div style={{ position:'absolute', bottom:'4px', left:0, right:0, textAlign:'center', fontSize:'9px', color:'#6c63ff', fontWeight:600, pointerEvents:'none' }}>
          Drop to schedule
        </div>
      )}
      <div style={{
        width:'22px', height:'22px', display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:'12px', fontWeight:600, color: isToday ? '#fff' : '#7c7c9a', marginBottom:'4px',
        borderRadius: isToday ? '50%' : '0',
        background: isToday ? '#6c63ff' : 'transparent',
      }}>{day}</div>
      {children}
    </div>
  )
}

export default function CalendarPage() {
  const now = new Date()
  const [year,     setYear]     = useState(now.getFullYear())
  const [month,    setMonth]    = useState(now.getMonth())
  const [events,   setEvents]   = useState<CalEvent[]>([])
  const [view,     setView]     = useState<'grid'|'list'>('grid')
  const [panelDay, setPanelDay] = useState<number|null>(null)
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [toast,    setToast]    = useState('')
  const [form,     setForm]     = useState({ title:'', platform:'LinkedIn', datetime:'', status:'scheduled' })

  // Auto-schedule modal state
  const [autoModal,      setAutoModal]      = useState(false)
  const [approvedPieces, setApprovedPieces] = useState<ApprovedPiece[]>([])
  const [autoLoading,    setAutoLoading]    = useState(false)

  // DnD state
  const [activeEvent,   setActiveEvent]   = useState<CalEvent|null>(null)
  const [overCellId,    setOverCellId]    = useState<string|null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3200) }

  useEffect(() => { fetchEvents() }, [year, month])

  async function fetchEvents() {
    setLoading(true)
    const res = await fetch(`/api/calendar?month=${year}-${pad2(month+1)}`)
    if (res.ok) { const d = await res.json(); setEvents(d.events ?? []) }
    setLoading(false)
  }

  function changeMonth(dir: number) {
    let m = month + dir, y = year
    if (m > 11) { m = 0; y++ } else if (m < 0) { m = 11; y-- }
    setMonth(m); setYear(y)
  }

  function eventsOnDay(day: number) {
    return events.filter(e => {
      const d = new Date(e.scheduled_at)
      return d.getFullYear()===year && d.getMonth()===month && d.getDate()===day
    })
  }

  async function createEvent() {
    if (!form.title || !form.datetime) { showToast('Title and date required'); return }
    setSaving(true)
    const res = await fetch('/api/calendar', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        title: form.title, platform: form.platform.toLowerCase(),
        scheduledAt: new Date(form.datetime).toISOString(), status: form.status,
      }),
    })
    setSaving(false)
    if (res.ok) {
      showToast('Scheduled!')
      track.contentScheduled({ platform: form.platform.toLowerCase(), via: 'manual' })
      setPanelDay(null)
      setForm({ title:'', platform:'LinkedIn', datetime:'', status:'scheduled' })
      fetchEvents()
    } else { showToast('Failed to schedule') }
  }

  // ── Auto-schedule ─────────────────────────────────────────────────────────
  async function openAutoSchedule() {
    const res = await fetch('/api/content?status=approved&limit=20')
    if (!res.ok) { showToast('Could not fetch approved content'); return }
    const data = await res.json()
    const pieces = data.items ?? []
    if (pieces.length === 0) {
      showToast('No approved content. Approve content in Review Queue first.')
      return
    }
    setApprovedPieces(pieces)
    setAutoModal(true)
  }

  async function confirmAutoSchedule() {
    setAutoLoading(true)
    const res = await fetch('/api/calendar/auto-schedule', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        contentIds: approvedPieces.map(p => p.id),
        platforms:  approvedPieces.flatMap(p => p.platforms ?? ['linkedin']).filter(Boolean),
      }),
    })
    setAutoLoading(false)
    if (res.ok) {
      const data = await res.json()
      setAutoModal(false)
      showToast(data.summary ?? `Scheduled ${data.count} posts!`)
      track.autoScheduleUsed({ count: data.count })
      fetchEvents()
    } else {
      showToast('Auto-schedule failed')
    }
  }

  // ── DnD handlers ─────────────────────────────────────────────────────────
  function handleDragStart(e: DragStartEvent) {
    setActiveEvent(e.active.data.current?.ev ?? null)
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveEvent(null)
    setOverCellId(null)
    const { active, over } = e
    if (!over || !active.data.current?.ev) return

    const ev: CalEvent = active.data.current.ev
    const cellId = String(over.id) // format: "YYYY-MM-DD"
    const [cy, cm, cd] = cellId.split('-').map(Number)
    if (!cy || !cm || !cd) return

    // Preserve original time-of-day, only change the date. Found during
    // a ruthless adversarial pass: this used to extract the *UTC*
    // hour/minute from the original timestamp but combine it with the
    // *local* day/month/year of the drop target (cy/cm/cd, parsed from
    // the grid cell's local-date cellId) — mixing two different
    // timezone frames in one Date.UTC() call. Confirmed concretely: a
    // 9 PM Eastern event dragged onto the "Jan 25" cell silently landed
    // on Jan 24, 9 PM; a 1 AM Sydney event dragged onto "Jan 25" landed
    // on Jan 26 — shifts either direction depending on the timezone
    // offset and how close the event's local time is to midnight, which
    // for evening/morning social posts is common, not an edge case.
    // Fix: stay entirely in the local-time frame throughout, matching
    // how the create-event flow already correctly works (a
    // datetime-local input's local time, converted to UTC only at the
    // very end via toISOString()) — extract the *local* hour/minute and
    // construct the new Date with the local constructor, not Date.UTC.
    const orig    = new Date(ev.scheduled_at)
    const newDate = new Date(cy, cm-1, cd, orig.getHours(), orig.getMinutes(), 0)

    if (newDate.toISOString() === ev.scheduled_at) return // same slot

    // Optimistic update
    setEvents(prev => prev.map(e =>
      e.id === ev.id ? { ...e, scheduled_at: newDate.toISOString() } : e
    ))

    const res = await fetch('/api/calendar', {
      method:'PATCH', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ id: ev.id, scheduledAt: newDate.toISOString() }),
    })

    if (res.ok) {
      const d = MONTHS[cm-1]
      showToast(`Rescheduled to ${d} ${cd}`)
      track.contentRescheduled({ via: 'drag_drop' })
    } else {
      // Revert
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, scheduled_at: ev.scheduled_at } : e))
      showToast('Reschedule failed — reverted')
    }
  }

  // ── Calendar grid data ────────────────────────────────────────────────────
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const isCurrentMonth = now.getFullYear()===year && now.getMonth()===month

  const cells: { day:number|null; otherMonth:boolean }[] = []
  for (let i=0; i<firstDay; i++) cells.push({ day:null, otherMonth:true })
  for (let d=1; d<=daysInMonth; d++) cells.push({ day:d, otherMonth:false })
  const trailing = cells.length%7===0 ? 0 : 7-(cells.length%7)
  for (let i=1; i<=trailing; i++) cells.push({ day:null, otherMonth:true })

  const panelEvents = panelDay ? eventsOnDay(panelDay) : []

  return (
    <div style={{ padding:'24px', background:'#0f0f13', minHeight:'100%' }}>
      {toast && (
        <div style={{ position:'fixed', bottom:'80px', right:'20px', zIndex:9999, background:'#16161d', border:'1px solid #2a2a3a', borderLeft:'3px solid #3ecf8e', borderRadius:'10px', padding:'12px 16px', fontSize:'13px', fontWeight:500, boxShadow:'0 4px 20px rgba(0,0,0,0.4)' }}>{toast}</div>
      )}

      {/* Header */}
      <div className="calendar-controls" style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px', flexWrap:'wrap', gap:'8px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <button onClick={() => changeMonth(-1)} style={navBtn}>←</button>
          <h2 style={{ fontFamily:'Syne, sans-serif', fontSize:'20px', fontWeight:700, minWidth:'200px', textAlign:'center' }}>{MONTHS[month]} {year}</h2>
          <button onClick={() => changeMonth(1)} style={navBtn}>→</button>
        </div>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button onClick={openAutoSchedule} style={{ background:'rgba(108,99,255,0.12)', color:'#6c63ff', border:'1px solid rgba(108,99,255,0.3)', borderRadius:'8px', padding:'7px 14px', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' }}>
            🤖 Auto-Schedule
          </button>
          <button onClick={() => setPanelDay(-1)} style={{ background:'#6c63ff', color:'#fff', border:'none', borderRadius:'8px', padding:'7px 14px', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' }}>
            + Schedule
          </button>
          <div style={{ display:'flex', gap:'2px', background:'#1e1e28', padding:'3px', borderRadius:'7px', border:'1px solid #2a2a3a' }}>
            {(['grid','list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{ padding:'5px 14px', borderRadius:'5px', fontSize:'12px', fontWeight:500, cursor:'pointer', border:'none', fontFamily:'Inter, sans-serif', background:view===v ? '#6c63ff' : 'transparent', color:view===v ? '#fff' : '#7c7c9a', textTransform:'capitalize' }}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid view with DnD — hidden on mobile via .calendar-grid-view CSS class */}
      <div className="calendar-grid-view">
        {view==='grid' && (
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}
            onDragOver={e => setOverCellId(e.over ? String(e.over.id) : null)}>
            <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'rgba(255,255,255,0.02)', borderBottom:'1px solid #2a2a3a' }}>
                {DAYS.map(d => <div key={d} style={{ textAlign:'center', padding:'10px 4px', fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a' }}>{d}</div>)}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
                {cells.map((cell, idx) => {
                  const dateStr = cell.day ? `${year}-${pad2(month+1)}-${pad2(cell.day)}` : `empty-${idx}`
                  const isToday = isCurrentMonth && cell.day===now.getDate()
                  const dayEvents = cell.day ? eventsOnDay(cell.day) : []
                  const isOver = overCellId === dateStr && !cell.otherMonth && !!cell.day
                  return (
                    <DroppableCell key={dateStr} cellId={dateStr}
                      day={cell.day} isOtherMonth={cell.otherMonth}
                      isToday={isToday} isOver={isOver}
                      onCellClick={() => cell.day && setPanelDay(cell.day)}>
                      {dayEvents.slice(0,3).map(ev => (
                        <DraggableEvent key={ev.id} ev={ev} isDimmed={activeEvent?.id === ev.id} />
                      ))}
                      {dayEvents.length > 3 && <div style={{ fontSize:'9px', color:'#4a4a65' }}>+{dayEvents.length-3} more</div>}
                    </DroppableCell>
                  )
                })}
              </div>
            </div>

            {/* Drag overlay — ghost card */}
            <DragOverlay>
              {activeEvent && (
                <div style={{
                  fontSize:'11px', padding:'4px 8px', borderRadius:'4px',
                  background: (PC[activeEvent.platform ?? 'blog'] ?? '#6c63ff') + '40',
                  color: PC[activeEvent.platform ?? 'blog'] ?? '#6c63ff',
                  boxShadow:'0 4px 16px rgba(0,0,0,0.4)',
                  transform:'scale(1.04)', opacity:0.92, cursor:'grabbing',
                  fontWeight:600, maxWidth:'180px', whiteSpace:'nowrap',
                  overflow:'hidden', textOverflow:'ellipsis',
                }}>
                  📅 {activeEvent.title}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Mobile-only event list — always rendered, shown/hidden via CSS.
          Uses the same events data as the desktop grid.
          Sorted by scheduled_at ascending, grouped by proximity to today. */}
      <div className="calendar-list-view">
        {loading ? (
          <div style={{ padding:'24px', textAlign:'center', color:'#7c7c9a', fontSize:'13px' }}>Loading…</div>
        ) : events.length === 0 ? (
          <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', padding:'32px', textAlign:'center', color:'#7c7c9a', fontSize:'13px' }}>
            <div style={{ fontSize:'32px', marginBottom:'12px', opacity:0.4 }}>📅</div>
            <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'15px', color:'#e8e8f0', marginBottom:'6px' }}>Nothing scheduled yet</div>
            <div>Tap + Schedule to add your first post</div>
          </div>
        ) : (() => {
          const now2 = new Date()
          const sorted = [...events].sort((a,b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
          const groups: { label: string; items: CalEvent[] }[] = []

          for (const ev of sorted) {
            const d = new Date(ev.scheduled_at)
            const diffDays = Math.floor((d.getTime() - now2.getTime()) / (1000*60*60*24))
            const label = diffDays < 0 ? 'Past'
              : diffDays === 0 ? 'Today'
              : diffDays === 1 ? 'Tomorrow'
              : diffDays <= 7  ? 'This Week'
              : 'Later'
            const existing = groups.find(g => g.label === label)
            if (existing) existing.items.push(ev)
            else groups.push({ label, items: [ev] })
          }

          return groups.map(group => (
            <div key={group.label} style={{ marginBottom:'16px' }}>
              <div style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'8px', paddingLeft:'2px' }}>{group.label}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {group.items.map(ev => {
                  const d = new Date(ev.scheduled_at)
                  const pc = PC[ev.platform ?? 'blog'] ?? '#6c63ff'
                  const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
                  const formatted = `${dayName} ${d.getDate()} ${MONTHS[d.getMonth()].substring(0,3)} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
                  const statusColor = ev.status === 'published' ? '#3ecf8e' : ev.status === 'scheduled' ? '#4fb3f7' : '#7c7c9a'
                  return (
                    <div key={ev.id} style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'10px', padding:'12px 14px', display:'flex', alignItems:'flex-start', gap:'12px' }}>
                      <span style={{ padding:'3px 8px', borderRadius:'4px', fontSize:'10px', fontWeight:700, textTransform:'uppercase', background:pc+'22', color:pc, flexShrink:0, marginTop:'2px' }}>{ev.platform ?? 'blog'}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'13px', fontWeight:600, color:'#e8e8f0', lineHeight:1.4, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{ev.title}</div>
                        <div style={{ fontSize:'11px', color:'#7c7c9a', marginTop:'4px' }}>{formatted}</div>
                      </div>
                      <span style={{ padding:'3px 8px', borderRadius:'20px', fontSize:'10px', fontWeight:600, background:statusColor+'22', color:statusColor, flexShrink:0 }}>{ev.status}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        })()}
      </div>

      {/* List view — desktop table, hidden on mobile by .calendar-list-view CSS */}
      {view==='list' && (
        <div style={{ background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'12px', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>{['Date','Title','Platform','Status'].map(h => (
                <th key={h} style={{ fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', padding:'12px 16px', background:'rgba(255,255,255,0.02)', borderBottom:'1px solid #2a2a3a', textAlign:'left' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={4} style={{ padding:'24px', textAlign:'center', color:'#7c7c9a' }}>Loading…</td></tr>
              : events.length===0 ? <tr><td colSpan={4}><EmptyState icon="📅" title="Nothing scheduled yet" body="Schedule your approved content or use Auto-Schedule to fill your calendar." cta={{ label: '🤖 Auto-Schedule', href: '#', onClick: openAutoSchedule }} secondaryCta={{ label: 'Browse content', href: '/dashboard' }} /></td></tr>
              : events.map(ev => {
                const d = new Date(ev.scheduled_at)
                const pc = PC[ev.platform ?? 'blog'] ?? '#7c7c9a'
                return (
                  <tr key={ev.id}>
                    <td style={{ padding:'12px 16px', fontSize:'13px', color:'#7c7c9a', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>
                      {MONTHS[d.getMonth()].substring(0,3)} {d.getDate()}, {d.getFullYear()} {pad2(d.getHours())}:{pad2(d.getMinutes())}
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:500, borderBottom:'1px solid rgba(42,42,58,0.5)' }}>{ev.title}</td>
                    <td style={{ padding:'12px 16px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>
                      <span style={{ padding:'2px 7px', borderRadius:'4px', fontSize:'10px', fontWeight:700, textTransform:'uppercase', background:pc+'22', color:pc }}>{ev.platform ?? 'blog'}</span>
                    </td>
                    <td style={{ padding:'12px 16px', borderBottom:'1px solid rgba(42,42,58,0.5)' }}>
                      <span style={{ padding:'3px 8px', borderRadius:'20px', fontSize:'11px', fontWeight:600, background:'rgba(79,179,247,0.15)', color:'#4fb3f7' }}>{ev.status}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide panel */}
      {panelDay !== null && (
        <>
          <div onClick={() => setPanelDay(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:900 }} />
          <div style={{ position:'fixed', right:0, top:0, bottom:0, width:'360px', background:'#16161d', borderLeft:'1px solid #2a2a3a', zIndex:901, padding:'24px', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'16px' }}>
                📅 {panelDay > 0 ? `${MONTHS[month]} ${panelDay}` : 'Schedule Content'}
              </div>
              <button onClick={() => setPanelDay(null)} style={{ background:'transparent', border:'none', color:'#7c7c9a', cursor:'pointer', fontSize:'18px' }}>✕</button>
            </div>

            {panelDay > 0 && panelEvents.length > 0 && (
              <div style={{ marginBottom:'20px' }}>
                <div style={labelStyle}>Scheduled Items</div>
                {panelEvents.map(ev => {
                  const pc = PC[ev.platform ?? 'blog'] ?? '#6c63ff'
                  return (
                    <div key={ev.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'10px', background:'#0f0f13', borderRadius:'8px', border:'1px solid #2a2a3a', marginBottom:'8px' }}>
                      <span style={{ padding:'2px 7px', borderRadius:'4px', fontSize:'10px', fontWeight:700, textTransform:'uppercase', background:pc+'22', color:pc }}>{ev.platform ?? 'blog'}</span>
                      <span style={{ fontSize:'13px', fontWeight:500, flex:1 }}>{ev.title}</span>
                    </div>
                  )
                })}
                <div style={{ height:'1px', background:'#2a2a3a', margin:'16px 0' }} />
              </div>
            )}

            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              {[
                { key:'title', label:'Content Title', type:'text', placeholder:'Enter title…' },
                { key:'datetime', label:'Date & Time', type:'datetime-local', placeholder:'' },
              ].map(f => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type={f.type} placeholder={f.placeholder}
                    value={form[f.key as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [f.key]:e.target.value }))}
                    style={{ width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none' }}
                    onFocus={e => (e.target.style.borderColor='#6c63ff')} onBlur={e => (e.target.style.borderColor='#2a2a3a')} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Platform</label>
                <select value={form.platform} onChange={e => setForm(p => ({ ...p, platform:e.target.value }))}
                  style={{ width:'100%', background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'9px 12px', color:'#e8e8f0', fontSize:'13px', fontFamily:'Inter, sans-serif', outline:'none', appearance:'none' }}>
                  {['LinkedIn','Twitter/X','Instagram','Blog','Email'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                <button onClick={createEvent} disabled={saving} style={{ flex:1, background:'#6c63ff', color:'#fff', border:'none', borderRadius:'8px', padding:'10px', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'Inter, sans-serif' }}>
                  {saving ? 'Saving…' : 'Schedule'}
                </button>
                <button onClick={() => setPanelDay(null)} style={{ background:'transparent', color:'#7c7c9a', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'10px 16px', fontSize:'13px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}>Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Auto-schedule modal */}
      {autoModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(4px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
          <div style={{ background:'#16161d', border:'1px solid #2a2a3a', borderRadius:'16px', padding:'28px', width:'100%', maxWidth:'480px', boxShadow:'0 24px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'18px', marginBottom:'8px' }}>🤖 Auto-Schedule Content</div>
            <p style={{ fontSize:'13px', color:'#7c7c9a', marginBottom:'20px', lineHeight:1.6 }}>
              Found {approvedPieces.length} approved piece{approvedPieces.length!==1?'s':''} ready to schedule. AI will spread these across the next 2 weeks at optimal times.
            </p>
            <div style={{ background:'#0f0f13', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'12px', marginBottom:'20px', maxHeight:'200px', overflowY:'auto' }}>
              {approvedPieces.map(p => (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 0', borderBottom:'1px solid rgba(42,42,58,0.3)', fontSize:'13px' }}>
                  <span style={{ color:'#6c63ff' }}>•</span>
                  <span style={{ flex:1 }}>{p.title ?? 'Untitled'}</span>
                  {p.platforms?.[0] && (
                    <span style={{ fontSize:'10px', padding:'1px 6px', borderRadius:'3px', background:(PC[p.platforms[0].toLowerCase()] ?? '#7c7c9a')+'22', color:PC[p.platforms[0].toLowerCase()] ?? '#7c7c9a' }}>
                      {p.platforms[0].toLowerCase()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={confirmAutoSchedule} disabled={autoLoading} style={{ flex:1, background:'#6c63ff', color:'#fff', border:'none', borderRadius:'8px', padding:'11px', fontSize:'14px', fontWeight:600, cursor:autoLoading?'not-allowed':'pointer', fontFamily:'Inter, sans-serif', opacity:autoLoading?0.8:1 }}>
                {autoLoading ? '⏳ Scheduling…' : '🤖 Schedule All'}
              </button>
              <button onClick={() => setAutoModal(false)} style={{ background:'transparent', color:'#7c7c9a', border:'1px solid #2a2a3a', borderRadius:'8px', padding:'11px 18px', fontSize:'14px', cursor:'pointer', fontFamily:'Inter, sans-serif' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @media (max-width: 768px) {
          .calendar-grid-view { display: none !important; }
          .calendar-list-view { display: block !important; }
          .calendar-controls  { flex-direction: column !important; align-items: stretch !important; }
          .calendar-controls h2 { min-width: 0 !important; text-align: left !important; }
        }
        @media (min-width: 769px) {
          .calendar-list-view { display: none !important; }
        }
      `}</style>
    </div>
  )
}

const navBtn: React.CSSProperties = { width:'32px', height:'32px', background:'#1e1e28', border:'1px solid #2a2a3a', borderRadius:'6px', cursor:'pointer', color:'#7c7c9a', fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center' } as React.CSSProperties
const labelStyle: React.CSSProperties = { display:'block', fontSize:'11px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'#7c7c9a', marginBottom:'6px' }
