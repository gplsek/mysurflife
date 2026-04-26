import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { getAuthHeaders } from './supabaseClient';
import LogoPulse from './design/LogoPulse';
import './ManageStorms.css';

const OCEAN_OPTIONS = [
  { id: 'north-pacific',  label: 'North Pacific' },
  { id: 'north-atlantic', label: 'North Atlantic' },
  { id: 'east-pacific',   label: 'East Pacific' },
];

const DEFAULT_CONFIG = {
  min_pressure_mb: 1020,
  min_wind_kts:    0,
  include_highs:   false,
  oceans:          ['north-pacific', 'north-atlantic', 'east-pacific'],
};

export default function ManageStorms() {
  const navigate   = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [config,  setConfig]  = useState(null);
  const [draft,   setDraft]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);
  const [saved,   setSaved]   = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/');
  }, [isAdmin, authLoading, navigate]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch('/api/admin/storms/config', { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setConfig(data.config);
      setDraft({ ...DEFAULT_CONFIG, ...data.config });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) fetchConfig(); }, [isAdmin, fetchConfig]);

  const handleOceanToggle = (id) => {
    setDraft(d => {
      const next = d.oceans.includes(id)
        ? d.oceans.filter(o => o !== id)
        : [...d.oceans, id];
      return { ...d, oceans: next };
    });
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const params = new URLSearchParams({
        min_pressure_mb: draft.min_pressure_mb,
        min_wind_kts:    draft.min_wind_kts,
        include_highs:   draft.include_highs,
        oceans:          draft.oceans.join(','),
      });
      const r = await fetch(`/api/storms/active?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setPreview(data);
    } catch (e) {
      setPreview({ error: e.message });
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!draft.oceans.length) {
      setError('Select at least one ocean basin.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const headers = await getAuthHeaders();
      const r = await fetch('/api/admin/storms/config', {
        method:  'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(draft),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.detail || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setConfig(data.config);
      setDraft({ ...DEFAULT_CONFIG, ...data.config });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const isDirty = draft && config && (
    draft.min_pressure_mb !== config.min_pressure_mb ||
    draft.min_wind_kts    !== config.min_wind_kts    ||
    draft.include_highs   !== config.include_highs   ||
    JSON.stringify(draft.oceans.slice().sort()) !== JSON.stringify((config.oceans || []).slice().sort())
  );

  if (authLoading || loading) {
    return (
      <div className="ms-loading">
        <LogoPulse size={48} />
      </div>
    );
  }

  return (
    <div className="ms-root">
      <header className="ms-header">
        <button className="ms-back" onClick={() => navigate('/')}>← Map</button>
        <h1 className="ms-title">Storm Filters</h1>
        <div style={{ width: 60 }} />
      </header>

      <div className="ms-content">
        <p className="ms-desc">
          Controls which systems appear as storm markers on the map.
          Changes take effect immediately on the next map load.
        </p>

        {error && <div className="ms-error">{error}</div>}

        {draft && (
          <div className="ms-card">

            {/* Pressure threshold */}
            <div className="ms-field">
              <label className="ms-label">
                Max central pressure
                <span className="ms-value">{draft.min_pressure_mb} mb</span>
              </label>
              <p className="ms-hint">
                Only show systems with pressure ≤ this value. Lower pressure = stronger storm.
                1020 mb shows most low-pressure systems; 1000 mb shows only intense ones.
              </p>
              <input
                type="range"
                min={980} max={1030} step={2}
                value={draft.min_pressure_mb}
                onChange={e => setDraft(d => ({ ...d, min_pressure_mb: +e.target.value }))}
                className="ms-slider"
              />
              <div className="ms-slider-labels">
                <span>980 mb (intense)</span>
                <span>1030 mb (very weak)</span>
              </div>
            </div>

            {/* Min wind */}
            <div className="ms-field">
              <label className="ms-label">
                Minimum wind speed
                <span className="ms-value">{draft.min_wind_kts === 0 ? 'any' : `${draft.min_wind_kts} kt`}</span>
              </label>
              <p className="ms-hint">
                0 = include all systems regardless of wind data (recommended — many bulletins don't report explicit wind speeds).
                34 kt = gale threshold, 48 kt = storm force.
              </p>
              <input
                type="range"
                min={0} max={64} step={2}
                value={draft.min_wind_kts}
                onChange={e => setDraft(d => ({ ...d, min_wind_kts: +e.target.value }))}
                className="ms-slider"
              />
              <div className="ms-slider-labels">
                <span>0 kt (any)</span>
                <span>64 kt (hurricane)</span>
              </div>
            </div>

            {/* Ocean basins */}
            <div className="ms-field">
              <label className="ms-label">Active ocean basins</label>
              <p className="ms-hint">Which NOAA High Seas bulletins to pull from.</p>
              <div className="ms-toggles">
                {OCEAN_OPTIONS.map(({ id, label }) => (
                  <button
                    key={id}
                    className={`ms-toggle${draft.oceans.includes(id) ? ' on' : ''}`}
                    onClick={() => handleOceanToggle(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Include highs */}
            <div className="ms-field ms-field-row">
              <div>
                <label className="ms-label">Include HIGH pressure systems</label>
                <p className="ms-hint">Highs are usually not surf-relevant. Off by default.</p>
              </div>
              <button
                className={`ms-pip-btn${draft.include_highs ? ' on' : ''}`}
                onClick={() => setDraft(d => ({ ...d, include_highs: !d.include_highs }))}
                aria-pressed={draft.include_highs}
              >
                <span className="ms-pip-track">
                  <span className="ms-pip-thumb" />
                </span>
              </button>
            </div>

            {/* Preview */}
            <div className="ms-preview-row">
              <button className="ms-btn-secondary" onClick={handlePreview} disabled={previewing}>
                {previewing ? 'Fetching…' : 'Preview results'}
              </button>
              {preview && !preview.error && (
                <span className="ms-preview-count">
                  {preview.count} storm{preview.count !== 1 ? 's' : ''} would appear
                </span>
              )}
              {preview?.error && (
                <span className="ms-preview-err">{preview.error}</span>
              )}
            </div>

            {preview && !preview.error && preview.storms?.length > 0 && (
              <div className="ms-preview-list">
                {preview.storms.map(s => (
                  <div key={s.id} className={`ms-storm-row wt-${s.warning_tier}`}>
                    <span className="ms-storm-name">{s.name}</span>
                    <span className="ms-storm-meta">
                      {s.pressure_mb ? `${s.pressure_mb} mb` : '— mb'}
                      {s.wind_kts ? ` · ${s.wind_kts} kt` : ''}
                      {' · '}{s.lat.toFixed(1)}°N {Math.abs(s.lon).toFixed(1)}°W
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="ms-actions">
              <button
                className="ms-btn-ghost"
                onClick={() => setDraft({ ...DEFAULT_CONFIG, ...config })}
                disabled={!isDirty || saving}
              >
                Reset
              </button>
              <button
                className={`ms-btn-primary${saved ? ' saved' : ''}`}
                onClick={handleSave}
                disabled={!isDirty || saving}
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
