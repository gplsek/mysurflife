import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getAuthHeaders } from './supabaseClient';
import LogoPulse from './design/LogoPulse';
import './ManageUsers.css';

const SKILL_LEVELS = [
  { value: 'beginner',     label: 'Beginner',     desc: 'Learning fundamentals, small waves' },
  { value: 'intermediate', label: 'Intermediate',  desc: 'Comfortable to overhead, working on backhand' },
  { value: 'experienced',  label: 'Experienced',   desc: 'Surfs most conditions confidently' },
  { value: 'expert',       label: 'Expert',        desc: 'Handles large and challenging surf' },
];

const SKILL_COLORS = {
  beginner:     '#22c55e',
  intermediate: '#3b82f6',
  experienced:  '#f59e0b',
  expert:       '#ef4444',
};

function SkillBadge({ level }) {
  if (!level) return <span className="text-muted">—</span>;
  const info = SKILL_LEVELS.find(s => s.value === level);
  return (
    <span
      className="badge-skill"
      style={{ background: SKILL_COLORS[level] + '22', color: SKILL_COLORS[level], borderColor: SKILL_COLORS[level] + '55' }}
    >
      {info?.label ?? level}
    </span>
  );
}

function ProfileEditPanel({ user, onSave, onCancel }) {
  const [draft, setDraft] = useState({
    display_name:   user.profile?.display_name   ?? '',
    skill_level:    user.profile?.skill_level     ?? '',
    home_spot_name: user.profile?.home_spot_name  ?? '',
    home_spot_id:   user.profile?.home_spot_id    ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(user.id, draft);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <tr className="profile-edit-row">
      <td colSpan={6}>
        <form className="profile-edit-panel" onSubmit={handleSubmit}>
          <div className="pep-title">Edit profile — {user.email}</div>

          <div className="pep-fields">
            <div className="pep-field">
              <label>Display name</label>
              <input
                type="text"
                value={draft.display_name}
                onChange={e => setDraft(d => ({ ...d, display_name: e.target.value }))}
                placeholder="e.g. George"
                disabled={saving}
              />
            </div>

            <div className="pep-field">
              <label>Skill level</label>
              <select
                value={draft.skill_level}
                onChange={e => setDraft(d => ({ ...d, skill_level: e.target.value }))}
                disabled={saving}
              >
                <option value="">— not set —</option>
                {SKILL_LEVELS.map(sl => (
                  <option key={sl.value} value={sl.value}>
                    {sl.label} — {sl.desc}
                  </option>
                ))}
              </select>
            </div>

            <div className="pep-field">
              <label>Home break</label>
              <input
                type="text"
                value={draft.home_spot_name}
                onChange={e => setDraft(d => ({ ...d, home_spot_name: e.target.value, home_spot_id: '' }))}
                placeholder="e.g. Rincon, Trestles"
                disabled={saving}
              />
              <span className="pep-hint">Name of the user's primary spot</span>
            </div>
          </div>

          {error && <div className="pep-error">{error}</div>}

          <div className="pep-actions">
            <button type="button" className="pep-btn-cancel" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="pep-btn-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

const ManageUsers = () => {
  const navigate = useNavigate();
  const { isAdmin, user: currentUser, loading: authLoading } = useAuth();

  const [users,          setUsers]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail,    setInviteEmail]    = useState('');
  const [inviteIsAdmin,  setInviteIsAdmin]  = useState(false);
  const [inviting,       setInviting]       = useState(false);
  const [inviteError,    setInviteError]    = useState('');
  const [editingUserId,  setEditingUserId]  = useState(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/');
  }, [isAdmin, authLoading, navigate]);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch('/api/admin/users', { headers });
      if (!response.ok) throw new Error(`Failed to fetch users: ${response.status}`);
      const data = await response.json();
      setUsers(data.users || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin, fetchUsers]);

  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail) { setInviteError('Email is required'); return; }
    try {
      setInviting(true);
      setInviteError('');
      const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
      const response = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: inviteEmail, is_admin: inviteIsAdmin }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to invite user');
      }
      await fetchUsers();
      setInviteEmail('');
      setInviteIsAdmin(false);
      setShowInviteForm(false);
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleToggleAdmin = async (userId, currentIsAdmin) => {
    if (userId === currentUser?.user_id) { alert('You cannot change your own admin status'); return; }
    if (!window.confirm(`${currentIsAdmin ? 'Remove' : 'Grant'} admin privileges?`)) return;
    try {
      const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ is_admin: !currentIsAdmin }),
      });
      if (!response.ok) throw new Error('Failed to update user role');
      setUsers(users.map(u => u.id === userId ? { ...u, is_admin: !currentIsAdmin } : u));
    } catch (err) {
      alert('Failed to update user role: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (userId === currentUser?.user_id) { alert('You cannot delete your own account'); return; }
    if (!window.confirm(`Delete user ${userEmail}? This cannot be undone.`)) return;
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers });
      if (!response.ok) throw new Error('Failed to delete user');
      setUsers(users.filter(u => u.id !== userId));
    } catch (err) {
      alert('Failed to delete user: ' + err.message);
    }
  };

  const handleResendInvite = async (userId, userEmail) => {
    if (!window.confirm(`Resend invite email to ${userEmail}?`)) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/users/${userId}/resend-invite`, { method: 'POST', headers });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed'); }
      alert(`Invite resent to ${userEmail}`);
    } catch (err) {
      alert('Failed to resend invite: ' + err.message);
    }
  };

  const handleResetPassword = async (userId, userEmail) => {
    if (!window.confirm(`Send password reset email to ${userEmail}?`)) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST', headers });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed'); }
      alert(`Password reset email sent to ${userEmail}`);
    } catch (err) {
      alert('Failed to send reset: ' + err.message);
    }
  };

  const handleSaveProfile = async (userId, profileData) => {
    const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
    const response = await fetch(`/api/admin/users/${userId}/profile`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(profileData),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Failed to save profile');
    }
    const data = await response.json();
    setUsers(users.map(u => u.id === userId ? { ...u, profile: data.profile } : u));
    setEditingUserId(null);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (authLoading || loading) {
    return (
      <div className="manage-users-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
        <LogoPulse size={56} />
      </div>
    );
  }

  if (error && !users.length) {
    return (
      <div className="manage-users-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="manage-users-container">
      <header className="users-header">
        <button onClick={() => navigate('/')} className="back-button">← Back</button>
        <h1>Manage Users</h1>
        <button onClick={() => setShowInviteForm(!showInviteForm)} className="invite-button">
          + Invite User
        </button>
      </header>

      <div className="users-content">
        {showInviteForm && (
          <div className="invite-form-card">
            <h2>Invite New User</h2>
            <form onSubmit={handleInviteUser}>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email" type="email" value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="user@example.com" required disabled={inviting}
                />
              </div>
              <div className="form-group-checkbox">
                <input
                  id="isAdmin" type="checkbox" checked={inviteIsAdmin}
                  onChange={e => setInviteIsAdmin(e.target.checked)} disabled={inviting}
                />
                <label htmlFor="isAdmin">Grant Admin Privileges</label>
              </div>
              {inviteError && <div className="invite-error">{inviteError}</div>}
              <div className="form-actions">
                <button type="button" className="cancel-button" disabled={inviting}
                  onClick={() => { setShowInviteForm(false); setInviteEmail(''); setInviteIsAdmin(false); setInviteError(''); }}>
                  Cancel
                </button>
                <button type="submit" className="submit-button" disabled={inviting}>
                  {inviting ? 'Inviting…' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="users-list">
          <div className="users-list-header">
            <h2>All Users ({users.length})</h2>
          </div>

          <div className="users-table">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Skill</th>
                  <th>Home break</th>
                  <th>Last Sign In</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => [
                  <tr key={user.id} className={editingUserId === user.id ? 'row-editing' : ''}>
                    <td>
                      <div className="user-email">
                        {user.profile?.display_name
                          ? <span className="user-display-name">{user.profile.display_name}</span>
                          : null
                        }
                        <span className="user-email-addr">{user.email}</span>
                        {user.id === currentUser?.user_id && (
                          <span className="badge-you">You</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge-role ${user.is_admin ? 'admin' : 'user'}`}>
                        {user.is_admin ? 'Admin' : 'Member'}
                      </span>
                    </td>
                    <td>
                      <SkillBadge level={user.profile?.skill_level} />
                    </td>
                    <td className="text-muted">
                      {user.profile?.home_spot_name || <span className="text-muted">—</span>}
                    </td>
                    <td className="text-muted">{formatDate(user.last_sign_in_at)}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className={`action-button${editingUserId === user.id ? ' active' : ''}`}
                          onClick={() => setEditingUserId(editingUserId === user.id ? null : user.id)}
                          title="Edit profile"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                          className="action-button"
                          disabled={user.id === currentUser?.user_id}
                          title={user.is_admin ? 'Remove admin' : 'Make admin'}
                        >
                          {user.is_admin ? '⬇️' : '⬆️'}
                        </button>
                        {!user.last_sign_in_at ? (
                          <button
                            onClick={() => handleResendInvite(user.id, user.email)}
                            className="action-button"
                            title="Resend invite email"
                          >
                            📨
                          </button>
                        ) : (
                          <button
                            onClick={() => handleResetPassword(user.id, user.email)}
                            className="action-button"
                            disabled={user.id === currentUser?.user_id}
                            title="Send password reset email"
                          >
                            🔑
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="action-button delete"
                          disabled={user.id === currentUser?.user_id}
                          title="Delete user"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>,
                  editingUserId === user.id && (
                    <ProfileEditPanel
                      key={`edit-${user.id}`}
                      user={user}
                      onSave={handleSaveProfile}
                      onCancel={() => setEditingUserId(null)}
                    />
                  ),
                ])}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageUsers;
