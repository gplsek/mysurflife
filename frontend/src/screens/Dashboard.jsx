import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { getAuthHeaders } from '../supabaseClient';
import LogoPulse from '../design/LogoPulse';
import { StormCard } from '../components/map/StormCard';
import './Dashboard.css';
import '../styles/storm-card.css';

const OCEAN_COLS = [
  { key: 'north-pacific',   label: 'North Pacific' },
  { key: 'east-pacific',    label: 'East Pacific'  },
  { key: 'north-atlantic',  label: 'North Atlantic' },
  { key: 'south-pacific',   label: 'South Pacific' },
];

const STORM_LEGEND = [
  { tier: 'firing', label: 'Hurricane', range: '≥ 64 kts' },
  { tier: 'solid',  label: 'Storm',     range: '48–63 kts' },
  { tier: 'good',   label: 'Gale',      range: '34–47 kts' },
  { tier: 'fair',   label: 'Strong',    range: '22–33 kts' },
  { tier: 'flat',   label: 'Low',       range: '< 22 kts'  },
];

const TIDE_LABELS = {
  low:          { label: 'Low',     arrow: null },
  rising_low:   { label: 'Rising',  arrow: '↑' },
  mid:          { label: 'Mid',     arrow: null },
  rising_high:  { label: 'Rising',  arrow: '↑' },
  high:         { label: 'High',    arrow: null },
  falling:      { label: 'Falling', arrow: '↓' },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function greetingWord() {
  const h = new Date().getHours();
  if (h < 5)  return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function firstName(profile, user) {
  const dn = profile?.display_name;
  if (dn && dn.trim()) return dn.trim().split(' ')[0];
  const em = user?.email || '';
  return em.split('@')[0] || 'Surfer';
}

function slugToLabel(slug) {
  return slug
    .replace(/^(usr_\d+|[0-9]+)$/, 'Spot')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function ratingTier(r) {
  if (r >= 5) return 'firing';
  if (r >= 4) return 'solid';
  if (r >= 3) return 'good';
  if (r >= 2) return 'fair';
  return 'flat';
}

function degToCompass(deg) {
  if (deg == null) return null;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function tierLabel(t) {
  return { firing: 'Firing', solid: 'Solid', good: 'Good', fair: 'Fair', flat: 'Flat' }[t] || '—';
}

function fmtDuration(min) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function fmtSessionDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function coordToRegion(lat, lon) {
  if (!lat || !lon) return '';
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

function buildStreakCells(sessions) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = 30;
  const sessSet = new Set(
    sessions.map(s => {
      const d = new Date((s.date || '') + 'T12:00:00');
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })
  );
  const cells = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    cells.push({ t: d.getTime(), on: sessSet.has(d.getTime()), today: i === 0 });
  }
  return cells;
}

function computeYearStats(sessions) {
  const year = new Date().getFullYear();
  const ySessions = sessions.filter(s => {
    const y = s.date ? parseInt(s.date.slice(0, 4), 10) : 0;
    return y === year;
  });
  const count = ySessions.length;
  const totalMin = ySessions.reduce((a, s) => a + (s.duration || 0), 0);
  const totalWaves = ySessions.reduce((a, s) => a + (s.waves || 0), 0);
  const longest = ySessions.reduce((a, s) => Math.max(a, s.duration || 0), 0);
  const spotCounts = {};
  ySessions.forEach(s => {
    if (s.spot) spotCounts[s.spot] = (spotCounts[s.spot] || 0) + 1;
  });
  const topSpot = Object.entries(spotCounts).sort((a, b) => b[1] - a[1])[0];
  return { count, totalMin, totalWaves, longest, topSpot: topSpot || null };
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconPlus = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const IconArrow = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 11L11 3M5 3h6v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);
const IconBell = () => (
  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3.5 10.5l7 0M7 2v.5M4 4.5C4 3.1 5.3 2 7 2s3 1.1 3 2.5c0 3 1.5 4.5 1.5 6h-9c0-1.5 1.5-3 1.5-6zM6 11.5a1 1 0 0 0 2 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);
const IconPhone = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
    <rect x="3" y="1.5" width="6" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="6" cy="8.5" r="0.6" fill="currentColor"/>
  </svg>
);
const IconEmail = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
    <rect x="1.5" y="3" width="9" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 4l4 3 4-3" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);

// ── Sub-components ────────────────────────────────────────────────────────────

function AlertSwitch({ on, onToggle }) {
  return (
    <button
      className={`alert-switch${on ? ' on' : ''}`}
      onClick={e => { e.stopPropagation(); onToggle(); }}
      aria-pressed={on}
      aria-label="Toggle alert"
    />
  );
}

function StreakStrip({ sessions }) {
  const cells = buildStreakCells(sessions);
  return (
    <div className="streak-strip" aria-label="30-day surf streak">
      {cells.map((c, i) => (
        <span
          key={i}
          className={`streak-cell${c.on ? ' on' : ''}${c.today ? ' today' : ''}`}
        />
      ))}
    </div>
  );
}

function DirArrow({ dir, className }) {
  if (dir == null) return null;
  // Data is FROM-direction; add 180 to flip to direction-of-travel
  const travelDeg = dir + 180;
  return (
    <svg
      width="9" height="9" viewBox="0 0 10 10" aria-hidden
      className={className}
      style={{ transform: `rotate(${travelDeg}deg)`, flexShrink: 0, display: 'inline-block' }}
    >
      <path d="M5 9V1M2 4l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function OutlookCard({ spot, navigate }) {
  const score      = spot.rating    ?? null;
  const tier       = score != null ? ratingTier(score * 2) : 'flat';
  const dots       = score != null ? Math.round(score) : 0;
  const swellFt    = spot.swell     != null ? spot.swell.toFixed(1)        : null;
  const period     = spot.period    != null ? `${spot.period.toFixed(0)}s` : null;
  const swellComp  = degToCompass(spot.swell_dir);
  const windMph    = spot.wind      != null ? `${Math.round(spot.wind)}`   : null;
  const windComp   = degToCompass(spot.wind_dir);
  const tideInfo   = spot.tide_state ? (TIDE_LABELS[spot.tide_state] || null) : null;
  const tideFt     = spot.tide_ft   != null ? spot.tide_ft.toFixed(1)     : null;
  const hasData    = swellFt != null || windMph != null;

  return (
    <article
      className={`outlook-card ${tier}`}
      onClick={() => navigate(`/spots/${spot.slug}`)}
      role="button"
      tabIndex={0}
    >
      <div className="oc-name">{spot.name}</div>
      <div className="oc-rating-row">
        <span className="oc-dots">
          {[0,1,2,3,4].map(i => (
            <span key={i} className={`oc-dot${i < dots ? ' on' : ''}`} />
          ))}
        </span>
        <span className="oc-score">
          {score != null
            ? <>{score.toFixed(1)}<span className="oc-max">/5</span></>
            : <span className="oc-max">—</span>
          }
        </span>
      </div>

      {swellFt && (
        <div className="oc-data-row">
          <DirArrow dir={spot.swell_dir} className="oc-dir-arrow oc-swell-arrow" />
          {swellComp && <span className="oc-comp">{swellComp}</span>}
          <span className="oc-val">{swellFt}<span className="oc-unit">ft</span></span>
          {period && <span className="oc-period">{period}</span>}
        </div>
      )}

      {windMph && (
        <div className="oc-data-row oc-wind-row">
          <DirArrow dir={spot.wind_dir} className="oc-dir-arrow oc-wind-arrow" />
          {windComp && <span className="oc-comp">{windComp}</span>}
          <span className="oc-val">{windMph}<span className="oc-unit">mph</span></span>
          <span className="oc-row-label">wind</span>
        </div>
      )}

      {tideInfo && (
        <div className="oc-tide">
          {tideInfo.arrow && <span className="oc-tide-arrow">{tideInfo.arrow}</span>}
          {tideInfo.label}
          {tideFt && <span className="oc-tide-ft"> {tideFt}ft</span>}
        </div>
      )}

      {!hasData && (
        <div className="oc-no-data">No forecast data yet</div>
      )}
    </article>
  );
}

function stormSourceTag(storm) {
  const src = storm.source;
  const confirmed = storm.confirmation_status === 'confirmed';
  if (src === 'bulletin')    return { label: 'Bulletin',     cls: 'bulletin' };
  if (src === 'reconciled')  return { label: 'Bulletin+GFS', cls: 'reconciled' };
  if (src === 'model')       return confirmed
    ? { label: 'GFS+WW3', cls: 'ww3' }
    : { label: 'GFS',     cls: 'gfs' };
  return { label: 'Model', cls: 'gfs' };
}

function StormCell({ storm, onOpen }) {
  const pressureOk = storm.pressure_mb    != null;
  const windOk     = storm.wind_kts       != null;
  const seaOk      = storm.sea_height_ft  != null;

  const tier = !windOk ? 'flat'
    : storm.wind_kts >= 64 ? 'firing'
    : storm.wind_kts >= 48 ? 'solid'
    : storm.wind_kts >= 34 ? 'good'
    : storm.wind_kts >= 22 ? 'fair'
    : 'flat';

  const tag = stormSourceTag(storm);

  return (
    <div
      className={`storm-cell ${tier}`}
      onClick={() => onOpen(storm)}
      role="button"
      tabIndex={0}
    >
      <div className="stc-name">{storm.name || (storm.type || 'Low').replace(/_/g, ' ')}</div>
      <div className="stc-metrics">
        {pressureOk && <span className="stc-metric">{storm.pressure_mb}<span className="stc-unit">mb</span></span>}
        {windOk     && <span className="stc-metric">{Math.round(storm.wind_kts)}<span className="stc-unit">kts</span></span>}
        {seaOk      && <span className="stc-metric">{storm.sea_height_ft.toFixed(0)}<span className="stc-unit">ft seas</span></span>}
      </div>
      <span className={`stc-source ${tag.cls}`}>{tag.label}</span>
    </div>
  );
}

function SpotRow({ name, region, tier, isPrivate, lat, lon, onOpen, onAlert, onRemove }) {
  const abbrev = name.substring(0, 2).toUpperCase();
  return (
    <div className="spot-row" onClick={onOpen}>
      <span className={`pin-tile${tier ? ` ${tier}` : ''}${isPrivate ? ' private' : ''}`}>
        {abbrev}
      </span>
      <div className="spot-info">
        <div className="spot-row-name">
          {name}
          {isPrivate && <span className="priv-lock">Private</span>}
        </div>
        <div className="spot-row-region">
          {region}
          {lat && lon && <span className="latlon">{lat.toFixed(3)}, {lon.toFixed(3)}</span>}
        </div>
      </div>
      {tier && <span className={`now-pill ${tier}`}>{tierLabel(tier)}</span>}
      <div className="row-actions" onClick={e => e.stopPropagation()}>
        {onOpen && (
          <button title="Open" onClick={onOpen}><IconArrow /></button>
        )}
        {onAlert && (
          <button title="Set alert" onClick={onAlert}><IconBell /></button>
        )}
        {onRemove && (
          <button title="Remove" onClick={onRemove}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Dashboard({ onOpenMap }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState({});
  const [favorites, setFavorites] = useState([]);   // slug strings
  const [outlookSpots, setOutlookSpots] = useState([]); // full spot objects for favorites
  const [userSpots, setUserSpots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [storms, setStorms] = useState([]);
  const [detailStorm, setDetailStorm] = useState(null);
  const alertsRef = useRef([]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    async function load() {
      try {
        const headers = await getAuthHeaders();
        const [profRes, bundleRes, spotsRes, sessRes, alertsRes] = await Promise.allSettled([
          fetch('/api/user/profile', { headers }).then(r => r.json()),
          fetch('/api/map/bundle', { headers }).then(r => r.json()),
          fetch('/api/user/spots', { headers }).then(r => r.json()),
          fetch('/api/sessions?limit=20', { headers }).then(r => r.json()),
          fetch('/api/alerts', { headers }).then(r => r.json()),
        ]);

        if (profRes.status === 'fulfilled') setProfile(profRes.value?.profile || {});

        if (bundleRes.status === 'fulfilled') {
          const bundle = bundleRes.value;
          const favSlugs = bundle?.user?.favorites || [];
          setFavorites(favSlugs);
          const spotMap = {};
          (bundle?.spots || []).forEach(s => { spotMap[s.slug] = s; });
          const favSpots = favSlugs.map(slug => spotMap[slug]).filter(Boolean);

          // Fetch tide for each favorite in parallel (best-effort, non-blocking)
          const tideResults = await Promise.allSettled(
            favSpots.map(s =>
              fetch(`/api/tides/timeline?spot_slug=${encodeURIComponent(s.slug)}&days=1`)
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
            )
          );
          const now = new Date();
          const enriched = favSpots.map((s, i) => {
            const tideData = tideResults[i].status === 'fulfilled' ? tideResults[i].value : null;
            if (!tideData?.timeline?.length) return s;
            // find closest point to now
            const pts = tideData.timeline;
            let closest = pts[0];
            let minDiff = Infinity;
            for (const pt of pts) {
              const diff = Math.abs(new Date(pt.t + 'Z') - now);
              if (diff < minDiff) { minDiff = diff; closest = pt; }
            }
            return { ...s, tide_state: closest.state, tide_ft: closest.v };
          });

          setOutlookSpots(enriched);
          setStorms(bundle?.storms || []);
        }

        if (spotsRes.status === 'fulfilled') setUserSpots(spotsRes.value?.spots || []);
        if (sessRes.status === 'fulfilled') setSessions(sessRes.value?.sessions || []);
        if (alertsRes.status === 'fulfilled') {
          const a = alertsRes.value?.alerts || [];
          setAlerts(a);
          alertsRef.current = a;
        }
      } catch (_) {
        // silently degrade
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  async function toggleAlert(id, currentActive) {
    try {
      const headers = await getAuthHeaders();
      await fetch(`/api/alerts/${id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive }),
      });
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a));
    } catch (_) {}
  }

  if (loading) {
    return (
      <div className="screen dashboard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogoPulse size={56} />
      </div>
    );
  }

  const name = firstName(profile, user);
  const dateStr = formatDate();
  const greeting = greetingWord();
  const yis = computeYearStats(sessions);
  const firingAlerts = alerts.filter(a => a.active && a.lastTriggered).length;
  const recentSessions = sessions.slice(0, 5);

  return (
    <div className="screen dashboard">

      {/* Storm detail drawer */}
      {detailStorm && (
        <div className="dash-storm-wrap" onClick={e => { if (e.target === e.currentTarget) setDetailStorm(null); }}>
          <div className="dash-storm-backdrop" onClick={() => setDetailStorm(null)} />
          <div className="dash-storm-panel">
            <StormCard storm={detailStorm} mapRef={null} onClose={() => setDetailStorm(null)} />
          </div>
        </div>
      )}

      <div className="dash-page">

        {/* 1. Greeting */}
        <header className="dash-greeting">
          <h1>
            {greeting}, {name}.{' '}
            <span className="g-serif">
              {firingAlerts > 0 ? 'Something\'s firing.' : 'Check the conditions.'}
            </span>
          </h1>
          <div className="g-meta">
            <span>{dateStr}</span>
            {firingAlerts > 0 && (
              <span className="meta-badge fire">
                <span className="mb-dot" />
                {firingAlerts} alert{firingAlerts !== 1 ? 's' : ''} firing
              </span>
            )}
            {favorites.length > 0 && (
              <span className="meta-badge aqua">
                <span className="mb-dot" />
                {favorites.length} favorite spot{favorites.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </header>

        {/* 2. Today's Outlook */}
        {favorites.length > 0 && (
          <section className="db-section">
            <div className="db-section-head">
              <h2>
                Today's outlook{' '}
                <span className="s-count">{favorites.length} favorites</span>
              </h2>
            </div>
            <div className="outlook">
              <div className="outlook-grid">
                {outlookSpots.length > 0
                  ? outlookSpots.map(spot => (
                      <OutlookCard key={spot.slug} spot={spot} navigate={navigate} />
                    ))
                  : favorites.map(slug => (
                      <OutlookCard
                        key={slug}
                        spot={{ slug, name: slugToLabel(slug), region: 'Favorite spot', rating: null }}
                        navigate={navigate}
                      />
                    ))
                }
              </div>
            </div>
          </section>
        )}

        {/* 3. Spots: favorites + private side by side */}
        <section className="db-section">
          <div className="db-section-head">
            <h2>
              Spots{' '}
              <span className="s-count">
                {favorites.length + userSpots.length} total
                {favorites.length > 0 ? ` · ${favorites.length} favorites` : ''}
                {userSpots.length > 0 ? ` · ${userSpots.length} private` : ''}
              </span>
            </h2>
            <div className="s-actions">
              <button className="db-btn" onClick={() => navigate('/map')}>
                <IconPlus /> Add favorite
              </button>
              <button className="db-btn primary" onClick={() => navigate('/map')}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 .5L7.5 4 11 4.5 8.4 7l.6 3.5L6 9 3 10.5 3.6 7 1 4.5 4.5 4z" fill="currentColor"/>
                </svg>
                Drop a pin
              </button>
            </div>
          </div>

          <div className="db-split">
            {/* Favorites column */}
            <div>
              <div className="split-head">
                <span>Favorites</span>
                <span className="s-ct">{favorites.length}</span>
              </div>
              {favorites.length === 0 ? (
                <div className="spots-empty-inline">
                  No favorites yet.{' '}
                  <a href="#" onClick={e => { e.preventDefault(); navigate('/map'); }}>
                    Find spots on the map →
                  </a>
                </div>
              ) : (
                favorites.map(slug => {
                  const sp = outlookSpots.find(s => s.slug === slug);
                  const score = sp?.rating ?? null;
                  const tier  = score != null ? ratingTier(score * 2) : null;
                  return (
                    <SpotRow
                      key={slug}
                      name={sp?.name || slugToLabel(slug)}
                      region={sp?.region || ''}
                      tier={tier}
                      isPrivate={false}
                      onOpen={() => navigate(`/spots/${slug}`)}
                      onAlert={() => navigate('/alerts')}
                      onRemove={null}
                    />
                  );
                })
              )}
            </div>

            {/* Private spots column */}
            <div>
              <div className="split-head">
                <span>Your private spots</span>
                <span className="s-ct">{userSpots.length} · only you</span>
              </div>
              {userSpots.length === 0 ? (
                <div className="spots-empty-inline">
                  Found a new spot on a trip?{' '}
                  <a href="#" onClick={e => { e.preventDefault(); navigate('/map'); }}>
                    Drop a pin →
                  </a>
                </div>
              ) : (
                userSpots.map(spot => (
                  <SpotRow
                    key={spot.id}
                    name={spot.name}
                    region={spot.break_type ? `${spot.break_type} break` : ''}
                    lat={spot.latitude}
                    lon={spot.longitude}
                    tier={null}
                    isPrivate={true}
                    onOpen={() => navigate(`/spots/${spot.slug}`)}
                    onAlert={null}
                    onRemove={null}
                  />
                ))
              )}
              {userSpots.length > 0 && (
                <div className="spots-empty-inline">
                  Found a new spot on a trip?{' '}
                  <a href="#" onClick={e => { e.preventDefault(); navigate('/map'); }}>
                    Drop a pin →
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 4. Storms by ocean */}
        {storms.length > 0 && (
          <section className="db-section">
            <div className="db-section-head">
              <h2>
                Active storms{' '}
                <span className="s-count">{storms.length} systems</span>
              </h2>
              <div className="s-actions">
                <button className="db-btn ghost" onClick={() => navigate('/map')}>
                  View on map →
                </button>
              </div>
            </div>
            <div className="storm-legend-row">
              {STORM_LEGEND.map(({ tier, label, range }) => (
                <span key={tier} className={`slr-item ${tier}`}>
                  <span className="slr-dot" />
                  <span className="slr-label">{label}</span>
                  <span className="slr-range">{range}</span>
                </span>
              ))}
            </div>
            <div className="storms-ocean-grid">
              {OCEAN_COLS.map(({ key, label }) => {
                const col = storms
                  .filter(s => s.ocean === key)
                  .sort((a, b) => (b.wind_kts ?? 0) - (a.wind_kts ?? 0))
                  .slice(0, 5);
                return (
                  <div key={key} className="storms-ocean-col">
                    <div className="soc-head">{label}</div>
                    {col.length === 0 ? (
                      <div className="soc-empty">Quiet</div>
                    ) : (
                      col.map(storm => (
                        <StormCell key={storm.id} storm={storm} onOpen={setDetailStorm} />
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 5. Alerts */}
        <section className="db-section">
          <div className="db-section-head">
            <h2>
              Alerts{' '}
              <span className="s-count">
                {alerts.length} total
                {firingAlerts > 0 ? ` · ${firingAlerts} firing` : ''}
              </span>
            </h2>
            <div className="s-actions">
              <button className="db-btn primary" onClick={() => navigate('/alerts')}>
                <IconPlus /> New alert
              </button>
            </div>
          </div>

          {alerts.length === 0 ? (
            <div className="alerts-empty">
              No alerts yet.{' '}
              <button className="db-btn ghost" onClick={() => navigate('/alerts')}>
                Create your first alert →
              </button>
            </div>
          ) : (
            alerts.map(alert => {
              const active = alert.active;
              const triggered = alert.lastTriggered;
              const state = !active ? 'snoozed' : triggered ? 'firing' : 'armed';
              return (
                <div className="alert-list-row" key={alert.id}>
                  <span className={`state-chip ${state}`}>
                    <span className="sc-dot" />
                    {state.charAt(0).toUpperCase() + state.slice(1)}
                  </span>
                  <span className={`pin-tile alert-pin ${state === 'firing' ? 'firing' : state === 'armed' ? 'solid' : 'flat'}`}>
                    {(alert.spot || '??').substring(0, 2).toUpperCase()}
                  </span>
                  <div className="alert-spot-cell">
                    {alert.spot}
                    {alert.spot_id && <span className="asc-reg">{alert.spot_id}</span>}
                  </div>
                  <div className="alert-rule">
                    <span className="ar-v">{alert.condition}</span>
                  </div>
                  <div className="ch-icons">
                    <span className="ch-icon" title="Push"><IconPhone /></span>
                    <span className="ch-icon" title="Email"><IconEmail /></span>
                  </div>
                  <div className="alert-next">
                    {triggered ? (
                      <>Last fire<br /><span className="an-v">{new Date(triggered).toLocaleDateString()}</span></>
                    ) : (
                      <>Watching</>
                    )}
                  </div>
                  <AlertSwitch on={active} onToggle={() => toggleAlert(alert.id, active)} />
                </div>
              );
            })
          )}
        </section>

        {/* 6. Year in Surf */}
        <section className="db-section">
          <div className="db-section-head">
            <h2>{new Date().getFullYear()} · Year in surf</h2>
            <div className="s-actions">
              {profile.skill_level && (
                <span className="meta-badge aqua" style={{ textTransform: 'capitalize' }}>
                  {profile.skill_level}
                </span>
              )}
              <button className="db-btn ghost" onClick={() => navigate('/journal')}>
                View full year →
              </button>
            </div>
          </div>

          <div className="yis-grid">
            <div className="yis-cell">
              <div className="yis-label">Sessions</div>
              <div className="yis-value">{yis.count || '—'}</div>
              <div className="yis-sub">this year</div>
            </div>
            <div className="yis-cell">
              <div className="yis-label">Waves</div>
              <div className="yis-value">{yis.totalWaves || '—'}</div>
              <div className="yis-sub">
                {yis.count > 0 ? `est · ${(yis.totalWaves / yis.count).toFixed(1)} / sesh` : '—'}
              </div>
            </div>
            <div className="yis-cell">
              <div className="yis-label">Water time</div>
              <div className="yis-value">
                {yis.totalMin > 0 ? (
                  <>
                    {Math.floor(yis.totalMin / 60)}
                    <span className="yis-unit">h {yis.totalMin % 60}m</span>
                  </>
                ) : '—'}
              </div>
              <div className="yis-sub">
                {yis.count > 0 && yis.totalMin > 0
                  ? `avg ${Math.round(yis.totalMin / yis.count)} min`
                  : '—'}
              </div>
            </div>
            <div className="yis-cell">
              <div className="yis-label">Longest</div>
              <div className="yis-value">
                {yis.longest > 0 ? (
                  <>{yis.longest}<span className="yis-unit">m</span></>
                ) : '—'}
              </div>
              <div className="yis-sub">
                {yis.longest > 0 ? `${fmtDuration(yis.longest)} session` : '—'}
              </div>
            </div>
          </div>

          <div className="yis-foot">
            <div>
              <div className="yis-label">30-day streak</div>
              <StreakStrip sessions={sessions} />
            </div>
            <div>
              <div className="yis-label">Top spot this year</div>
              {yis.topSpot ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
                    {yis.topSpot[0]}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--muted)' }}>
                    {yis.topSpot[1]} session{yis.topSpot[1] !== 1 ? 's' : ''}
                    {yis.count > 0 ? ` · ${Math.round((yis.topSpot[1] / yis.count) * 100)}% of the year` : ''}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Log your first session →</div>
              )}
            </div>
          </div>
        </section>

        {/* 6 + 7: Quiver + Recent sessions side by side */}
        <div className="dash-row-2col">

          {/* Quiver (stubbed — no API yet) */}
          <section className="db-section">
            <div className="db-section-head">
              <h2>Quiver <span className="s-count">coming soon</span></h2>
              <div className="s-actions">
                <button className="db-btn" disabled style={{ opacity: 0.45 }}>
                  <IconPlus /> Add board
                </button>
              </div>
            </div>
            <div className="quiver-empty">
              Board tracking coming soon.
            </div>
          </section>

          {/* Recent Sessions */}
          <section className="db-section">
            <div className="db-section-head">
              <h2>Recent sessions</h2>
              <div className="s-actions">
                <button className="db-btn primary" onClick={() => navigate('/journal')}>
                  <IconPlus /> Log session
                </button>
              </div>
            </div>

            {recentSessions.length === 0 ? (
              <div className="sessions-empty">
                No sessions logged yet.{' '}
                <button className="db-btn ghost" onClick={() => navigate('/journal')}>
                  Log your first →
                </button>
              </div>
            ) : (
              recentSessions.map(s => {
                const tier = ratingTier(s.rating || s.perceived_quality || 0);
                const metaParts = [];
                if (s.swell) metaParts.push(`${s.swell}ft`);
                if (s.wind) metaParts.push(`${s.wind}mph wind`);
                return (
                  <div className="session-log-row" key={s.id} onClick={() => navigate('/journal')}>
                    <span className="sess-date">{fmtSessionDate(s.date)}</span>
                    <span className={`tier-dot ${tier}`} />
                    <div className="sess-info">
                      <div className="sess-spot">{s.spot || 'Unknown spot'}</div>
                      <div className="sess-meta">
                        {metaParts.length > 0 ? metaParts.join(' · ') : (s.note || s.size || '—')}
                      </div>
                    </div>
                    <div className="sess-stats">
                      {fmtDuration(s.duration)}
                      <br />
                      <span className="ss-sub">{s.waves ? `${s.waves} waves` : '—'}</span>
                    </div>
                  </div>
                );
              })
            )}

            {recentSessions.length > 0 && (
              <div style={{ padding: '11px 20px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                <button className="db-btn ghost" onClick={() => navigate('/journal')}>
                  View all sessions →
                </button>
              </div>
            )}
          </section>
        </div>

      </div>
    </div>
  );
}
