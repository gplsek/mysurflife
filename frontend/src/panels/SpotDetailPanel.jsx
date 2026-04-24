import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import LogoPulse from '../design/LogoPulse';

function NowStat({ label, value, unit, sub, accent }) {
  return (
    <div className={`now-stat${accent ? ' accent' : ''}`}>
      <div className="now-label">{label}</div>
      <div className="now-value">
        <span className="num">{value ?? '—'}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="now-sub">{sub}</div>}
    </div>
  );
}

function ratingMeta(rating) {
  if (rating == null) return { label: 'No data',   cls: 1, color: 'var(--muted)' };
  if (rating >= 4)    return { label: 'Excellent',  cls: 5, color: 'var(--fire)' };
  if (rating >= 3)    return { label: 'Good',       cls: 4, color: 'var(--accent)' };
  if (rating >= 2)    return { label: 'Fair',       cls: 3, color: 'var(--gold)' };
  return               { label: 'Poor',            cls: 2, color: 'var(--muted)' };
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
        <div className="empty-state">7-day forecast coming soon.</div>
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
          const h     = ((f.swell_height || 0) / max) * 100;
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
          <div key={i} className={`day-label${i === today ? ' today' : ''}`}>
            <span>{d}</span>
            <span className="mono-tiny">{data[i * 24]?.swell_height?.toFixed(0) || '—'}ft</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// spot shape from map bundle: { slug, name, region, latitude, longitude, rating, swell, period, wind, water }
export default function SpotDetailPanel({ spot, onClose }) {
  const [tab,             setTab]             = useState('forecast');
  const [forecast,        setForecast]        = useState(null);
  const [forecastLoading, setForecastLoading] = useState(true);

  useEffect(() => {
    if (!spot) return;
    setTab('forecast');
    setForecastLoading(true);
    setForecast(null);

    fetch(`/api/surf-spots/${spot.slug}/forecast-timeline`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setForecast(d.timeline || []))
      .catch(() => null)
      .finally(() => setForecastLoading(false));
  }, [spot?.slug]);

  if (!spot) return null;

  const { label: ratingLabel, cls: ratingCls } = ratingMeta(spot.rating);

  return (
    <div className="panel spot-detail">
      {/* Head */}
      <div className="panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">
            <span className={`dot rating-${ratingCls}`} />
            {ratingLabel}
          </div>
          <h2 className="panel-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {spot.name}
          </h2>
          <div className="panel-sub">
            {spot.region}{spot.latitude != null ? ` · ${spot.latitude.toFixed(2)}°, ${spot.longitude.toFixed(2)}°` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginTop: 4 }}>
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

      {/* Now strip */}
      <div className="now-strip">
        <NowStat
          label="Swell"
          value={spot.swell != null ? spot.swell.toFixed(1) : null}
          unit="ft"
          sub={spot.period ? `${spot.period}s` : null}
          accent
        />
        <NowStat
          label="Period"
          value={spot.period != null ? Math.round(spot.period) : null}
          unit="s"
        />
        <NowStat
          label="Wind"
          value={spot.wind != null ? Math.round(spot.wind) : null}
          unit="mph"
        />
        <NowStat
          label="Water"
          value={spot.water != null ? Math.round(spot.water) : null}
          unit="°F"
        />
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab${tab === 'forecast' ? ' active' : ''}`} onClick={() => setTab('forecast')}>
          7-Day Forecast
        </button>
        <button className={`tab${tab === 'ai' ? ' active' : ''}`} onClick={() => setTab('ai')}>
          AI Insight
        </button>
        <button className={`tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>
          My History
        </button>
      </div>

      {/* Forecast */}
      {tab === 'forecast' && <ForecastTab data={forecast} loading={forecastLoading} />}

      {/* AI tab */}
      {tab === 'ai' && (
        <div className="ai-tab">
          <div className="ai-banner">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="eyebrow">Sione's Analysis</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--fg-2)' }}>
                AI surf analysis for {spot.name} is available on the full detail page.
              </div>
            </div>
          </div>
          <Link
            to={`/spots/${spot.slug}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 20, padding: '10px 0',
              color: 'var(--accent)', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Open full spot detail →
          </Link>
        </div>
      )}

      {/* Log tab */}
      {tab === 'log' && (
        <div className="log-tab">
          <div className="log-summary">
            <div>
              <div className="eyebrow">Your history at {spot.name}</div>
              <div className="log-count">0 sessions logged</div>
            </div>
          </div>
          <div className="empty-state">
            No sessions logged here yet.
          </div>
        </div>
      )}
    </div>
  );
}
