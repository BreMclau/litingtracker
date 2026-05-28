import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import Auth from './Auth'
import Admin from './Admin'

const STORAGE_KEY = 'legacy-listing-tracker-v1'
const STATUSES = ['New', 'In Progress', 'Completed']
const TABS = ['New', 'In Progress', 'Completed', 'All Active']
const SAVE_DEBOUNCE_MS = 600

const statusClass = (status) => {
  if (status === 'In Progress') return 'status-in-progress'
  if (status === 'Completed') return 'status-completed'
  return 'status-new'
}
const statusPillClass = (status) => status.replace(' ', '')

// Format a 'YYYY-MM-DD' value as MM/DD/YYYY without timezone drift; '' if empty.
const formatHeaderDate = (iso) => {
  if (!iso) return ''
  const parts = String(iso).split('-')
  if (parts.length === 3) {
    const [y, m, d] = parts
    return `${m}/${d}/${y}`
  }
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return ''
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`
}

// Sort by listingDate ascending (earliest first); entries without a date sink
// to the bottom. listingDate is 'YYYY-MM-DD', so string compare is chronological.
const byListingDateAsc = (a, b) => {
  const da = a.listingDate || ''
  const db = b.listingDate || ''
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return da < db ? -1 : da > db ? 1 : 0
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
}

const emptyListing = (overrides = {}) => ({
  id: makeId(),
  address: '',
  agent: '',
  listingDate: '',
  notes: '',
  previousListing: false,
  printedItems: false,
  status: 'New',
  photoDates: ['', '', ''],
  needs: ['', '', ''],
  sortOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: null,
  ...overrides,
})

const rowToListing = (row) => ({
  id: row.id,
  address: row.property_address || '',
  agent: row.listing_agent || '',
  listingDate: row.listing_date || '',
  notes: row.notes || '',
  previousListing: !!row.previous_listing,
  printedItems: !!row.printed_items,
  status: row.status || 'New',
  photoDates: [row.photo_date_1 || '', row.photo_date_2 || '', row.photo_date_3 || ''],
  needs: [row.need_1 || '', row.need_2 || '', row.need_3 || ''],
  sortOrder: row.sort_order ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  createdBy: row.created_by,
})

const listingToRow = (l) => ({
  id: l.id,
  property_address: l.address || '',
  listing_agent: l.agent || '',
  listing_date: l.listingDate || null,
  notes: l.notes || '',
  previous_listing: !!l.previousListing,
  printed_items: !!l.printedItems,
  status: l.status || 'New',
  photo_date_1: l.photoDates[0] || null,
  photo_date_2: l.photoDates[1] || null,
  photo_date_3: l.photoDates[2] || null,
  need_1: l.needs[0] || '',
  need_2: l.needs[1] || '',
  need_3: l.needs[2] || '',
  sort_order: l.sortOrder ?? 0,
})

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setAuthChecked(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, is_admin')
        .eq('id', session.user.id)
        .maybeSingle()
      if (cancelled) return
      if (data) {
        setProfile(data)
      } else {
        // Profile row missing — try to create one (e.g. if trigger didn't fire)
        const { data: inserted } = await supabase
          .from('profiles')
          .upsert({ id: session.user.id, email: session.user.email })
          .select('id, email, is_admin')
          .maybeSingle()
        if (!cancelled) setProfile(inserted || { id: session.user.id, email: session.user.email, is_admin: false })
      }
    })()
    return () => { cancelled = true }
  }, [session])

  if (!authChecked) {
    return <div className="loading-screen">Loading…</div>
  }
  if (!session) {
    return <Auth />
  }
  return <Tracker session={session} profile={profile} />
}

function Tracker({ session, profile }) {
  const [listings, setListings] = useState([])
  const [profiles, setProfiles] = useState({})
  const [activeTab, setActiveTab] = useState('New')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('tracker') // 'tracker' | 'admin'
  const [statusMsg, setStatusMsg] = useState(null)
  const [expandedId, setExpandedId] = useState(null) // accordion: only one open
  const fileInputRef = useRef(null)
  const saveTimers = useRef(new Map())
  const listingsRef = useRef(listings)

  useEffect(() => { listingsRef.current = listings }, [listings])

  const loadProfilesMap = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, email')
    if (data) {
      const map = {}
      for (const p of data) map[p.id] = p.email
      setProfiles(map)
    }
  }, [])

  const loadListings = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) {
      // Fall back to localStorage
      const cached = localStorage.getItem(STORAGE_KEY)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed)) setListings(parsed)
        } catch {}
      }
      setStatusMsg(`Couldn't reach Supabase: ${error.message}. Showing local cache.`)
    } else {
      const mapped = (data || []).map(rowToListing)
      setListings(mapped)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapped))
      setStatusMsg(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadListings()
    loadProfilesMap()
    const onFocus = () => { loadListings(); loadProfilesMap() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadListings, loadProfilesMap])

  useEffect(() => {
    if (listings.length > 0 || localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(listings))
    }
  }, [listings])

  const counts = {
    'New': listings.filter(l => l.status === 'New').length,
    'In Progress': listings.filter(l => l.status === 'In Progress').length,
    'Completed': listings.filter(l => l.status === 'Completed').length,
    'All Active': listings.filter(l => l.status !== 'Completed').length,
  }

  const visibleListings = (activeTab === 'All Active'
    ? listings.filter(l => l.status !== 'Completed')
    : listings.filter(l => l.status === activeTab)
  ).sort(byListingDateAsc)

  const scheduleSave = (id) => {
    if (saveTimers.current.has(id)) clearTimeout(saveTimers.current.get(id))
    const timer = setTimeout(async () => {
      saveTimers.current.delete(id)
      const current = listingsRef.current.find(l => l.id === id)
      if (!current) return
      const { error } = await supabase
        .from('listings')
        .update(listingToRow(current))
        .eq('id', id)
      if (error) {
        setStatusMsg(`Save failed: ${error.message}`)
      } else {
        setStatusMsg(null)
      }
    }, SAVE_DEBOUNCE_MS)
    saveTimers.current.set(id, timer)
  }

  const updateListing = (id, updates) => {
    setListings(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    scheduleSave(id)
  }

  const updatePhotoDate = (id, idx, value) => {
    setListings(prev => prev.map(l => {
      if (l.id !== id) return l
      const photoDates = [...l.photoDates]
      photoDates[idx] = value
      return { ...l, photoDates }
    }))
    scheduleSave(id)
  }

  const updateNeed = (id, idx, value) => {
    setListings(prev => prev.map(l => {
      if (l.id !== id) return l
      const needs = [...l.needs]
      needs[idx] = value
      return { ...l, needs }
    }))
    scheduleSave(id)
  }

  const addListing = async () => {
    const fresh = emptyListing({ createdBy: session.user.id })
    const row = { ...listingToRow(fresh), created_by: session.user.id }
    const { data, error } = await supabase
      .from('listings')
      .insert(row)
      .select('*')
      .single()
    if (error) {
      setStatusMsg(`Could not create listing: ${error.message}`)
      return
    }
    const created = rowToListing(data)
    setListings(prev => [created, ...prev])
    setActiveTab('New')
    setExpandedId(created.id) // open the new card (accordion)
  }

  const deleteListing = async (id) => {
    setConfirmDelete(null)
    const { error } = await supabase.from('listings').delete().eq('id', id)
    if (error) {
      setStatusMsg(`Delete failed: ${error.message}`)
      return
    }
    setListings(prev => prev.filter(l => l.id !== id))
  }

  const exportData = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      listings,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `listing-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const triggerImport = () => { if (fileInputRef.current) fileInputRef.current.click() }

  const handleImport = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const data = JSON.parse(evt.target.result)
        const incoming = Array.isArray(data) ? data : data.listings
        if (!Array.isArray(incoming)) {
          alert('That file does not look like a valid backup.')
          return
        }
        if (!window.confirm(`Import ${incoming.length} listing(s) into Supabase? They will be added to (not replace) what's already there.`)) return

        const rows = incoming.map((item, idx) => {
          const normalized = {
            ...emptyListing(),
            ...item,
            photoDates: Array.isArray(item.photoDates) ? [...item.photoDates, '', '', ''].slice(0, 3) : ['', '', ''],
            needs: Array.isArray(item.needs) ? [...item.needs, '', '', ''].slice(0, 3) : ['', '', ''],
            sortOrder: (item.sortOrder ?? 0) + idx + 1000,
          }
          return { ...listingToRow(normalized), id: makeId(), created_by: session.user.id }
        })

        const { error } = await supabase.from('listings').insert(rows)
        if (error) {
          alert('Import failed: ' + error.message)
          return
        }
        await loadListings()
      } catch (err) {
        alert('Could not parse that file: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const refresh = () => {
    loadListings()
    loadProfilesMap()
  }

  if (view === 'admin') {
    return (
      <div className="app">
        <Admin currentUserId={session.user.id} onBack={() => setView('tracker')} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div className="brand">
            <span className="brand-name">LEGACY REAL ESTATE PARTNERS</span>
            <span className="brand-sub">Listing Tracker</span>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={addListing}>+ Add New Listing</button>
            <button className="btn btn-secondary" onClick={refresh}>Refresh</button>
            <button className="btn btn-secondary" onClick={exportData}>Export</button>
            <button className="btn btn-secondary" onClick={triggerImport}>Import</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        <div className="user-strip">
          <span className="user-info">
            Signed in as <strong>{profile?.email || session.user.email}</strong>
            {profile?.is_admin && <span className="admin-badge">admin</span>}
          </span>
          <div className="user-actions">
            {profile?.is_admin && (
              <button className="btn btn-secondary btn-small" onClick={() => setView('admin')}>Team</button>
            )}
            <button className="btn btn-secondary btn-small" onClick={signOut}>Sign out</button>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
              <span className="tab-badge">{counts[tab]}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {statusMsg && <div className="status-banner">{statusMsg}</div>}

        {loading ? (
          <div className="empty-state">
            <h2>Loading listings…</h2>
          </div>
        ) : visibleListings.length === 0 ? (
          <div className="empty-state">
            <h2>No listings here yet</h2>
            <p>Click "Add New Listing" to get started.</p>
          </div>
        ) : (
          visibleListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              expanded={expandedId === listing.id}
              creatorEmail={profiles[listing.createdBy]}
              onToggle={() => setExpandedId(prev => prev === listing.id ? null : listing.id)}
              onUpdate={(updates) => updateListing(listing.id, updates)}
              onUpdatePhotoDate={(i, v) => updatePhotoDate(listing.id, i, v)}
              onUpdateNeed={(i, v) => updateNeed(listing.id, i, v)}
              onDelete={() => setConfirmDelete(listing)}
            />
          ))
        )}
      </main>

      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>Delete Listing?</h3>
            <p>
              Are you sure you want to delete{' '}
              <strong>{confirmDelete.address || 'this listing'}</strong>?
              This cannot be undone.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteListing(confirmDelete.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ListingCard({
  listing,
  expanded,
  creatorEmail,
  onToggle,
  onUpdate,
  onUpdatePhotoDate,
  onUpdateNeed,
  onDelete,
}) {
  const createdLabel = listing.createdAt
    ? new Date(listing.createdAt).toLocaleDateString()
    : null
  const headerDate = formatHeaderDate(listing.listingDate)

  return (
    <div className={`listing-card ${statusClass(listing.status)}`}>
      <div
        className={`card-header ${!expanded ? 'no-border' : ''}`}
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
      >
        <div className="card-title">
          {listing.address
            ? listing.address
            : <span className="card-title-empty">Untitled listing</span>}
          {' '}
          <span className={`status-pill ${statusPillClass(listing.status)}`}>{listing.status}</span>
        </div>
        {!expanded && headerDate && (
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap', marginRight: '4px' }}>
            {headerDate}
          </span>
        )}
        <div className="card-controls">
          <span className="icon-btn" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
          <button
            className="icon-btn danger"
            title="Delete"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >×</button>
        </div>
      </div>

      {expanded && (
        <>
          {(creatorEmail || createdLabel) && (
            <div className="card-meta">
              {creatorEmail && <>Added by <strong>{creatorEmail}</strong></>}
              {creatorEmail && createdLabel && ' • '}
              {createdLabel && <>{createdLabel}</>}
            </div>
          )}

          <div className="card-body">
            <div className="field-grid">
              <div className="field full">
                <label>Property Address</label>
                <input
                  type="text"
                  value={listing.address}
                  onChange={(e) => onUpdate({ address: e.target.value })}
                  placeholder="123 Main St, City, State"
                />
              </div>

              <div className="field">
                <label>Listing Agent</label>
                <input
                  type="text"
                  value={listing.agent}
                  onChange={(e) => onUpdate({ agent: e.target.value })}
                  placeholder="Agent name"
                />
              </div>

              <div className="field">
                <label>Listing Date</label>
                <input
                  type="date"
                  value={listing.listingDate}
                  onChange={(e) => onUpdate({ listingDate: e.target.value })}
                />
              </div>

              <div className="field full">
                <label>Notes</label>
                <textarea
                  value={listing.notes}
                  onChange={(e) => onUpdate({ notes: e.target.value })}
                  placeholder="Anything important about this listing..."
                />
              </div>

              <div className="field">
                <label>Previous Listing</label>
                <div className="toggle-group">
                  <button type="button" className={`toggle-btn ${listing.previousListing ? 'active' : ''}`} onClick={() => onUpdate({ previousListing: true })}>Yes</button>
                  <button type="button" className={`toggle-btn ${!listing.previousListing ? 'active' : ''}`} onClick={() => onUpdate({ previousListing: false })}>No</button>
                </div>
              </div>

              <div className="field">
                <label>Printed Items</label>
                <div className="toggle-group">
                  <button type="button" className={`toggle-btn ${listing.printedItems ? 'active' : ''}`} onClick={() => onUpdate({ printedItems: true })}>Yes</button>
                  <button type="button" className={`toggle-btn ${!listing.printedItems ? 'active' : ''}`} onClick={() => onUpdate({ printedItems: false })}>No</button>
                </div>
              </div>

              <div className="field full">
                <label>Status</label>
                <select value={listing.status} onChange={(e) => onUpdate({ status: e.target.value })}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="subsection">
              <div className="subsection-title">Photo Dates</div>
              <div className="triple-grid">
                {[0, 1, 2].map(i => (
                  <div className="field" key={i}>
                    <label>Photo Date {i + 1}</label>
                    <input
                      type="date"
                      value={listing.photoDates[i] || ''}
                      onChange={(e) => onUpdatePhotoDate(i, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="subsection">
              <div className="subsection-title">Needs</div>
              <div className="triple-grid">
                {[0, 1, 2].map(i => (
                  <div className="field" key={i}>
                    <label>Need {i + 1}</label>
                    <input
                      type="text"
                      value={listing.needs[i] || ''}
                      onChange={(e) => onUpdateNeed(i, e.target.value)}
                      placeholder={`Need ${i + 1}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default App
