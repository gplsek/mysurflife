import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import LogoPulse from '../design/LogoPulse';

function NowStat({ label, value, unit, sub, accent }) {
  return (
    <div className={`now-stat ${accent ? 'accent' : ''}`}>
      <div className="now-label">{label}</div>
      <div className="now-value">
        <span className="num">{value ?? '—'}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="now-sub">{sub}</div>}
    </div>
  );
}

function ForecastTab({ data, loading }) {
  if (loading) {
    return (
      <div className="forecast-tab" style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
        <LogoPulse size={40} />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="forecast-tab">
        <div className="empty-state">No forecast data available.</div>
      </div>
    );
  }
  const max = Math.max(...data.map(f => f.swell_height || 0), 1);
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const today = new Date().getDay();

  return (
    <div className="forecast-tab">
      <div className="chart-label">
        <span>Swell height — next 7 days</span>
        <span className="mono-tiny">{max.toFixed(1)} ft max</span>
      </div>
      <div className="forecast-chart">
        {data.map((f, i) => {
          const h = ((f.swell_height || 0) / max) * 100;
          const score = f.score || 0;
          const color = score >= 4 ? 'var(--fire)' : score >= 2.5 ? 'var(--accent)' : 'var(--muted-2)';
          return (
            <div
              key={i}
              className="bar"
              style={{ height: `${h}%`, background: color }}
              title={`${f.swell_height?.toFixed(1) || '—'}ft`}
            />
          );
        })}
      </div>
      <div className="day-labels">
        {days.map((d, i) => (
          <div key={i} className={`day-label ${i === today ? 'today' : ''}`}>
            <span>{d}</span>
            <span className="mono-tiny">{data[i * 24]?.swell_height?.toFixed(0) || '—'}ft</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SpotDetailPanel({ spot, onClose }) {
  const [tab, setTab] = useState('forecast');
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [buoyData, setBuoyData] = useState(null);

  useEffect(() => {
    if (!spot) return;
    setForecastLoading(true);
    setForecast(null);
    setBuoyData(null);

    // Fetch current conditions from nearest buoy
    const buoyId = spot.primary_buoy_id;
    if (buoyId) {
      fetch(`/api/buoy-status/${buoyId}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setBuoyData(d))
        .catch(() => null);
    }

    // Fetch forecast timeline (may not exist yet)
    fetch(`/api/surf-spots/${spot.slug}/forecast-timeline`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setForecast(d.timeline || []))
      .catch(() => null)
      .finally(() => setForecastLoading(false));
  }, [spot?.slug]);

  if (!spot) return null;

  const currentWvht = buoyData?.wvht_ft ?? spot?.current_wvht_ft;
  const currentDpd = buoyData?.dpd_s ?? spot?.current_dpd_s;
  const currentDir = buoyData?.mwd_deg ?? spot?.current_mwd_deg;
  const currentWind = buoyData?.wspd_mph ?? spot?.wind_speed_mph;

  return (
    <div className="panel spot-detail">
      <div className="panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">
            <span className={`dot rating-${spot.rating_class || 3}`} />
            {spot.rating_label || 'LIVE CONDITIONS'}
          </div>
          <h2 className="panel-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {spot.name}
          </h2>
          <div className="panel-sub">{spot.region} · {spot.latitude?.toFixed(2)}°, {spot.longitude?.toFixed(2)}°</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <Link
            to={`/spots/${spot.slug}`}
            className="icon-btn"
            title="Full detail page"
            style={{ textDecoration: 'none' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 6h6M7 4l2 2-2 2"/>
            </svg>
          </Link>
          <button className="icon-btn" onClick={onClose} aria-label="Close panel">
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="now-strip">
        <NowStat
          label="Swell"
          value={currentWvht?.toFixed(1)}
          unit="ft"
          sub={currentDpd && currentDir ? `${currentDpd}s @ ${Math.round(currentDir)}°` : null}
          accent
        />
        <NowStat
          label="Wind"
          value={currentWind ? Math.round(currentWind) : null}
          unit="mph"
          sub={spot.wind_direction_text || null}
        />
        <NowStat
          label="Period"
          value={currentDpd?.toFixed(0)}
          unit="s"
          sub={null}
        />
        <NowStat
          label="Water"
          value={spot.water_temp_f || buoyData?.water_temp_f}
          unit="°F"
          sub={null}
        />
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'forecast' ? 'active' : ''}`} onClick={() => setTab('forecast')}>
          7-Day Forecast
        </button>
        <button className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>
          AI Insight
        </button>
        <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
          My History
        </button>
      </div>

      {tab === 'forecast' && (
        <ForecastTab data={forecast} loading={forecastLoading} />
      )}

      {tab === 'ai' && (
        <div className="ai-tab">
          <div className="ai-banner">
            <div className="ai-pulse" />
            <div>
              <div className="eyebrow">AI Insight</div>
              <div className="ai-headline">
                AI-powered surf analysis for {spot.name} is coming soon.
                Log sessions here to train your personal forecast model.
              </div>
            </div>
          </div>
          <div className="ai-reasoning">
            <div className="ai-reasoning-head">What we'll analyze</div>
            <ul>
              <li>
                <span className="ai-tag">Storm tracking</span>
                Long-period swell origins, fetch quality, and wrap angle for this spot.
              </li>
              <li>
                <span className="ai-tag">Your history</span>
                Your logged sessions will train a model tuned to your preferences at this spot.
              </li>
              <li>
                <span className="ai-tag">Tide</span>
                Optimal tide window based on the spot's break characteristics.
              </li>
              <li>
                <span className="ai-tag">Wind</span>
                Offshore window timing with forecast confidence intervals.
              </li>
            </ul>
          </div>
          <Link to={`/spots/${spot.slug}`} className="ai-action" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }}>
            Full spot detail →
          </Link>
        </div>
      )}

      {tab === 'log' && (
        <div className="log-tab">
          <div className="log-summary">
            <div>
              <div className="eyebrow">Your history at {spot.name}</div>
              <div className="log-count">0 sessions logged</div>
            </div>
            <button className="btn-ghost" onClick={() => alert('Session logging coming soon')}>+ Log session</button>
          </div>
          <div className="empty-state">
            No sessions logged here yet. Log one to help the AI learn your preferences.
          </div>
        </div>
      )}
    </div>
  );
}
