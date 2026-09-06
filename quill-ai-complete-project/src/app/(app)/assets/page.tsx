'use client'

import { useState, useEffect, useRef } from 'react'
import EmptyState from '@/components/ui/EmptyState'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface Asset {
  id: string; name: string; asset_type: 'image'|'video'; storage_path: string
  mime_type: string; file_size_bytes: number|null; tags: string[]
  used_count: number; folder_id: string|null; created_at: string; url: string
}

interface Folder {
  id: string; name: string; parent_folder_id: string|null; assetCount: number
}

function fmtFileSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AssetsPage() {
  const [assets,  setAssets]  = useState<Asset[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFolder, setActiveFolder] = useState<string>('all')   // 'all' | 'root' | folder id
  const [typeFilter, setTypeFilter] = useState<'all'|'image'|'video'>('all')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<{msg:string; type:'success'|'error'|'info'}|null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [deletingAsset, setDeletingAsset] = useState(false)

  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const [menuOpenFor, setMenuOpenFor] = useState<string|null>(null)
  const [showMoveFor, setShowMoveFor] = useState<Asset|null>(null)
  const [renamingId, setRenamingId] = useState<string|null>(null)
  const [renameValue, setRenameValue] = useState('')

  function showToast(msg: string, type: 'success'|'error'|'info' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { fetchFolders() }, [])
  useEffect(() => { fetchAssets() }, [activeFolder, typeFilter, search])

  async function fetchFolders() {
    const res = await fetch('/api/assets/folders')
    if (res.ok) { const d = await res.json(); setFolders(d.items ?? []) }
  }

  async function fetchAssets() {
    setLoading(true)
    const params = new URLSearchParams()
    if (activeFolder === 'root') params.set('folder_id', 'root')
    else if (activeFolder !== 'all') params.set('folder_id', activeFolder)
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (search.trim()) params.set('q', search.trim())

    const res = await fetch(`/api/assets?${params}`)
    if (res.ok) { const d = await res.json(); setAssets(d.items ?? []) }
    setLoading(false)
  }

  async function uploadFiles(files: FileList) {
    setUploading(true)
    let successCount = 0
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      if (activeFolder !== 'all' && activeFolder !== 'root') formData.append('folder_id', activeFolder)
      const res = await fetch('/api/assets', { method: 'POST', body: formData })
      if (res.ok) successCount++
      else {
        const d = await res.json().catch(() => ({}))
        showToast(`${file.name}: ${d.error ?? 'upload failed'}`, 'error')
      }
    }
    setUploading(false)
    if (successCount > 0) {
      showToast(`Uploaded ${successCount} asset${successCount === 1 ? '' : 's'}`, 'success')
      fetchAssets()
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return
    const res = await fetch('/api/assets/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newFolderName.trim() }),
    })
    if (res.ok) {
      setShowNewFolder(false)
      setNewFolderName('')
      fetchFolders()
      showToast('Folder created', 'success')
    } else {
      showToast('Failed to create folder', 'error')
    }
  }

  async function deleteAsset(id: string) {
    setMenuOpenFor(null)
    setDeletingAsset(true)
    const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' })
    setDeletingAsset(false)
    setPendingDelete(null)
    if (res.ok) {
      setAssets(prev => prev.filter(a => a.id !== id))
      showToast('Asset deleted', 'info')
    } else {
      showToast('Failed to delete', 'error')
    }
  }

  async function moveAsset(assetId: string, folderId: string | null) {
    const res = await fetch(`/api/assets/${assetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId }),
    })
    setShowMoveFor(null)
    if (res.ok) { showToast('Moved', 'success'); fetchAssets(); fetchFolders() }
    else showToast('Failed to move', 'error')
  }

  async function renameAsset(id: string) {
    if (!renameValue.trim()) { setRenamingId(null); return }
    const res = await fetch(`/api/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue.trim() }),
    })
    setRenamingId(null)
    if (res.ok) fetchAssets()
    else showToast('Rename failed', 'error')
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url)
    showToast('URL copied', 'info')
  }

  const topFolders = folders.filter(f => !f.parent_folder_id)

  return (
    <div
      style={{ padding: '24px', background: '#0f0f13', minHeight: '100%', display: 'grid', gridTemplateColumns: '220px 1fr', gap: '20px' }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files) }}
    >
      {toast && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, background: '#16161d', border: '1px solid #2a2a3a', borderLeft: `3px solid ${toast.type === 'success' ? '#3ecf8e' : toast.type === 'error' ? '#f06565' : '#6c63ff'}`, borderRadius: '10px', padding: '12px 16px', fontSize: '13px', fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          {toast.msg}
        </div>
      )}

      {/* Folder sidebar */}
      <div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: '20px', fontWeight: 800, margin: '0 0 16px' }}>Assets</h1>
        <div
          onClick={() => setActiveFolder('all')}
          style={{ padding: '8px 10px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '2px', background: activeFolder === 'all' ? 'rgba(108,99,255,0.12)' : 'transparent', color: activeFolder === 'all' ? '#6c63ff' : '#e8e8f0', fontWeight: activeFolder === 'all' ? 600 : 400 }}
        >
          📁 All Assets
        </div>
        <div
          onClick={() => setActiveFolder('root')}
          style={{ padding: '8px 10px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '2px', background: activeFolder === 'root' ? 'rgba(108,99,255,0.12)' : 'transparent', color: activeFolder === 'root' ? '#6c63ff' : '#e8e8f0', fontWeight: activeFolder === 'root' ? 600 : 400 }}
        >
          Unfiled
        </div>
        {topFolders.map(f => (
          <div
            key={f.id}
            onClick={() => setActiveFolder(f.id)}
            style={{ padding: '8px 10px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '2px', display: 'flex', justifyContent: 'space-between', background: activeFolder === f.id ? 'rgba(108,99,255,0.12)' : 'transparent', color: activeFolder === f.id ? '#6c63ff' : '#e8e8f0', fontWeight: activeFolder === f.id ? 600 : 400 }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {f.name}</span>
            <span style={{ color: '#7c7c9a', fontSize: '11px', flexShrink: 0 }}>{f.assetCount}</span>
          </div>
        ))}
        <button
          onClick={() => setShowNewFolder(true)}
          style={{ width: '100%', marginTop: '10px', background: 'transparent', border: '1px dashed #2a2a3a', borderRadius: '6px', padding: '7px', fontSize: '12px', color: '#7c7c9a', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
        >
          + New Folder
        </button>
      </div>

      {/* Main content */}
      <div>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets…"
            style={{ flex: 1, minWidth: '180px', background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '9px 12px', color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif', outline: 'none' }}
          />
          <select
            value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)}
            style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '9px 12px', color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif', outline: 'none' }}
          >
            <option value="all">All types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
          <input
            ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files); e.target.value = '' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{ background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap', opacity: uploading ? 0.7 : 1 }}
          >
            {uploading ? 'Uploading…' : '+ Upload'}
          </button>
        </div>

        {loading ? (
          <div style={{ color: '#7c7c9a', fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon="🖼️"
            title="No assets yet"
            body="Drag and drop images or videos anywhere on this page, or click Upload — they'll be searchable and reusable across every content piece and campaign."
            cta={{ label: '+ Upload', href: '#', onClick: () => fileInputRef.current?.click() }}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px' }}>
            {assets.map(asset => (
              <div key={asset.id} style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
                <div style={{ aspectRatio: '1', background: '#0f0f13', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {asset.asset_type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <video src={asset.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                  )}
                </div>
                <div style={{ padding: '10px' }}>
                  {renamingId === asset.id ? (
                    <input
                      autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => renameAsset(asset.id)}
                      onKeyDown={e => { if (e.key === 'Enter') renameAsset(asset.id); if (e.key === 'Escape') setRenamingId(null) }}
                      style={{ width: '100%', background: '#0f0f13', border: '1px solid #6c63ff', borderRadius: '4px', padding: '3px 6px', color: '#e8e8f0', fontSize: '12px', fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' }}
                    />
                  ) : (
                    <div style={{ fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asset.name}>{asset.name}</div>
                  )}
                  <div style={{ fontSize: '10px', color: '#7c7c9a', marginTop: '3px' }}>
                    {fmtFileSize(asset.file_size_bytes)}{asset.used_count > 0 && ` · used ${asset.used_count}×`}
                  </div>
                </div>

                <button
                  onClick={() => setMenuOpenFor(menuOpenFor === asset.id ? null : asset.id)}
                  style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(15,15,19,0.8)', border: 'none', borderRadius: '6px', color: '#e8e8f0', cursor: 'pointer', fontSize: '13px', padding: '4px 8px' }}
                >
                  ⋯
                </button>

                {menuOpenFor === asset.id && (
                  <div style={{ position: 'absolute', top: '32px', right: '6px', background: '#16161d', border: '1px solid #2a2a3a', borderRadius: '8px', overflow: 'hidden', zIndex: 10, minWidth: '140px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                    <button onClick={() => { setRenamingId(asset.id); setRenameValue(asset.name); setMenuOpenFor(null) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '9px 12px', fontSize: '12px', color: '#e8e8f0', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Rename</button>
                    <button onClick={() => { setShowMoveFor(asset); setMenuOpenFor(null) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '9px 12px', fontSize: '12px', color: '#e8e8f0', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Move to folder</button>
                    <button onClick={() => copyUrl(asset.url)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '9px 12px', fontSize: '12px', color: '#e8e8f0', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Copy URL</button>
                    <button onClick={() => { setMenuOpenFor(null); setPendingDelete({ id: asset.id, name: asset.name }) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '9px 12px', fontSize: '12px', color: '#f06565', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New folder modal */}
      {showNewFolder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowNewFolder(false)}>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '14px', padding: '20px', width: '340px' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>New Folder</div>
            <input
              autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createFolder() }}
              placeholder="Folder name"
              style={{ width: '100%', background: '#0f0f13', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '9px 12px', color: '#e8e8f0', fontSize: '13px', fontFamily: 'Inter, sans-serif', marginBottom: '14px', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={createFolder} style={{ flex: 1, background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Create</button>
              <button onClick={() => setShowNewFolder(false)} style={{ background: 'transparent', color: '#7c7c9a', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Move-to-folder modal */}
      {showMoveFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowMoveFor(null)}>
          <div style={{ background: '#1e1e28', border: '1px solid #2a2a3a', borderRadius: '14px', padding: '20px', width: '320px', maxHeight: '60vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>Move &ldquo;{showMoveFor.name}&rdquo;</div>
            <button onClick={() => moveAsset(showMoveFor.id, null)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#e8e8f0', cursor: 'pointer', fontFamily: 'Inter, sans-serif', marginBottom: '6px' }}>Unfiled</button>
            {topFolders.map(f => (
              <button key={f.id} onClick={() => moveAsset(showMoveFor.id, f.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: '1px solid #2a2a3a', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#e8e8f0', cursor: 'pointer', fontFamily: 'Inter, sans-serif', marginBottom: '6px' }}>📁 {f.name}</button>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        description="This permanently removes the file from your asset library. This can't be undone."
        confirmLabel="Delete Asset"
        loading={deletingAsset}
        onConfirm={() => pendingDelete && deleteAsset(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
