import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getAuthHeaders } from './supabaseClient';
import LogoPulse from './design/LogoPulse';
import './ManageUsers.css';

const ManageUsers = () => {
  const navigate = useNavigate();
  const { isAdmin, user: currentUser, loading: authLoading } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteIsAdmin, setInviteIsAdmin] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/');
    }
  }, [isAdmin, authLoading, navigate]);

  // Fetch users
  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();

      const response = await fetch('/api/admin/users', { headers });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.status}`);
      }

      const data = await response.json();
      setUsers(data.users || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();

    if (!inviteEmail) {
      setInviteError('Email is required');
      return;
    }

    try {
      setInviting(true);
      setInviteError('');

      const headers = {
        ...(await getAuthHeaders()),
        'Content-Type': 'application/json',
      };

      const response = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: inviteEmail,
          is_admin: inviteIsAdmin,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to invite user');
      }

      // Refresh user list
      await fetchUsers();

      // Reset form
      setInviteEmail('');
      setInviteIsAdmin(false);
      setShowInviteForm(false);
    } catch (err) {
      console.error('Error inviting user:', err);
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleToggleAdmin = async (userId, currentIsAdmin) => {
    if (userId === currentUser?.user_id) {
      alert('You cannot change your own admin status');
      return;
    }

    if (!window.confirm(`Are you sure you want to ${currentIsAdmin ? 'remove' : 'grant'} admin privileges?`)) {
      return;
    }

    try {
      const headers = {
        ...(await getAuthHeaders()),
        'Content-Type': 'application/json',
      };

      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          is_admin: !currentIsAdmin,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update user role');
      }

      // Update local state
      setUsers(users.map(u =>
        u.id === userId ? { ...u, is_admin: !currentIsAdmin } : u
      ));
    } catch (err) {
      console.error('Error updating user role:', err);
      alert('Failed to update user role: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (userId === currentUser?.user_id) {
      alert('You cannot delete your own account');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete user ${userEmail}? This action cannot be undone.`)) {
      return;
    }

    try {
      const headers = await getAuthHeaders();

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to delete user');
      }

      // Remove from local state
      setUsers(users.filter(u => u.id !== userId));
    } catch (err) {
      console.error('Error deleting user:', err);
      alert('Failed to delete user: ' + err.message);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
        <button onClick={() => navigate('/')} className="back-button">
          ← Back
        </button>
        <h1>👥 Manage Users</h1>
        <button
          onClick={() => setShowInviteForm(!showInviteForm)}
          className="invite-button"
        >
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
                  id="email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  disabled={inviting}
                />
              </div>

              <div className="form-group-checkbox">
                <input
                  id="isAdmin"
                  type="checkbox"
                  checked={inviteIsAdmin}
                  onChange={(e) => setInviteIsAdmin(e.target.checked)}
                  disabled={inviting}
                />
                <label htmlFor="isAdmin">Grant Admin Privileges</label>
              </div>

              {inviteError && (
                <div className="invite-error">{inviteError}</div>
              )}

              <div className="form-actions">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteForm(false);
                    setInviteEmail('');
                    setInviteIsAdmin(false);
                    setInviteError('');
                  }}
                  className="cancel-button"
                  disabled={inviting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="submit-button"
                  disabled={inviting}
                >
                  {inviting ? 'Inviting...' : 'Send Invite'}
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
                  <th>Created</th>
                  <th>Last Sign In</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-email">
                        {user.email}
                        {user.id === currentUser?.user_id && (
                          <span className="badge-you">You</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge-role ${user.is_admin ? 'admin' : 'user'}`}>
                        {user.is_admin ? '👑 Admin' : 'User'}
                      </span>
                    </td>
                    <td className="text-muted">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="text-muted">
                      {formatDate(user.last_sign_in_at)}
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          onClick={() => handleToggleAdmin(user.id, user.is_admin)}
                          className="action-button"
                          disabled={user.id === currentUser?.user_id}
                          title={user.is_admin ? 'Remove admin' : 'Make admin'}
                        >
                          {user.is_admin ? '⬇️' : '⬆️'}
                        </button>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageUsers;
