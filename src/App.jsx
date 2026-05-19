import { useState, useEffect, useRef } from 'react'

const STORAGE_KEY = 'legacy-listing-tracker-v1'

const STATUSES = ['New', 'In Progress', 'Completed']
const TABS = ['New', 'In Progress', 'Completed', 'All Active']

const statusClass = (status) => {
  if (status === 'In Progress') return 'status-in-progress'
  if (status === 'Completed') return 'status-completed'
  return 'status-new'
}

const statusPillClass = (status) => status.replace(' ', '')

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
}

const emptyListing = () => ({
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
  collapsed: false,
  createdAt: new Date().toISOString(),
})

function App() {
  const [listings, setListings] = useState([])
  const [activeTab, setActiveTab] = useState('New')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) setListings(parsed)
      } catch (e) {
        console.error('Failed to load saved listings', e)
      }
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (loaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(listings))
    }
  }, [listings, loaded])

  const counts = {
    'New': listings.filter(l => l.status === 'New').length,
    'In Progress': listings.filter(l => l.status === 'In Progress').length,
    'Completed': listings.filter(l => l.status === 'Completed').length,
    'All Active': listings.filter(l => l.status !== 'Completed').length,
  }

  const visibleListings = activeTab === 'All Active'
    ? listings.filter(l => l.status !== 'Completed')
    : listings.filter(l => l.status === activeTab)

  const updateListing = (id, updates) => {
    setListings(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
  }

  const updatePhotoDate = (id, idx, value) => {
    setListings(prev => prev.map(l => {
      if (l.id !== id) return l
      const photoDates = [...l.photoDates]
      photoDates[idx] = value
      return { ...l, photoDates }
    }))
  }

  const updateNeed = (id, idx, value) => {
    setListings(prev => prev.map(l => {
      if (l.id !== id) return l
      const needs = [...l.needs]
      needs[idx] = value
      return { ...l, needs }
    }))
  }

  const addListing = () => {
    const fresh = emptyListing()
    setListings(prev => [fresh, ...prev])
    setActiveTab('New')
  }

  const deleteListing = (id) => {
    setListings(prev => prev.filter(l => l.id !== id))
    setConfirmDelete(null)
  }

  const exportData = () => {
    const payload = {
      version: 1,
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

  const triggerImport = () => {
    if (fileInputRef.current) fileInputRef.current.click()
  }

  const handleImport = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result)
        const incoming = Array.isArray(data) ? data : data.listings
        if (!Array.isArray(incoming)) {
          alert('That file does not look like a valid backup.')
          return
        }
        if (!window.confirm(`Import ${incoming.length} listing(s)? This will replace your current data.`)) return
        const normalized = incoming.map(item => ({
          ...emptyListing(),
          ...item,
          id: item.id || makeId(),
          photoDates: Array.isArray(item.photoDates) ? [...item.photoDates, '', '', ''].slice(0, 3) : ['', '', ''],
          needs: Array.isArray(item.needs) ? [...item.needs, '', '', ''].slice(0, 3) : ['', '', ''],
        }))
        setListings(normalized)
      } catch (err) {
        alert('Could not parse that file: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const moveListing = (id, direction) => {
    setListings(prev => {
      const activeIds = prev.filter(l => l.status !== 'Completed').map(l => l.id)
      const activeIdx = activeIds.indexOf(id)
      if (activeIdx === -1) return prev
      const swapWith = activeIds[activeIdx + direction]
      if (!swapWith) return prev
      const posA = prev.findIndex(l => l.id === id)
      const posB = prev.findIndex(l => l.id === swapWith)
      const next = [...prev]
      ;[next[posA], next[posB]] = [next[posB], next[posA]]
      return next
    })
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
        {visibleListings.length === 0 ? (
          <div className="empty-state">
            <h2>No listings here yet</h2>
            <p>Click "Add New Listing" to get started.</p>
          </div>
        ) : (
          visibleListings.map((listing, idx) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              activeTab={activeTab}
              isFirst={idx === 0}
              isLast={idx === visibleListings.length - 1}
              onUpdate={(updates) => updateListing(listing.id, updates)}
              onUpdatePhotoDate={(i, v) => updatePhotoDate(listing.id, i, v)}
              onUpdateNeed={(i, v) => updateNeed(listing.id, i, v)}
              onDelete={() => setConfirmDelete(listing)}
              onMoveUp={() => moveListing(listing.id, -1)}
              onMoveDown={() => moveListing(listing.id, 1)}
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
  activeTab,
  isFirst,
  isLast,
  onUpdate,
  onUpdatePhotoDate,
  onUpdateNeed,
  onDelete,
  onMoveUp,
  onMoveDown,
}) {
  const showReorder = activeTab === 'All Active'
  const collapsed = !!listing.collapsed

  return (
    <div className={`listing-card ${statusClass(listing.status)}`}>
      <div className={`card-header ${collapsed ? 'no-border' : ''}`}>
        <div className="card-title">
          {listing.address
            ? listing.address
            : <span className="card-title-empty">Untitled listing</span>}
          {' '}
          <span className={`status-pill ${statusPillClass(listing.status)}`}>{listing.status}</span>
        </div>
        <div className="card-controls">
          {showReorder && (
            <>
              <button
                className="icon-btn"
                title="Move up"
                onClick={onMoveUp}
                disabled={isFirst}
              >↑</button>
              <button
                className="icon-btn"
                title="Move down"
                onClick={onMoveDown}
                disabled={isLast}
              >↓</button>
            </>
          )}
          <button
            className="icon-btn"
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => onUpdate({ collapsed: !collapsed })}
          >{collapsed ? '▾' : '▴'}</button>
          <button
            className="icon-btn danger"
            title="Delete"
            onClick={onDelete}
          >×</button>
        </div>
      </div>

      {!collapsed && (
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
                <button
                  type="button"
                  className={`toggle-btn ${listing.previousListing ? 'active' : ''}`}
                  onClick={() => onUpdate({ previousListing: true })}
                >Yes</button>
                <button
                  type="button"
                  className={`toggle-btn ${!listing.previousListing ? 'active' : ''}`}
                  onClick={() => onUpdate({ previousListing: false })}
                >No</button>
              </div>
            </div>

            <div className="field">
              <label>Printed Items</label>
              <div className="toggle-group">
                <button
                  type="button"
                  className={`toggle-btn ${listing.printedItems ? 'active' : ''}`}
                  onClick={() => onUpdate({ printedItems: true })}
                >Yes</button>
                <button
                  type="button"
                  className={`toggle-btn ${!listing.printedItems ? 'active' : ''}`}
                  onClick={() => onUpdate({ printedItems: false })}
                >No</button>
              </div>
            </div>

            <div className="field full">
              <label>Status</label>
              <select
                value={listing.status}
                onChange={(e) => onUpdate({ status: e.target.value })}
              >
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
      )}
    </div>
  )
}

export default App
