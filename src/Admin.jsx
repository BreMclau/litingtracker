import { useEffect, useState } from 'react'
import { supabase, createInviteClient } from './supabase'

function Admin({ currentUserId, onBack }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const loadProfiles = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, is_admin, created_at')
      .order('created_at', { ascending: true })
    if (error) {
      setError(error.message)
    } else {
      setProfiles(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  const inviteUser = async (e) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const invite = createInviteClient()
      const { data, error } = await invite.auth.signUp({ email, password })
      if (error) throw error
      if (data.user) {
        setMessage(
          data.session
            ? `Account created for ${email}. Share the password with them — they can sign in now.`
            : `Invite sent to ${email}. They must confirm their email before signing in.`
        )
        setEmail('')
        setPassword('')
        setTimeout(loadProfiles, 800)
      }
    } catch (err) {
      setError(err.message || 'Could not create account.')
    } finally {
      setBusy(false)
    }
  }

  const toggleAdmin = async (profile) => {
    const next = !profile.is_admin
    if (profile.id === currentUserId && !next) {
      if (!window.confirm('Remove admin from yourself? You may lose access to this page.')) return
    }
    const { error } = await supabase
      .from('profiles')
      .update({ is_admin: next })
      .eq('id', profile.id)
    if (error) {
      setError(error.message)
    } else {
      setProfiles(prev => prev.map(p => p.id === profile.id ? { ...p, is_admin: next } : p))
    }
  }

  return (
    <div className="admin-screen">
      <div className="admin-header">
        <button className="btn btn-ghost" onClick={onBack}>← Back to listings</button>
        <h2>Team Management</h2>
      </div>

      <section className="admin-section">
        <h3>Invite a Team Member</h3>
        <form onSubmit={inviteUser} className="invite-form">
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="teammate@legacyrep.co"
            />
          </div>
          <div className="field">
            <label>Temporary Password</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="At least 6 characters"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create Account'}
          </button>
          {error && <div className="auth-error">{error}</div>}
          {message && <div className="auth-message">{message}</div>}
        </form>
        <p className="admin-help">
          Share the email + password with the team member. They can sign in,
          and (if you have email confirmation turned on in Supabase) confirm via the
          email they receive.
        </p>
      </section>

      <section className="admin-section">
        <h3>Team Members</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="muted">No team members yet.</p>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Admin</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <tr key={p.id}>
                    <td>
                      {p.email}
                      {p.id === currentUserId && <span className="you-badge">you</span>}
                    </td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td>{p.is_admin ? 'Yes' : 'No'}</td>
                    <td>
                      <button className="btn btn-ghost btn-small" onClick={() => toggleAdmin(p)}>
                        {p.is_admin ? 'Revoke admin' : 'Make admin'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default Admin
