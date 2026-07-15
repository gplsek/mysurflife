import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate }        from 'react-router-dom';
import { getAuthHeaders }     from '../../supabaseClient';
import { StormFetchWedge }    from './StormFetchWedge';
import { StormForecastTrack } from './StormForecastTrack';
import { RegionalScorecard }  from './RegionalScorecard';
import { ArrivalSpotList }    from './ArrivalSpotList';
import Logo                   from '../../design/Logo';

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
      kt:     p.peak_wind_kts ?? p.wind_kts ?? '—',
    }))
    .slice(0, 3);
}

const COMPASS_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function degToCompass(deg) {
  if (deg == null) return null;
  return COMPASS_DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
function fmtHours(h) {
  if (h == null) return '—';
  return h < 48 ? `~${Math.round(h)}h` : `~${Math.round(h / 24)}d`;
}

// Map a model storm's region_timeline into the L2 "Reachable surf" arrival-row shape,
// so model storms populate the scorecard like bulletin storms (which come from /arrivals).
function timelineToArrivals(regionTimeline) {
  if (!regionTimeline || !regionTimeline.length) return [];
  const fmtWhen = (h) => {
    if (h == null) return '—';
    const d = new Date(Date.now() + h * 3600 * 1000);
    return d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric' });
  };
  return regionTimeline.map((t) => ({
    region_id: t.region_id || t.region,
    name:      t.region,
    peak_ft:   t.size_ft,
    peak_when: fmtWhen(t.peak_hours),
    window_h:  (t.fade_hours != null && t.arrival_hours != null)
      ? Math.max(0, Math.round(t.fade_hours - t.arrival_hours))
      : null,
    // tier left undefined → RegionalScorecard derives it from peak_ft
  }));
}

export function StormCard({ storm, mapRef, onClose }) {
  const navigate = useNavigate();
  const [l2Status,       setL2Status]       = useState('idle');
  const [arrivals,       setArrivals]       = useState(null);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [l2Sort,         setL2Sort]         = useState('size');
  const [highlight,      setHighlight]      = useState(null);
  const [minutesAgoVal,  setMinutesAgoVal]  = useState(() => minutesAgo(storm?.issued_utc));
  const [chipLoading,    setChipLoading]    = useState(false);
  const [detail,         setDetail]         = useState(null);
  const abortRef = useRef(null);

  /* ─── Data prep ───────────────────────────────────────────── */
  const type       = storm.type || 'LOW';
  const typeLabel  = TYPE_LABELS[type] || 'System';
  const posLabel   = `${Math.abs(storm.lat).toFixed(1)}°${storm.lat >= 0 ? 'N' : 'S'}, ${Math.abs(storm.lon).toFixed(1)}°${storm.lon >= 0 ? 'E' : 'W'}`;
  const wind_kt    = storm.wind_kts || 0;
  const wind_mph   = Math.round(wind_kt * 1.15078);
  const gust_kt    = storm.max_gust_kts;
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

  // Phase 8: detail fields (fall back to storm props while loading)
  const d = detail || storm;
  const narrative         = d.narrative;
  const isDeepening       = d.is_deepening;
  const intensRate        = d.intensification_rate_mb_per_6h;
  const peakIntensityHour = d.peak_intensity_hour;
  const willLandfall      = d.will_make_landfall;
  const landfallEta       = d.landfall_eta_hours;
  const landfallBeforePeak = d.landfall_before_peak;
  const peakSeaM          = d.peak_sea_m;
  const peakPeriodS       = d.peak_period_s;
  const swellDirDeg       = d.swell_direction_deg;
  const swellDirCompass   = degToCompass(swellDirDeg);
  const peakSeaFt         = peakSeaM != null ? Math.round(peakSeaM * 3.281) : null;
  const confirmStatus     = d.confirmation_status;
  const regionImpacts     = d.region_impacts;
  // Phase 6: precomputed LLM trajectory analysis + structured timeline.
  // analysis_text falls back to the templated narrative when no LLM run is stored.
  const analysisText      = d.analysis_text || narrative;
  const analysisModel     = d.analysis_model;          // present only when Sonnet ran
  const regionTimeline    = d.region_timeline;
  const isModelStorm      = storm.source === 'model' || storm.source === 'reconciled';
  // For model storms use WW3 peak seas when bulletin sea height is absent
  const displaySeasFt     = (isModelStorm && !storm.sea_height_ft && peakSeaFt) ? peakSeaFt : seas_ft;
  const ww3Confirmed      = confirmStatus === 'confirmed';
  const modelSourceLabel  = isModelStorm
    ? (ww3Confirmed ? 'GFS + WW3 confirmed' : 'GFS model-derived')
    : null;

  /* ─── Freshness ticker ────────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => {
      setMinutesAgoVal(minutesAgo(storm?.issued_utc));
    }, 60000);
    return () => clearInterval(id);
  }, [storm?.issued_utc]);

  /* ─── Detail fetch (Phase 8) ─────────────────────────────── */
  useEffect(() => {
    if (!storm?.id) return;
    let cancelled = false;
    fetch(`/api/storms/${storm.id}/detail`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data && !data.error) setDetail(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [storm?.id]);

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

  /* ─── Ask Sione handoff ──────────────────────────────────── */
  const handleAskSione = useCallback(async () => {
    setChipLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      // Enrich the /active storm with the precomputed analysis fields from the
      // detail fetch, so the opener can summarise vitals + affected regions.
      const enrichedStorm = {
        ...storm,
        ...(detail ? {
          region_timeline:     detail.region_timeline,
          analysis_text:       detail.analysis_text,
          peak_sea_m:          detail.peak_sea_m,
          peak_period_s:       detail.peak_period_s,
          swell_direction_deg: detail.swell_direction_deg,
        } : {}),
      };
      const payload = {
        mode:   'storm_trip',
        storm:  { ...enrichedStorm, arrivals: arrivals || [] },
        source: 'storm-card',
      };
      const res = await fetch('/api/sione/sessions', {
        method:  'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.status);
      const { session_id, opening_message } = await res.json();
      const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      // Carry a slim storm + arrivals so Sione can rebuild context if the chat lands
      // on a different worker than the session was created on (or after a restart).
      // Drop heavy fields not used by the LLM context block (raw bulletin, spot lists).
      const { raw_text, ...slimStorm } = enrichedStorm;
      const slimArrivals = (arrivals || []).map(a => ({
        region_id:     a.region_id,
        name:          a.name,
        tier:          a.tier,
        peak_when:     a.peak_when,
        peak_ft:       a.peak_ft,
        window_h:      a.window_h,
        peak_period_s: a.peak_period_s,
      }));
      navigate('/sione', {
        state: {
          messages: [{ role: 'assistant', content: opening_message, time: t }],
          context:  { session_id, storm_id: storm.id, storm: slimStorm, arrivals: slimArrivals },
        },
      });
    } catch (_) {
      navigate(`/sione?storm=${storm.id}`);
    } finally {
      setChipLoading(false);
    }
  }, [storm, detail, arrivals, navigate]);

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

  // L2 "Reachable surf": prefer real bulletin arrivals; for model storms with no
  // arrivals, fall back to the Sione region_timeline so the section still populates.
  const timelineArrivals = timelineToArrivals(regionTimeline);
  const useTimelineL2 = l2Status === 'ready'
    && (!arrivals || arrivals.length === 0)
    && timelineArrivals.length > 0;
  const l2Arrivals = useTimelineL2 ? timelineArrivals : arrivals;

  const selectedArrival = (l2Arrivals || []).find(a => a.region_id === selectedRegion) || null;

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
            <div className="l1-title" id="sc-title">
              {storm.name}
              {isModelStorm ? (
                <span
                  className={`sc-model-badge${ww3Confirmed ? ' confirmed' : ''}`}
                  title={ww3Confirmed
                    ? 'GFS pressure field + WW3 wave model confirmed'
                    : storm.source === 'reconciled'
                      ? 'Matched to NOAA bulletin — GFS + bulletin data merged'
                      : 'Derived from GFS pressure field — WW3 unconfirmed'}
                >
                  {storm.source === 'reconciled' ? 'reconciled' : ww3Confirmed ? 'GFS+WW3' : 'GFS'}
                </span>
              ) : (
                <span className="sc-model-badge sc-bulletin-badge" title="NOAA NWS High Seas Forecast bulletin">
                  bulletin
                </span>
              )}
            </div>
            <div className="l1-sub">
              {posLabel}
              {' · '}
              {modelSourceLabel
                ? <span className={ww3Confirmed ? 'sc-model-confirmed' : ''}>{modelSourceLabel}</span>
                : (
                  <time
                    dateTime={storm.issued_utc || ''}
                    className={stale ? 'stale' : ''}
                  >
                    {formatFreshness(minutesAgoVal)}
                    {stale ? ' — may be stale' : ''}
                  </time>
                )
              }
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
            <div className="sub">{gust_kt != null ? `gusts ${Math.round(gust_kt)} kt` : `${wind_mph} mph`}</div>
          </div>
          <div className="cell">
            <div className="k">Max Seas</div>
            <div className="v">{displaySeasFt}<span className="u">ft</span></div>
            {isModelStorm && peakSeaFt != null
              ? <div className="sub">{peakPeriodS != null ? `${peakPeriodS.toFixed(1)}s` : ''}{swellDirCompass ? ` · ${swellDirCompass}` : ''} WW3</div>
              : <div className="sub">{seas_range} ft range</div>
            }
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
          className={`l1-quick-chip${chipLoading ? ' loading' : ''}`}
          onClick={handleAskSione}
          disabled={chipLoading}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path
              d="M1.5 2.5C1.5 1.95 1.95 1.5 2.5 1.5h8c.55 0 1 .45 1 1v5c0 .55-.45 1-1 1H4l-2.5 2V2.5z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
          {chipLoading ? 'Opening…' : 'Ask Sione about this storm'}
          {!chipLoading && <span className="spark">Chat ↗</span>}
        </button>

        {/* ─── Storm Dynamics (Phase 8) ─── */}
        {(isDeepening != null || peakSeaFt != null) && (
          <div className="sc-section sc-dynamics">
            <div className="sc-section-head">Storm Dynamics</div>
            <div className="sc-row-grid">
              {isDeepening != null && (
                <div className="sc-cell">
                  <div className="k">Trend</div>
                  <div className={`v${isDeepening ? ' deepening' : ''}`}>
                    {isDeepening ? '↓ Deepening' : '↑ Weakening'}
                    {intensRate != null && (
                      <span className="sub">
                        {Math.abs(intensRate).toFixed(1)} mb / 6h
                      </span>
                    )}
                  </div>
                </div>
              )}
              {peakIntensityHour != null && (
                <div className="sc-cell">
                  <div className="k">Peaks in</div>
                  <div className="v">{fmtHours(peakIntensityHour)}</div>
                </div>
              )}
              {peakSeaFt != null && (
                <div className="sc-cell">
                  <div className="k">WW3 Seas</div>
                  <div className="v">
                    {peakSeaFt} ft
                    {peakPeriodS != null && swellDirCompass != null && (
                      <span className="sub">{peakPeriodS}s {swellDirCompass}</span>
                    )}
                    {peakPeriodS != null && swellDirCompass == null && (
                      <span className="sub">{peakPeriodS}s</span>
                    )}
                  </div>
                </div>
              )}
              {confirmStatus && confirmStatus !== 'ww3_unavailable' && (
                <div className="sc-cell">
                  <div className="k">Confirm</div>
                  <div className={`v sc-confirm-${confirmStatus}`}>
                    {confirmStatus === 'confirmed' ? '✓ WW3' : confirmStatus.replace('_', ' ')}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Landfall (Phase 8) ─── */}
        {willLandfall === true && (
          <div className={`sc-section sc-landfall${landfallBeforePeak ? ' before-peak' : ''}`}>
            <div className="sc-section-head">Landfall</div>
            <div className="sc-landfall-body">
              <span>ETA {fmtHours(landfallEta)}</span>
              {landfallBeforePeak && (
                <span className="sc-warn">Storm dies before peak — swell window shortened</span>
              )}
            </div>
          </div>
        )}

        {/* ─── Region Impacts (Phase 8) ─── */}
        {regionImpacts && regionImpacts.length > 0 && (
          <div className="sc-section sc-regions">
            <div className="sc-section-head">Regional Impact</div>
            {regionImpacts
              .filter(r => r.impact_tier !== 'miss')
              .slice(0, 6)
              .map(r => (
                <div
                  key={r.region_id}
                  className={`sc-region-row${r.is_best_exposure ? ' best' : ''}`}
                >
                  <div className="sc-region-name">
                    {r.label}
                    {r.is_best_exposure && <span className="sc-best-badge">best</span>}
                  </div>
                  <div className="sc-region-bar-wrap">
                    <div
                      className={`sc-region-bar tier-${r.impact_tier}`}
                      style={{ width: `${Math.round(r.energy_index * 100)}%` }}
                    />
                  </div>
                  <div className="sc-region-arrival">{fmtHours(r.arrival_hours)}</div>
                </div>
              ))}
          </div>
        )}

        {/* ─── L1: Raw bulletin ─── */}
        {storm.raw_text && (
          <div className="l1-bulletin">
            <details>
              <summary>View full bulletin</summary>
              <div className="bulletin-text">{storm.raw_text}</div>
            </details>
          </div>
        )}

        {/* ─── Sione forecast summary (prose) ─── */}
        {analysisText && (
          <div className="sc-analysis">
            <div className="sc-analysis-head">
              <Logo variant="mark" size={13} />
              <span>{analysisModel ? 'Sione forecast' : 'Forecast'}</span>
            </div>
            <p className="sc-analysis-body">{analysisText}</p>
          </div>
        )}

        {/* ─── L2: Regional scorecard (bulletin arrivals, or Sione timeline) ─── */}
        <RegionalScorecard
          arrivals={l2Arrivals}
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

        {/* ─── L3: Spot breakdown (bulletin arrivals only — timeline rows have no spots) ─── */}
        {selectedArrival && selectedArrival.spots && selectedArrival.spots.length > 0 && (
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
