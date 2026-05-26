import React, { useEffect, useState } from 'react';
import SwellWindRose, { RoseLegend } from './SwellWindRose';

/**
 * WindowsEditor — interactive editor for a spot's swell + wind windows (B2a).
 *
 * Two grouped tables of numeric rows with a live SwellWindRose preview on top.
 * Saves authoritatively via PUT /api/spots/{slug}/windows (tagged source='human').
 * Permissions are enforced server-side (admin || owner) — see backend M2 gate.
 */

const WIND_CATEGORIES = ['offshore', 'side-offshore', 'cross', 'side-onshore', 'onshore'];

const EMPTY_SWELL = { dir_min: 270, dir_max: 300, weight: 1.0, period_min_sec: 10 };
const EMPTY_WIND  = { category: 'offshore', dir_min: 60, dir_max: 120, max_mph: 15, weight: 1.0 };

const wrap360 = (n) => ((Number(n) || 0) % 360 + 360) % 360;
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function getAuthToken() {
  try {
    const raw = localStorage.getItem('sb-duebzukxycgfkfjezwjq-auth-token');
    if (!raw) return null;
    return JSON.parse(raw).access_token || null;
  } catch {
    return null;
  }
}

export default function WindowsEditor({ slug, initialSwell = [], initialWind = [], onSaved, onCancel }) {
  const [swell, setSwell] = useState(() => initialSwell.map(s => ({
    dir_min: s.dir_min ?? 0,
    dir_max: s.dir_max ?? 0,
    weight: s.weight ?? 1.0,
    period_min_sec: s.period_min_sec ?? 8,
  })));
  const [wind, setWind] = useState(() => initialWind.map(w => ({
    category: w.category ?? 'offshore',
    dir_min: w.dir_min ?? 0,
    dir_max: w.dir_max ?? 0,
    max_mph: w.max_mph ?? 15,
    weight: w.weight ?? 1.0,
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setError(null); }, [swell, wind]);

  const updateSwell = (i, patch) => setSwell(s => s.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const updateWind  = (i, patch) => setWind(w => w.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const removeSwell = (i) => setSwell(s => s.filter((_, idx) => idx !== i));
  const removeWind  = (i) => setWind(w => w.filter((_, idx) => idx !== i));
  const addSwell    = () => setSwell(s => [...s, { ...EMPTY_SWELL }]);
  const addWind     = () => setWind(w => [...w, { ...EMPTY_WIND }]);

  // Normalize before preview + save so live rose matches what gets stored.
  const normalizedSwell = swell.map(s => ({
    dir_min: wrap360(s.dir_min),
    dir_max: wrap360(s.dir_max),
    weight: clamp01(s.weight),
    period_min_sec: Math.max(0, Math.round(Number(s.period_min_sec) || 0)),
  }));
  const normalizedWind = wind.map(w => ({
    category: w.category,
    dir_min: wrap360(w.dir_min),
    dir_max: wrap360(w.dir_max),
    max_mph: Math.max(0, Math.round(Number(w.max_mph) || 0)),
    weight: clamp01(w.weight),
  }));

  const handleSave = async () => {
    const token = getAuthToken();
    if (!token) { setError('Not authenticated'); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/spots/${slug}/windows`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ swell: normalizedSwell, wind: normalizedWind }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || `Save failed (${res.status})`);
      }
      const data = await res.json();
      onSaved?.(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="windows-editor">
      <div className="we-preview">
        <SwellWindRose swell={normalizedSwell} wind={normalizedWind} size={200} />
        <RoseLegend />
        <div className="we-preview-hint">live preview</div>
      </div>

      <Section
        title="Swell windows"
        sub="Arcs the swell arrives FROM. Weight 0–1 sets how strongly each direction counts."
        onAdd={addSwell}
        addLabel="+ Swell"
      >
        {normalizedSwell.length === 0 && <div className="we-empty">No swell windows yet — add one.</div>}
        {swell.map((row, i) => (
          <div className="we-row" key={`s-${i}`}>
            <Field label="From°" hint="0–359">
              <input type="number" min={0} max={359} value={row.dir_min}
                     onChange={e => updateSwell(i, { dir_min: e.target.value })} />
            </Field>
            <Field label="To°" hint="0–359">
              <input type="number" min={0} max={359} value={row.dir_max}
                     onChange={e => updateSwell(i, { dir_max: e.target.value })} />
            </Field>
            <Field label="Weight" hint="0.0–1.0">
              <input type="number" min={0} max={1} step={0.1} value={row.weight}
                     onChange={e => updateSwell(i, { weight: e.target.value })} />
            </Field>
            <Field label="Min period (s)">
              <input type="number" min={0} max={30} value={row.period_min_sec}
                     onChange={e => updateSwell(i, { period_min_sec: e.target.value })} />
            </Field>
            <button className="we-x" aria-label="Remove" onClick={() => removeSwell(i)}>×</button>
          </div>
        ))}
      </Section>

      <Section
        title="Wind windows"
        sub="Direction the wind blows FROM, classified relative to the break."
        onAdd={addWind}
        addLabel="+ Wind"
      >
        {normalizedWind.length === 0 && <div className="we-empty">No wind windows yet — add one.</div>}
        {wind.map((row, i) => (
          <div className="we-row" key={`w-${i}`}>
            <Field label="Category">
              <select value={row.category} onChange={e => updateWind(i, { category: e.target.value })}>
                {WIND_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="From°" hint="0–359">
              <input type="number" min={0} max={359} value={row.dir_min}
                     onChange={e => updateWind(i, { dir_min: e.target.value })} />
            </Field>
            <Field label="To°" hint="0–359">
              <input type="number" min={0} max={359} value={row.dir_max}
                     onChange={e => updateWind(i, { dir_max: e.target.value })} />
            </Field>
            <Field label="Max mph">
              <input type="number" min={0} max={60} value={row.max_mph}
                     onChange={e => updateWind(i, { max_mph: e.target.value })} />
            </Field>
            <Field label="Weight" hint="0.0–1.0">
              <input type="number" min={0} max={1} step={0.1} value={row.weight}
                     onChange={e => updateWind(i, { weight: e.target.value })} />
            </Field>
            <button className="we-x" aria-label="Remove" onClick={() => removeWind(i)}>×</button>
          </div>
        ))}
      </Section>

      {error && <div className="we-error">⚠ {error}</div>}

      <div className="we-actions">
        <button className="sd-chip sd-chip--accent" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save windows'}
        </button>
        {onCancel && (
          <button className="sd-chip" onClick={onCancel} disabled={saving}>Cancel</button>
        )}
      </div>
    </div>
  );
}

function Section({ title, sub, onAdd, addLabel, children }) {
  return (
    <div className="we-section">
      <div className="we-section-head">
        <div>
          <div className="we-section-title">{title}</div>
          <div className="we-section-sub">{sub}</div>
        </div>
        <button className="sd-chip" onClick={onAdd}>{addLabel}</button>
      </div>
      <div className="we-rows">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="we-field">
      <span className="we-field-label">{label}{hint && <span className="we-field-hint"> {hint}</span>}</span>
      {children}
    </label>
  );
}
