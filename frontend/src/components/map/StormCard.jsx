import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate }        from 'react-router-dom';
import { StormFetchWedge }    from './StormFetchWedge';
import { StormForecastTrack } from './StormForecastTrack';
import { RegionalScorecard }  from './RegionalScorecard';
import { ArrivalSpotList }    from './ArrivalSpotList';

const DIR_DEGREES = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

const BADGE_CLASS = {
  LOW:                 'low',
  TROPICAL_DEPRESSION: 'td',
  TROPICAL_STORM:      'ts',
  HURRICANE:           'hurricane',
  TYPHOON:             'typhoon',
};

const TYPE_LABELS = {
  LOW:                 'Low Pressure',
  TROPICAL_DEPRESSION: 'Tropical Depression',
  TROPICAL_STORM:      'Tropical Storm',
  HURRICANE:           'Hurricane',
  TYPHOON:             'Typhoon',
};

function fetchSeverity(windKts) {
  if (windKts >= 64) return 'hurricane-force';
  if (windKts >= 48) return 'storm-force';
  return 'gale-force';
}

function minutesAgo(isoStr) {
  if (!isoStr) return null;
  return Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
}

function formatFreshness(mins) {
  if (mins === null) return '';
  if (mins < 60)  return `issued ${mins}m ago`;
  return `issued ${Math.round(mins / 60)}h ago`;
}

function prepareTrack(forecast_track) {
  if (!forecast_track || forecast_track.length === 0) return null;
  return forecast_track
    .filter(p => p.lat != null && p.lon != null)
    .map(p => ({
      t_plus: p.hours_ahead,
      lat:    p.lat,
      lon:    p.lon,
      mb:     p.pressure_mb   || '—',
      kt:     p.wind_kts      || '—',
    }))
    .slice(0, 3);
}

