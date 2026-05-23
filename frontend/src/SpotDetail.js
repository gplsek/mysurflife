import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from './AuthContext';
import LogoPulse from './design/LogoPulse';
import Logo from './design/Logo';
import { Compass, ForecastScrubber, DayPicker, ConditionsGrid, BreakFacts, SpotTitle, SwellBreakdown, StripChartStack } from './components/spot';
import AISpotAnalysis from './AISpotAnalysis';
import SwellWindRose from './components/SwellWindRose';
import './SpotDetail.css';

// ─── Map controller ───────────────────────────────────────────────
const MapInteractionController = ({ isRelocateMode }) => {
  const map = useMap();
  useEffect(() => {
    if (isRelocateMode) {
      map.dragging.enable(); map.touchZoom.enable(); map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable(); map.boxZoom.enable(); map.keyboard.enable();
    } else {
      map.dragging.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable(); map.boxZoom.disable(); map.keyboard.disable();
    }
  }, [isRelocateMode, map]);
  return null;
};

// ─── Degree helpers ───────────────────────────────────────────────
function degreesToCardinal(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16] || '';
}

function getPeriodLabel(s) {
  if (!s) return '';
  if (s >= 14) return 'Groundswell';
  if (s >= 8)  return 'Swell';
  return 'Wind swell';
}

function getWetsuitRec(tempF) {
  if (!tempF) return '';
  if (tempF >= 72) return 'Boardshorts';
  if (tempF >= 65) return 'Spring suit';
  if (tempF >= 60) return '2/2 or 3/2';
  if (tempF >= 55) return '3/2';
  if (tempF >= 50) return '4/3';
  return '5/4 + hood';
}

function getWaveSizeLabel(ft) {
  if (!ft || ft < 0.5) return '';
  if (ft < 1.5) return 'Ankle–knee';
  if (ft < 2.5) return 'Waist high';
  if (ft < 3.5) return 'Chest high';
  if (ft < 5) return 'Head high';
  if (ft < 7) return 'Overhead';
  if (ft < 10) return 'Double overhead';
  return 'Triple overhead';
}

function getWaveCategory(ft) {
  if (!ft) return null;
  if (ft < 1) return 1;
  if (ft < 2) return 2;
  if (ft < 3) return 3;
  if (ft < 5) return 4;
  if (ft < 8) return 5;
  return 5;
}

