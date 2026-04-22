import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getAuthHeaders } from './supabaseClient';
import LogoPulse from './design/LogoPulse';
import './ManagePersonas.css';

const ManagePersonas = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingPersona, setEditingPersona] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/');
    }
  }, [isAdmin, authLoading, navigate]);

  // Fetch personas
  useEffect(() => {
    fetchPersonas();
  }, []);

  const fetchPersonas = async () => {
    console.log('🔍 Fetching personas...');
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      console.log('📡 Request headers:', headers);

      const response = await fetch('/api/admin/personas', { headers });
      console.log('📥 Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`Failed to fetch personas: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Personas data:', data);
      console.log('📋 Personas array:', data.personas);

      setPersonas(data.personas || []);
      setError(null);
    } catch (err) {
      console.error('❌ Error fetching personas:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (persona) => {
    setEditingPersona({ ...persona });
    setSaveStatus('');
  };

  const handleCancel = () => {
    setEditingPersona(null);
    setSaveStatus('');
  };

  const handleSave = async () => {
    if (!editingPersona) return;

    try {
      setSaveStatus('saving');
      const headers = {
        ...(await getAuthHeaders()),
        'Content-Type': 'application/json',
      };

      const response = await fetch(`/api/admin/personas/${editingPersona.slug}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: editingPersona.name,
          description: editingPersona.description,
          system_prompt: editingPersona.system_prompt,
          model: editingPersona.model,
          max_tokens: editingPersona.max_tokens,
          temperature: editingPersona.temperature,
          is_active: editingPersona.is_active,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save: ${response.status}`);
      }

      const result = await response.json();

      // Update local state
      setPersonas(personas.map(p =>
        p.slug === editingPersona.slug ? result.persona : p
      ));

      setSaveStatus('saved');
      setTimeout(() => {
        setEditingPersona(null);
        setSaveStatus('');
      }, 1500);

    } catch (err) {
      console.error('Error saving persona:', err);
      setSaveStatus('error');
      setError(err.message);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="manage-personas-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0' }}>
        <LogoPulse size={56} />
      </div>
    );
  }

  if (error && !personas.length) {
    return (
      <div className="manage-personas-container">
        <div className="error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="manage-personas-container">
      <header className="personas-header">
        <button onClick={() => navigate('/')} className="back-button">
          ← Back
        </button>
        <h1>🤖 Manage AI Personas</h1>
        <div style={{ width: '80px' }} />
      </header>

      <div className="personas-content">
        <div className="personas-intro">
          <p>
            AI personas are specialized agents that analyze surf spots and conditions.
            Each persona has a unique system prompt that defines its expertise and output format.
          </p>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="personas-list">
          {personas.map((persona) => (
            <div key={persona.id} className="persona-card">
              <div className="persona-header">
                <div>
                  <h2>{persona.name}</h2>
                  <span className="persona-slug">{persona.slug}</span>
                  <span className={`persona-status ${persona.is_active ? 'active' : 'inactive'}`}>
                    {persona.is_active ? '● Active' : '○ Inactive'}
                  </span>
                </div>
                <button
                  onClick={() => handleEdit(persona)}
                  className="edit-button"
                  disabled={editingPersona?.slug === persona.slug}
                >
                  ✏️ Edit
                </button>
              </div>

              <div className="persona-details">
                <div className="detail-section">
                  <h3>Description</h3>
                  <p>{persona.description}</p>
                </div>

                <div className="detail-section">
                  <h3>Configuration</h3>
                  <div className="config-grid">
                    <div className="config-item">
                      <span className="config-label">Model:</span>
                      <span className="config-value">{persona.model}</span>
                    </div>
                    <div className="config-item">
                      <span className="config-label">Max Tokens:</span>
                      <span className="config-value">{persona.max_tokens}</span>
                    </div>
                    <div className="config-item">
                      <span className="config-label">Temperature:</span>
                      <span className="config-value">{persona.temperature}</span>
                    </div>
                  </div>
                </div>

                <div className="detail-section">
                  <h3>System Prompt</h3>
                  <pre className="system-prompt">{persona.system_prompt}</pre>
                </div>

                <div className="persona-meta">
                  Last updated: {new Date(persona.updated_at).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {editingPersona && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Persona: {editingPersona.name}</h2>
              <button onClick={handleCancel} className="close-button">✕</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  value={editingPersona.name}
                  onChange={(e) => setEditingPersona({...editingPersona, name: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={editingPersona.description}
                  onChange={(e) => setEditingPersona({...editingPersona, description: e.target.value})}
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label>System Prompt</label>
                <textarea
                  value={editingPersona.system_prompt}
                  onChange={(e) => setEditingPersona({...editingPersona, system_prompt: e.target.value})}
                  rows={12}
                  className="system-prompt-editor"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Model</label>
                  <select
                    value={editingPersona.model}
                    onChange={(e) => setEditingPersona({...editingPersona, model: e.target.value})}
                  >
                    <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                    <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                    <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Max Tokens</label>
                  <input
                    type="number"
                    value={editingPersona.max_tokens}
                    onChange={(e) => setEditingPersona({...editingPersona, max_tokens: parseInt(e.target.value)})}
                    min={256}
                    max={4096}
                  />
                </div>

                <div className="form-group">
                  <label>Temperature</label>
                  <input
                    type="number"
                    value={editingPersona.temperature}
                    onChange={(e) => setEditingPersona({...editingPersona, temperature: parseFloat(e.target.value)})}
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editingPersona.is_active}
                    onChange={(e) => setEditingPersona({...editingPersona, is_active: e.target.checked})}
                  />
                  <span>Active</span>
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={handleCancel} className="cancel-button">
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="save-button"
                disabled={saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved!' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagePersonas;