export function StormCard({ storm, mapRef, onClose }) {
  const navigate = useNavigate();
  const [l2Status,       setL2Status]       = useState('idle');
  const [arrivals,       setArrivals]       = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [l2Sort,         setL2Sort]         = useState('size');
  const [highlight,      setHighlight]      = useState(null);
  const [minutesAgoVal,  setMinutesAgoVal]  = useState(() => minutesAgo(storm?.issued_utc));
  const abortRef = useRef(null);

  /* ─── Data prep ───────────────────────────────────────────── */
  const type       = storm.type || 'LOW';
  const typeLabel  = TYPE_LABELS[type] || 'System';
  const posLabel   = `${Math.abs(storm.lat).toFixed(1)}°${storm.lat >= 0 ? 'N' : 'S'}, ${Math.abs(storm.lon).toFixed(1)}°${storm.lon >= 0 ? 'E' : 'W'}`;
  const wind_kt    = storm.wind_kts || 0;
  const wind_mph   = Math.round(wind_kt * 1.15078);
  const seas_ft    = storm.sea_height_ft || 0;
  const seas_range = storm.sea_range_ft || `${seas_ft}`;
  const movDir     = storm.movement?.direction;
  const movDeg     = DIR_DEGREES[movDir] ?? 270;
  const movSpeed   = storm.movement?.speed_kt ?? 0;
  const pressureMb = storm.pressure_mb || 990;
  const pressurePct = Math.min(100, Math.max(0,
    ((pressureMb - 950) / (1020 - 950)) * 100
  ));
  const stormFetch = storm.fetch
    ? {
        ...storm.fetch,
        severity: storm.fetch.severity || fetchSeverity(storm.fetch.wind_kts_in_fetch || 0),
      }
    : null;
  const track = prepareTrack(storm.forecast_track);
  const stale = (minutesAgoVal || 0) > 720;
  const isHurricane = type === 'HURRICANE' || type === 'TYPHOON';

  /* ─── Freshness ticker ────────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => {
      setMinutesAgoVal(minutesAgo(storm?.issued_utc));
    }, 60000);
    return () => clearInterval(id);
  }, [storm?.issued_utc]);

  /* ─── Arrivals fetch ──────────────────────────────────────── */
  useEffect(() => {
    if (!storm?.id) return;
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setL2Status('loading');
    fetch(`/api/storms/${storm.id}/arrivals`, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => {
        setArrivals(data.arrivals || []);
        setL2Status('ready');
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        setArrivals([]);
        setL2Status('error');
      });

    return () => ac.abort();
  }, [storm?.id]);

  /* ─── Keyboard + URL sync ─────────────────────────────────── */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    const url = new URL(window.location);
    url.searchParams.set('storm', storm.id);
    window.history.replaceState(null, '', url.toString());

    return () => {
      document.removeEventListener('keydown', onKey);
      const u2 = new URL(window.location);
      u2.searchParams.delete('storm');
      u2.searchParams.delete('region');
      window.history.replaceState(null, '', u2.toString());
    };
  }, [storm.id, onClose]);

  /* ─── Map reactions on region select ─────────────────────── */
  const applyMapReactions = useCallback((regionId) => {
    document.body.classList.add('dimmed');
    const url = new URL(window.location);
    if (regionId) {
      url.searchParams.set('region', regionId);
    } else {
      url.searchParams.delete('region');
    }
    window.history.replaceState(null, '', url.toString());
  }, []);

  const clearMapReactions = useCallback(() => {
    document.body.classList.remove('dimmed');
  }, []);

  const handleSelectRegion = (regionId) => {
    const next = regionId === selectedRegion ? null : regionId;
    setSelectedRegion(next);
    setHighlight(null);
    if (next) {
      applyMapReactions(next);
    } else {
      clearMapReactions();
    }
  };

  /* ─── Cleanup on unmount ──────────────────────────────────── */
  useEffect(() => {
    return () => {
      clearMapReactions();
      if (abortRef.current) abortRef.current.abort();
    };
  }, [clearMapReactions]);

  const handleClose = () => {
    clearMapReactions();
    onClose();
  };

  const selectedArrival = arrivals?.find(a => a.region_id === selectedRegion) || null;

  /* ─── Render ──────────────────────────────────────────────── */
  return (
    <div
      className={`storm-card${isHurricane ? ' hurr' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="sc-title"
    >
      {/* Warning bar */}
      {storm.warning_tier && storm.warning_tier !== 'none' && (
        <div className={`l1-warn-bar wt-${storm.warning_tier}`} />
      )}

      <div className="storm-card-body">

        {/* ─── L1: Header ─── */}
        <div className="l1-head">
          <div className={`storm-type-badge ${BADGE_CLASS[type] || 'low'}`}>
            {typeLabel}
          </div>
          <div className="l1-title-block">
            <div className="l1-title" id="sc-title">{storm.name}</div>
            <div className="l1-sub">
              {posLabel}
              {' · '}
              <time
                dateTime={storm.issued_utc || ''}
                className={stale ? 'stale' : ''}
              >
                {formatFreshness(minutesAgoVal)}
                {stale ? ' — may be stale' : ''}
              </time>
            </div>
          </div>
          <button
            className="l1-close"
            onClick={handleClose}
            aria-label="Close storm card"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ─── L1: Primary stats ─── */}
        <div className="l1-primary">
          <div className="cell">
            <div className="k">Pressure</div>
            <div className="v">{pressureMb}<span className="u">mb</span></div>
            <div className="pressure-gauge">
              <div
                className="pg-bar"
                style={{ '--pg-pos': `${pressurePct}%` }}
              />
              <div className="pg-labels">
                <span>950</span><span>1020</span>
              </div>
            </div>
          </div>
          <div className="cell">
            <div className="k">Max Winds</div>
            <div className="v">{wind_kt}<span className="u">kt</span></div>
            <div className="sub">{wind_mph} mph</div>
          </div>
          <div className="cell">
            <div className="k">Max Seas</div>
            <div className="v">{seas_ft}<span className="u">ft</span></div>
            <div className="sub">{seas_range} ft range</div>
          </div>
        </div>

        {/* ─── L1: Movement + fetch ─── */}
        <div className="l1-meta">
          <div className="movement-block">
            <div className="move-arrow-row">
              <div
                className="move-circle"
                style={{ transform: `rotate(${movDeg}deg)` }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M6 2 L9.5 10 L6 7.5 L2.5 10 Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <span className="move-label">
                Moving <b>{movDir || '—'}</b> at <span className="mono">{movSpeed} kt</span>
              </span>
            </div>
            <div className="fetch-sentence">
              {stormFetch
                ? <>
                    <em>{stormFetch.severity}</em> winds in <em>{stormFetch.quadrant}</em>,
                    {' '}~{stormFetch.radius_nm} nm radius
                  </>
                : <span className="muted">Fetch geometry unavailable</span>
              }
            </div>
          </div>

          <StormFetchWedge fetch={stormFetch} />
        </div>

        {/* ─── L1: Forecast track ─── */}
        <div className="l1-track">
          <div className="l1-track-head">
            <span className="title">Forecast track · 72h</span>
            {storm.nhc_official && (
              <span className="official-badge">NHC Official</span>
            )}
          </div>
          <StormForecastTrack track={track} />
        </div>

        {/* ─── L1: Quick chip ─── */}
        <button
          className="l1-quick-chip"
          onClick={() => navigate(`/sione?storm=${storm.id}`)}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M1.5 2.5C1.5 1.95 1.95 1.5 2.5 1.5h8c.55 0 1 .45 1 1v5c0 .55-.45 1-1 1H4l-2.5 2V2.5z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
          Ask Sione about this storm
          <span className="spark">Chat ↗</span>
        </button>

        {/* ─── L1: Raw bulletin ─── */}
        {storm.raw_text && (
          <div className="l1-bulletin">
            <details>
              <summary>View full bulletin</summary>
              <div className="bulletin-text">{storm.raw_text}</div>
            </details>
          </div>
        )}

        {/* ─── L2: Regional scorecard ─── */}
        <RegionalScorecard
          arrivals={arrivals}
          status={l2Status}
          sort={l2Sort}
          onSortChange={setL2Sort}
          onRetry={() => {
            setL2Status('loading');
            /* re-trigger by resetting id key — handled by the fetch effect */
          }}
          selectedRegion={selectedRegion}
          onSelectRegion={handleSelectRegion}
        />

        {/* ─── L3: Spot breakdown ─── */}
        {selectedArrival && (
          <ArrivalSpotList
            region={selectedArrival}
            highlight={highlight}
            onHighlight={setHighlight}
            stormId={storm.id}
          />
        )}

      </div>
    </div>
  );
}