// ─── SpotDetail ───────────────────────────────────────────────────
const SpotDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, signOut } = useAuth();

  const [spot, setSpot] = useState(null);
  const [conditions, setConditions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [buoyData, setBuoyData] = useState({});
  const [modelForecast, setModelForecast] = useState(null);
  const [modelLoading, setModelLoading] = useState(true);

  const [forecastTimeline, setForecastTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const timelineFetchedForRef = useRef(null);

  const [selectedHour, setSelectedHour] = useState(0);

  const [isEditMode, setIsEditMode] = useState(false);
  const [isRelocateMode, setIsRelocateMode] = useState(false);
  const [editedSpot, setEditedSpot] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [favLoading, setFavLoading] = useState(false);

  useEffect(() => {
    const h = (e) => { if (menuOpen && !e.target.closest('.sd-menu-container')) setMenuOpen(false); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [menuOpen]);

  const handleSignOut = async () => { setMenuOpen(false); await signOut(); navigate('/'); };

  // Phase 1: critical data
  useEffect(() => {
    const fetch_ = async () => {
      try {
        setLoading(true);
        const [spotRes, condRes] = await Promise.all([
          fetch(`/api/surf-spots/${slug}`),
          fetch(`/api/surf-spots/${slug}/conditions`),
        ]);
        if (!spotRes.ok) throw new Error(`Failed to fetch spot: ${spotRes.status}`);
        if (!condRes.ok) throw new Error(`Failed to fetch conditions: ${condRes.status}`);
        setSpot(await spotRes.json());
        setConditions(await condRes.json());
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [slug]);

  // Favorites
  useEffect(() => {
    if (!user || !slug) return;
    import('./supabaseClient').then(({ getAuthHeaders }) =>
      getAuthHeaders().then(headers => {
        if (!headers['Authorization']) return;
        fetch('/api/user/favorites', { headers })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.favorites) setIsFav(d.favorites.includes(slug)); })
          .catch(() => {});
      })
    );
  }, [user, slug]);

  const handleToggleFav = async () => {
    if (!user || favLoading) return;
    setFavLoading(true);
    const next = !isFav;
    setIsFav(next);
    try {
      const { getAuthHeaders } = await import('./supabaseClient');
      const headers = await getAuthHeaders();
      if (!headers['Authorization']) { setIsFav(!next); return; }
      const res = next
        ? await fetch('/api/user/favorites', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) })
        : await fetch(`/api/user/favorites/${slug}`, { method: 'DELETE', headers });
      if (!res.ok) setIsFav(!next);
    } catch { setIsFav(!next); }
    finally { setFavLoading(false); }
  };


  // Phase 2: buoys
  useEffect(() => {
    if (!spot) return;
    fetch('/api/buoy-status/all').then(r => r.ok ? r.json() : []).then(arr => {
      const m = {};
      arr.forEach(b => { if (b.station) m[b.station] = b; });
      setBuoyData(m);
    }).catch(() => {});
  }, [spot]);

  // Phase 3: model forecast
  useEffect(() => {
    if (!spot) return;
    setModelLoading(true);
    fetch(`/api/surf-spots/${slug}/model-forecast`)
      .then(r => r.ok ? r.json() : null).then(d => setModelForecast(d)).catch(() => {})
      .finally(() => setModelLoading(false));
  }, [slug, spot]);

  // Phase 4: timeline (168h)
  useEffect(() => {
    if (!spot) return;
    // Guard: skip if already successfully fetched for this slug (prevents StrictMode double-fire
    // and any re-renders that change `spot` reference without actually changing the spot).
    if (timelineFetchedForRef.current === slug) return;
    setTimelineLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    fetch(`/api/surf-spots/${slug}/forecast-timeline?hours=168`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.timeline) {
          setForecastTimeline(d);
          timelineFetchedForRef.current = slug;
        }
      })
      .catch(() => {})
      .finally(() => { clearTimeout(t); setTimelineLoading(false); });
    return () => ctrl.abort();
  }, [slug, spot]);

  // ─── Data helpers ───
  const getForecastAtHour = (hour) => {
    if (!forecastTimeline?.timeline) return null;
    const exact = forecastTimeline.timeline.find(p => p.hour === hour);
    if (exact) return exact;
    return forecastTimeline.timeline.reduce((best, p) =>
      Math.abs(p.hour - hour) < Math.abs(best.hour - hour) ? p : best
    );
  };

  const getSwellsForHour = () => {
    const swell_colors = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
    const swell_rings = ['mid', 'mid', 'inner'];

    if (selectedHour === 0 || !forecastTimeline?.timeline) {
      const swells = [];
      for (let k = 1; k <= 3; k++) {
        const s = conditions?.[`swell_${k}`];
        if (s?.height_ft >= 0.3) {
          swells.push({ height_ft: s.height_ft, period_s: s.period, direction_deg: s.direction, color: swell_colors[k-1], ring: swell_rings[k-1] });
        }
      }
      if (!swells.length && conditions?.adjusted_height_ft) {
        swells.push({ height_ft: conditions.adjusted_height_ft, period_s: conditions.period_sec, direction_deg: conditions.swell_direction, color: 'var(--s1)', ring: 'mid' });
      }
      return swells;
    }
    const pt = getForecastAtHour(selectedHour);
    if (!pt) return [];
    const swells = [];
    for (let k = 1; k <= 3; k++) {
      const s = pt.wave?.[`swell_${k}`];
      if (s?.height_ft) {
        swells.push({ height_ft: s.height_ft, period_s: s.period, direction_deg: s.direction, color: swell_colors[k-1], ring: swell_rings[k-1] });
      }
    }
    if (!swells.length && pt.wave?.height_ft) {
      swells.push({ height_ft: pt.wave.height_ft, period_s: pt.wave.period, direction_deg: pt.wave.direction, color: 'var(--s1)', ring: 'mid' });
    }
    return swells;
  };

  const getWindForHour = () => {
    if (selectedHour === 0) {
      const spd = conditions?.wind_speed_mph ?? modelForecast?.models?.hrrr?.wind_speed_mph;
      const dir = conditions?.wind_direction ?? modelForecast?.models?.hrrr?.wind_direction;
      if (spd && dir) return { speed_mph: spd, direction_deg: dir, color: 'var(--wind)' };
      return null;
    }
    const pt = getForecastAtHour(selectedHour);
    if (!pt?.wind?.speed_mph || !pt?.wind?.direction) return null;
    return { speed_mph: pt.wind.speed_mph, direction_deg: pt.wind.direction, color: 'var(--wind)' };
  };

  const getConditionsForGrid = () => {
    if (selectedHour === 0) {
      const windSpd = conditions?.wind_speed_mph ?? modelForecast?.models?.hrrr?.wind_speed_mph;
      const windDir = conditions?.wind_direction ?? modelForecast?.models?.hrrr?.wind_direction;
      const waveFt = conditions?.surf_height_ft ?? conditions?.adjusted_height_ft;
      const waterTempF = conditions?.water_temp_c ? conditions.water_temp_c * 9 / 5 + 32 : null;

      // Tide from timeline h=0 (tide data lives in timeline, not /conditions)
      const tidePt0 = getForecastAtHour(0);
      const tidePt1 = getForecastAtHour(6);
      const tide0 = tidePt0?.tide_ft ?? null;
      const tide0Trend = tide0 != null && tidePt1?.tide_ft != null
        ? tide0 < tidePt1.tide_ft ? 'rising' : 'falling'
        : null;
      const allTides0 = (forecastTimeline?.timeline ?? []).map(p => p.tide_ft).filter(v => v != null);
      const minT0 = allTides0.length ? Math.min(...allTides0) : 0;
      const maxT0 = allTides0.length ? Math.max(...allTides0) : 10;
      const tideRange0 = maxT0 - minT0;
      const tidePos0 = tide0 != null && tideRange0 > 0
        ? tide0 < minT0 + tideRange0 / 3 ? 'Low'
        : tide0 < minT0 + tideRange0 * 2 / 3 ? 'Mid'
        : 'High'
        : null;

      return {
        wave_face_ft: waveFt,
        category_label: waveFt
          ? `Cat ${getWaveCategory(waveFt)} · ${getWaveSizeLabel(waveFt)}`
          : conditions?.rating || null,
        period_s: conditions?.period_sec,
        period_label: getPeriodLabel(conditions?.period_sec),
        primary_dir_deg: conditions?.swell_direction,
        primary_dir_label: degreesToCardinal(conditions?.swell_direction),
        wind_mph: windSpd,
        wind_label: windDir ? `${degreesToCardinal(windDir)} · ${Math.round(windDir)}°` : null,
        tide_ft: tide0,
        tide_trend: tide0Trend,
        tide_position: tidePos0,
        water_temp_f: waterTempF,
        wetsuit: waterTempF ? getWetsuitRec(waterTempF) : null,
      };
    }
    const pt = getForecastAtHour(selectedHour);
    if (!pt) return null;

    const waveFt = pt.wave?.surf_height_ft ?? pt.wave?.wave_face_ft ?? pt.wave?.height_ft;
    const period = pt.wave?.period_s ?? pt.wave?.period;
    const dirDeg = pt.wave?.direction_deg ?? pt.wave?.direction;
    const windDirDeg = pt.wind?.direction_deg ?? pt.wind?.direction;

    // Tide trend: compare to previous hour
    const ptPrev = getForecastAtHour(Math.max(0, selectedHour - 1));
    const tideTrend = pt.tide_ft != null && ptPrev?.tide_ft != null
      ? pt.tide_ft > ptPrev.tide_ft ? 'rising' : 'falling'
      : null;

    // Tide position: low/mid/high relative to full-forecast range
    const allTides = (forecastTimeline?.timeline ?? []).map(p => p.tide_ft).filter(v => v != null);
    const minT = allTides.length ? Math.min(...allTides) : 0;
    const maxT = allTides.length ? Math.max(...allTides) : 10;
    const tideRange = maxT - minT;
    const tidePos = pt.tide_ft != null && tideRange > 0
      ? pt.tide_ft < minT + tideRange / 3 ? 'Low'
      : pt.tide_ft < minT + tideRange * 2 / 3 ? 'Mid'
      : 'High'
      : null;

    // Water temp: doesn't change hour-to-hour — use spot data
    const waterTempF = spot?.water_temp_c ? spot.water_temp_c * 9 / 5 + 32 : null;

    return {
      wave_face_ft: waveFt,
      category_label: waveFt ? `Cat ${getWaveCategory(waveFt)} · ${getWaveSizeLabel(waveFt)}` : null,
      period_s: period,
      period_label: getPeriodLabel(period),
      primary_dir_deg: dirDeg,
      primary_dir_label: degreesToCardinal(dirDeg),
      wind_mph: pt.wind?.speed_mph,
      wind_label: windDirDeg ? `${degreesToCardinal(windDirDeg)} · ${Math.round(windDirDeg)}°` : null,
      tide_ft: pt.tide_ft ?? null,
      tide_trend: tideTrend,
      tide_position: tidePos,
      water_temp_f: waterTempF,
      wetsuit: waterTempF ? getWetsuitRec(waterTempF) : null,
    };
  };

  const getDailyRatings = () => {
    if (!forecastTimeline?.timeline?.length) return [3,3,3,3,3,3,3];
    return Array.from({ length: 7 }, (_, day) => {
      const pts = forecastTimeline.timeline.filter(p => p.hour >= day*24 && p.hour < (day+1)*24);
      if (!pts.length) return 2;
      const avg = pts.reduce((s, p) => s + (p.wave?.height_ft || 0), 0) / pts.length;
      return Math.min(5, Math.max(1, Math.round(avg * 0.9 + 0.5)));
    });
  };

  const getMiniChartData = () => {
    if (!forecastTimeline?.timeline?.length) return [];
    return forecastTimeline.timeline.map(p => ({ t: p.hour, value: p.wave?.height_ft || 0 }));
  };

  const getSwellsEnriched = () => getSwellsForHour().map((s, i) => ({
    ...s,
    direction_label: degreesToCardinal(s.direction_deg),
    type_label: getPeriodLabel(s.period_s),
    category: s.period_s ? Math.min(10, Math.round(s.period_s / 2)) : 0,
  }));

  const getWindEnriched = () => {
    const w = getWindForHour();
    if (!w) return null;
    return { ...w, direction_label: degreesToCardinal(w.direction_deg) };
  };

  // ─── Edit mode handlers ─────────────────────────────────────────
  const enterEditMode = () => {
    const ch = spot.spot_characteristics || {};
    setEditedSpot({
      name: spot.name, region: spot.region, subregion: spot.subregion || '',
      latitude: spot.latitude, longitude: spot.longitude,
      location_description: spot.location_description || '',
      access_description: spot.access_description || '',
      parking_info: spot.parking_info || '',
      break_type: ch.break_type || '', bottom_type: ch.bottom_type || '',
      wave_quality: ch.wave_quality || '', skill_level: ch.skill_level || '',
      best_swell_direction: ch.best_swell_direction || '',
      best_wind_direction: ch.best_wind_direction || '',
      tide_position: ch.tide_position || '',
      works_from_swell_ft: ch.works_from_swell_ft || '',
      works_to_swell_ft: ch.works_to_swell_ft || '',
    });
    setIsEditMode(true);
  };

  const exitEditMode = () => { setIsEditMode(false); setIsRelocateMode(false); setEditedSpot(null); setSaveError(null); };

  const handleSave = async () => {
    if (!editedSpot.name || !editedSpot.region || !editedSpot.skill_level) { setSaveError('Name, Region, Skill Level are required'); return; }
    if (editedSpot.latitude < -90 || editedSpot.latitude > 90) { setSaveError('Invalid latitude'); return; }
    if (editedSpot.longitude < -180 || editedSpot.longitude > 180) { setSaveError('Invalid longitude'); return; }
    try {
      setIsSaving(true); setSaveError(null);
      const token = localStorage.getItem('sb-duebzukxycgfkfjezwjq-auth-token');
      if (!token) throw new Error('Not authenticated');
      const { access_token } = JSON.parse(token);
      const res = await fetch(`/api/admin/surf-spots/${slug}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSpot),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Save failed'); }
      exitEditMode(); window.location.reload();
    } catch (err) { setSaveError(err.message); }
    finally { setIsSaving(false); }
  };

  // ─── Render guards ──────────────────────────────────────────────
  if (loading) return (
    <div className="sd-loading"><LogoPulse size={96} /></div>
  );
  if (error || !spot) return (
    <div className="sd-error">
      <h2>Could not load spot</h2>
      <p>{error || 'Spot not found'}</p>
      <button onClick={() => navigate('/')}>← Back to map</button>
    </div>
  );

  const ch = spot.spot_characteristics || {};
  const lat = (isEditMode && editedSpot ? editedSpot.latitude : spot.latitude) ?? null;
  const lng = (isEditMode && editedSpot ? editedSpot.longitude : spot.longitude) ?? null;
  const hasCoords = lat != null && lng != null;
  const swells = getSwellsForHour();
  const wind = getWindForHour();
  const condGrid = getConditionsForGrid();
  const enrichedSwells = getSwellsEnriched();
  const enrichedWind = getWindEnriched();
  const startDate = new Date();

  const fmtTime = (h) => {
    const d = new Date(startDate);
    d.setHours(d.getHours() + h);
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const h12 = d.getHours() % 12 || 12;
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ap = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${M[d.getMonth()]} ${d.getDate()}, ${h12}:${mm} ${ap}`;
  };

  const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayLegend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return DOW_SHORT[d.getDay()];
  });

  const spotIcon = new L.DivIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:var(--accent,#3EC9D4);border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });

  const eyebrow = [ch.break_type, spot.subregion || spot.region].filter(Boolean).map(s => s.toUpperCase()).join(' · ');

  return (
    <div className="sd">

      {/* ── Map hero ── */}
      <section className="sd-hero">
        <div className="sd-map-bg">
          {hasCoords ? (
            <MapContainer
              center={[lat, lng]} zoom={15}
              dragging={false} touchZoom={false} doubleClickZoom={false}
              scrollWheelZoom={false} boxZoom={false} keyboard={false}
              zoomControl={false} attributionControl={true}
              className="hero-map"
            >
              <MapInteractionController isRelocateMode={isRelocateMode} />
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="&copy; Esri"
              />
              <Marker
                position={[lat, lng]}
                icon={spotIcon}
                draggable={isRelocateMode}
                eventHandlers={isRelocateMode ? {
                  dragend: (e) => {
                    const { lat: la, lng: lo } = e.target.getLatLng();
                    setEditedSpot(s => ({ ...s, latitude: parseFloat(la.toFixed(6)), longitude: parseFloat(lo.toFixed(6)) }));
                  }
                } : {}}
              />
            </MapContainer>
          ) : (
            <div className="hero-map" style={{ background: 'var(--bg-2)' }} />
          )}
          {isRelocateMode && editedSpot && (
            <div className="sd-coord-display">
              {editedSpot.latitude != null ? editedSpot.latitude.toFixed(6) : '—'}, {editedSpot.longitude != null ? editedSpot.longitude.toFixed(6) : '—'}
            </div>
          )}
          {isRelocateMode && (
            <div className="sd-relocate-hint">Drag the pin to reposition · tap Done when finished</div>
          )}
        </div>

        {/* Overlays */}
        <div className="sd-grid" aria-hidden="true" />
        <div className="sd-vignette" aria-hidden="true" />
        <div className="sd-dim" aria-hidden="true" />

        {/* Topbar */}
        <nav className="sd-topbar">
          <button className="sd-chip sd-chip--ghost" onClick={() => navigate('/')}>
            <span style={{ display: 'inline-block', transition: 'transform 0.15s' }}>←</span>
            <span className="sd-chip-label"> Back</span>
          </button>
          <span className="sd-brand">
            <Logo variant="mark" size={22} />
            <span className="sd-brand-text" style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, letterSpacing: '-0.04em' }}>mysurf<span style={{ opacity: 0.6 }}>life</span></span>
          </span>
          {user && (
            <button
              className={`sd-chip sd-chip--fav${isFav ? ' active' : ''}`}
              onClick={handleToggleFav}
              disabled={favLoading}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                <path d="M7 12S1 8.5 1 4.5A3 3 0 017 2.4 3 3 0 0113 4.5C13 8.5 7 12 7 12z"/>
              </svg>
              <span className="sd-chip-label">{isFav ? 'Saved' : 'Save'}</span>
            </button>
          )}
          {isAdmin && !isEditMode && (
            <button className="sd-chip sd-chip--accent" onClick={enterEditMode}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
              <span className="sd-chip-label">Edit</span>
            </button>
          )}
          {isAdmin && isEditMode && !isRelocateMode && (
            <>
              <button className="sd-chip sd-chip--accent" onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </button>
              <button className="sd-chip" onClick={() => setIsRelocateMode(true)} disabled={isSaving}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
                <span className="sd-chip-label">Move pin</span>
              </button>
              <button className="sd-chip" onClick={exitEditMode} disabled={isSaving}>Cancel</button>
            </>
          )}
          {isAdmin && isEditMode && isRelocateMode && (
            <button className="sd-chip sd-chip--accent" onClick={() => setIsRelocateMode(false)}>
              Done
            </button>
          )}
          {user && (
            <div className="sd-menu-container sd-chip--ml" style={{ position: 'relative', marginLeft: 'auto' }}>
              <button className="sd-chip" onClick={() => setMenuOpen(m => !m)}>
                {user.email.slice(0, 2).toUpperCase()}
              </button>
              {menuOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: 180, background: 'var(--bg-2)', border: '1px solid var(--border-strong)', borderRadius: 12, padding: 6, boxShadow: '0 18px 50px rgba(0,0,0,0.55)', zIndex: 50 }}>
                  <div style={{ padding: '10px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)', letterSpacing: '0.1em', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>{user.email}</div>
                  {isAdmin && (
                    <>
                      <Link to="/admin/users" onClick={() => setMenuOpen(false)} style={{ display: 'block', padding: '9px 12px', fontSize: 13, color: 'var(--fg)', borderRadius: 8, textDecoration: 'none' }}>Manage Users</Link>
                      <Link to="/admin/personas" onClick={() => setMenuOpen(false)} style={{ display: 'block', padding: '9px 12px', fontSize: 13, color: 'var(--fg)', borderRadius: 8, textDecoration: 'none' }}>Manage Personas</Link>
                    </>
                  )}
                  <button onClick={handleSignOut} style={{ display: 'block', width: '100%', padding: '9px 12px', fontSize: 13, color: 'var(--fire)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 8 }}>Sign Out</button>
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Spot title */}
        <div className="sd-title-wrap">
          <SpotTitle name={spot.name} eyebrow={eyebrow} />
        </div>

        {/* Compass */}
        <div className="sd-compass-wrap">
          <Compass swells={swells} wind={wind} size={520} />
        </div>
      </section>

      {/* ── Content ── */}
      <main className="sd-content">

        {saveError && <div className="sd-save-error" style={{ marginBottom: 16 }}>{saveError}</div>}

        {/* Forecast Timeline card */}
        <div className="sd-card">
          <div className="sd-card-head">
            <div>
              <div className="sd-card-title">Forecast Timeline</div>
              <div className="sd-card-sub">Scrub through the next 7 days · <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>168h</span> · <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', textDecoration: 'none', fontSize: '0.85em' }}>Open-Meteo</a></div>
            </div>
            <DayPicker
              startDate={startDate}
              selectedHour={selectedHour}
              dailyRatings={getDailyRatings()}
              onSelectDay={(dayIdx) => {
                const hourInDay = selectedHour % 24;
                setSelectedHour(Math.min(168, dayIdx * 24 + hourInDay));
              }}
            />
          </div>

          {timelineLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
              <LogoPulse size={24} compact />
            </div>
          ) : (
            <ForecastScrubber
              totalHours={168}
              selectedHour={selectedHour}
              onChange={setSelectedHour}
              miniChartData={getMiniChartData()}
              startDate={startDate}
            />
          )}

          {/* Legend */}
          <div className="sd-legend">
            {swells.map((s, i) => {
              const types = ['primary', 'secondary', 'wind swell'];
              return (
                <span key={i}>
                  <span className="sd-legend-dot" style={{ background: s.color }} />
                  {degreesToCardinal(s.direction_deg)} {Math.round(s.direction_deg || 0)}° {types[i] || `swell ${i + 1}`}
                </span>
              );
            })}
            {wind && (
              <span>
                <span className="sd-legend-dot" style={{ background: 'var(--wind)' }} />
                Wind {degreesToCardinal(wind.direction_deg)} {Math.round(wind.direction_deg || 0)}°
              </span>
            )}
          </div>
        </div>

        {/* Conditions card */}
        <div className="sd-card">
          <ConditionsGrid
            conditions={condGrid}
            showTabs
            title={selectedHour === 0 ? 'Current Conditions' : `Forecast Conditions (+${selectedHour}hrs)`}
            subtitle={selectedHour === 0 ? 'Live + model data' : fmtTime(selectedHour)}
          />
          <BreakFacts
            breakType={ch.break_type ? `${ch.break_type.charAt(0).toUpperCase() + ch.break_type.slice(1)} break` : '—'}
            bestDirection={ch.best_swell_direction || '—'}
            bestTide={ch.tide_position || '—'}
            hazards={Array.isArray(ch.hazards) ? ch.hazards.join(', ') : ch.hazards || '—'}
          />
          {(spot.spot_swell_windows?.length > 0 || spot.spot_wind_windows?.length > 0) && (
            <div className="sd-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: 'var(--muted)', marginBottom: 8 }}>Exposure</div>
              <SwellWindRose
                swell={spot.spot_swell_windows || []}
                wind={spot.spot_wind_windows || []}
                size={180}
              />
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center',
                            marginTop: 8, fontSize: 11, color: 'var(--fg-2)' }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                      background: 'var(--accent)', marginRight: 4 }} />swell</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                      background: 'var(--good)', marginRight: 4 }} />offshore wind</span>
              </div>
            </div>
          )}
        </div>

        {/* Two-column: Swells + Strip charts */}
        <div className="sd-cols-2">

          {/* Left: Swells in the water + AI note */}
          <div className="sd-card">
            <SwellBreakdown
              swells={enrichedSwells}
              wind={enrichedWind}
              detectedCount={enrichedSwells.length}
            />
            <AISpotAnalysis spotSlug={slug} spotName={spot.name} isAdmin={isAdmin} isEditMode={isEditMode} />
          </div>

          {/* Right: 7-day strip charts */}
          <div className="sd-card">
            <div className="sd-card-head" style={{ marginBottom: 14 }}>
              <div>
                <div className="sd-card-title">Wave · Wind · Tide</div>
                <div className="sd-card-sub">7-day strip · yellow line = selected time</div>
              </div>
            </div>
            {timelineLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <LogoPulse size={24} compact />
              </div>
            ) : (
              <StripChartStack
                data={forecastTimeline?.timeline || []}
                cursorHour={selectedHour}
              />
            )}
            <div className="sd-day-legend">
              {dayLegend.map((day, i) => <span key={i}>{day}</span>)}
            </div>
          </div>

        </div>

        {/* Edit form */}
        {isEditMode && editedSpot && (
          <div className="sd-card" style={{ marginTop: 18 }}>
            <div className="sd-card-title" style={{ marginBottom: 20 }}>Edit Spot</div>
            <div className="sd-edit-form">
              <div className="sd-form-section">
                <h3>Basic Info</h3>
                <SdField label="Name *" value={editedSpot.name} onChange={v => setEditedSpot({...editedSpot, name: v})} />
                <SdField label="Region *" value={editedSpot.region} onChange={v => setEditedSpot({...editedSpot, region: v})} />
                <SdField label="Subregion" value={editedSpot.subregion} onChange={v => setEditedSpot({...editedSpot, subregion: v})} />
              </div>
              <div className="sd-form-section">
                <h3>Characteristics</h3>
                <SdSelect label="Break Type" value={editedSpot.break_type} onChange={v => setEditedSpot({...editedSpot, break_type: v})} options={['beach','reef','point','river_mouth','jetty','mixed']} />
                <SdSelect label="Bottom Type" value={editedSpot.bottom_type} onChange={v => setEditedSpot({...editedSpot, bottom_type: v})} options={['sand','rock','reef','cobblestone','mixed']} />
                <SdSelect label="Wave Quality" value={editedSpot.wave_quality} onChange={v => setEditedSpot({...editedSpot, wave_quality: v})} options={['world_class','regional_classic','good','fun']} />
                <SdSelect label="Skill Level *" value={editedSpot.skill_level} onChange={v => setEditedSpot({...editedSpot, skill_level: v})} options={['beginner','intermediate','experienced','expert','pros_only']} />
              </div>
              <div className="sd-form-section">
                <h3>Conditions</h3>
                <SdField label="Best Swell Direction" value={editedSpot.best_swell_direction} onChange={v => setEditedSpot({...editedSpot, best_swell_direction: v})} placeholder="e.g. NW, W, SW" />
                <SdField label="Best Wind Direction" value={editedSpot.best_wind_direction} onChange={v => setEditedSpot({...editedSpot, best_wind_direction: v})} placeholder="e.g. E, NE" />
                <SdField label="Tide Position" value={editedSpot.tide_position} onChange={v => setEditedSpot({...editedSpot, tide_position: v})} placeholder="low, mid, high, all" />
                <div className="sd-form-row">
                  <SdField label="Works From (ft)" type="number" value={editedSpot.works_from_swell_ft} onChange={v => setEditedSpot({...editedSpot, works_from_swell_ft: parseFloat(v)||''})} />
                  <SdField label="Works To (ft)" type="number" value={editedSpot.works_to_swell_ft} onChange={v => setEditedSpot({...editedSpot, works_to_swell_ft: parseFloat(v)||''})} />
                </div>
              </div>
              <div className="sd-form-section">
                <h3>Location &amp; Access</h3>
                <SdTextarea label="Location Description" value={editedSpot.location_description} onChange={v => setEditedSpot({...editedSpot, location_description: v})} />
                <SdTextarea label="Access Description" value={editedSpot.access_description} onChange={v => setEditedSpot({...editedSpot, access_description: v})} />
                <SdTextarea label="Parking Info" rows={2} value={editedSpot.parking_info} onChange={v => setEditedSpot({...editedSpot, parking_info: v})} />
              </div>
            </div>
          </div>
        )}

        {/* Data Sources (collapsed) */}
        <div className="sd-sources">
          <button className="sd-sources-toggle" onClick={() => setShowSources(s => !s)}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: showSources ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
            Data Sources
          </button>
          {showSources && (
            <>
              {!modelLoading && modelForecast?.models?.ww3 && !modelForecast.models.ww3.error && (
                <div className="sd-source-row">
                  <div className="sd-source-head">
                    <span className="sd-source-id">WW3</span>
                    <span className="sd-source-name">{modelForecast.models.ww3.model}</span>
                    <span className="sd-source-role">({modelForecast.models.ww3.resolution})</span>
                  </div>
                  <div className="sd-source-data">
                    {modelForecast.models.ww3.wave_height_ft != null && <span className="sd-source-item">{modelForecast.models.ww3.wave_height_ft.toFixed(1)}ft</span>}
                    {modelForecast.models.ww3.period_sec != null && <span className="sd-source-item">{modelForecast.models.ww3.period_sec.toFixed(1)}s</span>}
                    {modelForecast.models.ww3.direction != null && <span className="sd-source-item">{modelForecast.models.ww3.direction}°</span>}
                    <span className="sd-source-item" style={{ color: 'var(--muted)' }}>~{modelForecast.models.ww3.grid_distance_km?.toFixed(0)}km</span>
                  </div>
                </div>
              )}
              {!modelLoading && modelForecast?.models?.hrrr && !modelForecast.models.hrrr.error && (
                <div className="sd-source-row">
                  <div className="sd-source-head">
                    <span className="sd-source-id">HRRR</span>
                    <span className="sd-source-name">Wind model</span>
                    <span className="sd-source-role">({modelForecast.models.hrrr.resolution})</span>
                  </div>
                  <div className="sd-source-data">
                    {modelForecast.models.hrrr.wind_speed_mph != null && <span className="sd-source-item">{modelForecast.models.hrrr.wind_speed_mph.toFixed(0)}mph</span>}
                    {modelForecast.models.hrrr.wind_direction != null && <span className="sd-source-item">{modelForecast.models.hrrr.wind_direction}°</span>}
                    <span className="sd-source-item" style={{ color: 'var(--muted)' }}>~{modelForecast.models.hrrr.grid_distance_km?.toFixed(0)}km</span>
                  </div>
                </div>
              )}
              {conditions?.buoys_used?.map((buoy, i) => {
                const id = buoy.id || buoy;
                const info = buoyData[id];
                return (
                  <div key={id || i} className="sd-source-row">
                    <div className="sd-source-head">
                      <span className="sd-source-id">{id}</span>
                      {info?.name && <span className="sd-source-name">{info.name}</span>}
                      {buoy.weight && <span className="sd-source-role">{(buoy.weight*100).toFixed(0)}%</span>}
                      {buoy.role && <span className="sd-source-role">({buoy.role})</span>}
                    </div>
                    {info && (
                      <div className="sd-source-data">
                        {info.wave_height_m != null && <span className="sd-source-item">{(info.wave_height_m*3.28084).toFixed(1)}ft</span>}
                        {info.dominant_period_sec != null && <span className="sd-source-item">{info.dominant_period_sec.toFixed(1)}s</span>}
                        {info.mean_wave_dir != null && <span className="sd-source-item">{info.mean_wave_dir}°</span>}
                        {info.wind_speed_ms != null && <span className="sd-source-item">{(info.wind_speed_ms*2.23694).toFixed(0)}mph wind</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

      </main>
    </div>
  );
};

// ─── Form helpers ─────────────────────────────────────────────────
const SdField = ({ label, value, onChange, type = 'text', placeholder = '' }) => (
  <div className="sd-field">
    <label>{label}</label>
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

const SdSelect = ({ label, value, onChange, options }) => (
  <div className="sd-field">
    <label>{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">-- Select --</option>
      {options.map(o => <option key={o} value={o}>{o.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
    </select>
  </div>
);

const SdTextarea = ({ label, value, onChange, rows = 3, placeholder = '' }) => (
  <div className="sd-field">
    <label>{label}</label>
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder} />
  </div>
);

export default SpotDetail;
