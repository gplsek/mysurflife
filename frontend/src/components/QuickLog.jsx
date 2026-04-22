import React, { useState, useEffect, useRef } from 'react';
import { getAuthHeaders } from '../supabaseClient';

const SIZE_OPTIONS = [
  { value: 'knee',     label: 'Knee' },
  { value: 'waist',    label: 'Waist' },
  { value: 'chest',    label: 'Chest' },
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'head',     label: 'Head' },
  { value: 'overhead', label: 'OH' },
  { value: 'doh',      label: 'DOH' },
  { value: 'toh',      label: 'TOH' },
  { value: 'plus',     label: 'Plus' },
];

const WIND_OPTIONS = [
  { value: 'glassy',        label: 'Glassy' },
  { value: 'light_offshore', label: 'Lt Offshore' },
  { value: 'offshore',      label: 'Offshore' },
  { value: 'light_onshore', label: 'Lt Onshore' },
  { value: 'onshore',       label: 'Onshore' },
  { value: 'howling',       label: 'Howling' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function PillGroup({ options, value, onChange }) {
  return (
    <div className="ql-pills">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`ql-pill ${value === o.value ? 'selected' : ''}`}
          onClick={() => onChange(o.value === value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function QualityPicker({ value, onChange }) {
  return (
    <div className="ql-quality">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          type="button"
          className={`ql-q-dot ${value >= n ? 'filled' : ''}`}
          onClick={() => onChange(n === value ? null : n)}
          title={n}
        />
      ))}
      {value && <span className="ql-q-label">{value}/10</span>}
    </div>
  );
}

export default function QuickLog({ open, onClose, onLogged }) {
  const [spots, setSpots] = useState([]);
  const [spotQuery, setSpotQuery] = useState('');
  const [spotId, setSpotId] = useState('');
  const [spotName, setSpotName] = useState('');
  const [showSpotList, setShowSpotList] = useState(false);

  const [date, setDate] = useState(today());
  const [startTime, setStartTime] = useState('');
  const [durationMin, setDurationMin] = useState(90);

  const [size, setSize] = useState(null);
  const [quality, setQuality] = useState(null);
  const [wind, setWind] = useState(null);
  const [waves, setWaves] = useState('');
  const [board, setBoard] = useState('');
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const spotInputRef = useRef(null);

  // Load spots once on open
  useEffect(() => {
    if (!open) return;
    fetch('/api/surf-spots')
      .then(r => r.json())
      .then(d => setSpots(d.spots || d || []))
      .catch(() => {});
    // Focus spot input
    setTimeout(() => spotInputRef.current?.focus(), 80);
  }, [open]);

  const filteredSpots = spots.filter(s =>
    spotQuery.length > 0 &&
    s.name?.toLowerCase().includes(spotQuery.toLowerCase())
  ).slice(0, 8);

  const selectSpot = (s) => {
    setSpotId(s.slug);
    setSpotName(s.name);
    setSpotQuery(s.name);
    setShowSpotList(false);
  };

  const canSubmit = spotId && spotName && date;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_id: spotId,
          spot_name: spotName,
          session_date: date,
          start_time: startTime || undefined,
          duration_min: durationMin || undefined,
          perceived_size: size || undefined,
          perceived_quality: quality || undefined,
          perceived_wind: wind || undefined,
          waves_caught: waves ? parseInt(waves, 10) : undefined,
          board_display: board || undefined,
          perceived_note: note || undefined,
          log_method: 'manual',
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to log session');
      onLogged?.(data.session);
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    // Reset form
    setSpotQuery(''); setSpotId(''); setSpotName('');
    setDate(today()); setStartTime(''); setDurationMin(90);
    setSize(null); setQuality(null); setWind(null);
    setWaves(''); setBoard(''); setNote('');
    setError('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="ql-backdrop" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="ql-modal">
        <div className="ql-header">
          <span className="ql-title">Log session</span>
          <button className="ql-close" onClick={handleClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13"/>
            </svg>
          </button>
        </div>

        <form className="ql-form" onSubmit={handleSubmit}>

          {/* Spot */}
          <div className="ql-field">
            <label className="ql-label">Spot</label>
            <div className="ql-spot-wrap">
              <input
                ref={spotInputRef}
                className="ql-input"
                placeholder="Search spots…"
                value={spotQuery}
                onChange={e => { setSpotQuery(e.target.value); setSpotId(''); setSpotName(''); setShowSpotList(true); }}
                onFocus={() => setShowSpotList(true)}
                autoComplete="off"
              />
              {showSpotList && filteredSpots.length > 0 && (
                <div className="ql-spot-list">
                  {filteredSpots.map(s => (
                    <button key={s.slug} type="button" className="ql-spot-item" onClick={() => selectSpot(s)}>
                      <span className="ql-spot-name">{s.name}</span>
                      <span className="ql-spot-region">{s.subregion || s.region}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Date + time + duration */}
          <div className="ql-row3">
            <div className="ql-field">
              <label className="ql-label">Date</label>
              <input type="date" className="ql-input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="ql-field">
              <label className="ql-label">Start</label>
              <input type="time" className="ql-input" value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="optional" />
            </div>
            <div className="ql-field">
              <label className="ql-label">Duration</label>
              <div className="ql-dur-wrap">
                <input
                  type="range" min={30} max={300} step={15}
                  value={durationMin} onChange={e => setDurationMin(Number(e.target.value))}
                  className="ql-slider"
                />
                <span className="ql-dur-label">
                  {Math.floor(durationMin / 60) > 0 ? `${Math.floor(durationMin / 60)}h ` : ''}
                  {durationMin % 60 > 0 ? `${durationMin % 60}m` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Size */}
          <div className="ql-field">
            <label className="ql-label">Size</label>
            <PillGroup options={SIZE_OPTIONS} value={size} onChange={setSize} />
          </div>

          {/* Quality */}
          <div className="ql-field">
            <label className="ql-label">Quality</label>
            <QualityPicker value={quality} onChange={setQuality} />
          </div>

          {/* Wind */}
          <div className="ql-field">
            <label className="ql-label">Wind</label>
            <PillGroup options={WIND_OPTIONS} value={wind} onChange={setWind} />
          </div>

          {/* Optional extras */}
          <div className="ql-row2">
            <div className="ql-field">
              <label className="ql-label">Waves caught</label>
              <input type="number" min={0} max={200} className="ql-input ql-input-sm"
                value={waves} onChange={e => setWaves(e.target.value)} placeholder="optional" />
            </div>
            <div className="ql-field">
              <label className="ql-label">Board</label>
              <input type="text" className="ql-input ql-input-sm"
                value={board} onChange={e => setBoard(e.target.value)} placeholder="6'2 shortboard" />
            </div>
          </div>

          {/* Note */}
          <div className="ql-field">
            <label className="ql-label">Note <span className="ql-optional">optional</span></label>
            <textarea className="ql-input ql-textarea" rows={2}
              value={note} onChange={e => setNote(e.target.value)}
              placeholder="Best wave, conditions, anything notable…"
            />
          </div>

          {error && <div className="ql-error">{error}</div>}

          <div className="ql-footer">
            <button type="button" className="ql-btn-ghost" onClick={handleClose}>Cancel</button>
            <button type="submit" className="ql-btn-submit" disabled={!canSubmit || submitting}>
              {submitting ? 'Logging…' : 'Log session'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
