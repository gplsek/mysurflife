import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CARTO_DARK, CARTO_LABELS, CARTO_LIGHT, CARTO_LIGHT_LABELS, CARTO_ATTR, REGIONS } from '../components/map/constants';
import { buildClusters }                                  from '../components/map/clusterGrid';
import { spotMarkerHtml, buoyMarkerHtml, clusterMarkerHtml, userSpotMarkerHtml } from '../components/map/markers';
import { stormMarkerHtml }                                from '../components/map/StormMarker';
import { useMapBundle }                                   from '../components/map/useMapBundle';
import Chrome                                             from '../components/map/Chrome';
import { StormCard }                                      from '../components/map/StormCard';
import { WindTileController, fetchWindManifest, prefetchFrame,
         waveTileUrl, waveUVUrl, fetchWaveManifest }      from '../components/overlays/WindTileLayer';
import { WindParticlesGL, windUVUrl }                     from '../components/overlays/WindParticlesLayerGL';
import WindLegend                                         from '../components/overlays/WindLegend';
import WaveLegend                                         from '../components/overlays/WaveLegend';
import LogoPulse                                          from '../design/LogoPulse';
import '../styles/map-v2.css';
import '../styles/storm-card.css';

const BREAK_TYPES = ['beach', 'reef', 'point', 'river_mouth', 'jetty', 'mixed'];

function AddSpotForm({ lat, lng, onSave, onCancel }) {
  const [name, setName]           = useState('');
  const [breakType, setBreakType] = useState('');
  const [saving, setSaving]       = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), breakType });
    setSaving(false);
  };

  return (
    <div className="mv-add-spot-form">
      <div className="mv-asf-head">
        <span className="mv-asf-title">New Spot</span>
        <span className="mv-asf-coords">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
      </div>
      <form onSubmit={handleSubmit}>
        <input
          className="mv-asf-input"
          placeholder="Spot name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          maxLength={120}
        />
        <select
          className="mv-asf-select"
          value={breakType}
          onChange={e => setBreakType(e.target.value)}
        >
          <option value="">Break type (optional)</option>
          {BREAK_TYPES.map(t => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ')}</option>
          ))}
        </select>
        <div className="mv-asf-actions">
          <button type="button" className="mv-asf-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="mv-asf-save" disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save spot'}
          </button>
        </div>
      </form>
    </div>
  );
}

function inBbox(spot, bbox) {
  const [[s, w], [n, e]] = bbox;
  return spot.latitude >= s && spot.latitude <= n && spot.longitude >= w && spot.longitude <= e;
}

function celsiusToF(c) {
  if (c == null) return null;
  return ((c * 9) / 5 + 32).toFixed(0);
}

// Storm strength filter (client-side). Thresholds in knots; falls back to
// warning_tier when a system has no parsed wind speed.
const STRENGTH_MIN_KTS = { all: 0, gale: 34, storm: 48, hurricane: 64 };
const TIER_KTS = { gale: 34, storm: 48, hurricane: 64 };

function stormPassesStrength(storm, level) {
  if (!level || level === 'all') return true;
  const min = STRENGTH_MIN_KTS[level] ?? 0;
  const kts = storm.wind_kts ?? storm.peak_wind_kts;
  if (kts != null) return kts >= min;
  const tierKts = TIER_KTS[storm.warning_tier];
  return tierKts != null ? tierKts >= min : false;   // hide unknown-strength when filtering
}

export default function Map({ state, stateRef, toggleState, setRegion, setQuery, setStormStrength }) {
  const mapContainerRef  = useRef(null);
  const mapRef           = useRef(null);
  const baseTileRef      = useRef(null);
  const labelTileRef     = useRef(null);
  const markersRef       = useRef([]);
  const renderTimerRef   = useRef(null);
  const lastRenderKeyRef = useRef('');
  const curHRef          = useRef(0);

  const [curH,          setCurH]          = useState(0);
  const [preview,       setPreview]       = useState(null);
  const [buoyPreview,   setBuoyPreview]   = useState(null);
  const [inViewCount,   setInViewCount]   = useState(0);
  const [stormPreview,  setStormPreview]  = useState(null);
  const [detailStorm,   setDetailStorm]   = useState(null);
  const queryFlyRef    = useRef('');
  const stormOpenedRef = useRef(false);

  // Wind overlay (tiles + GL particles), driven by the shared timeline curH
  const windCtlRef       = useRef(null);
  const windParticlesRef = useRef(null);
  const coastRef         = useRef(null);
  const [windManifest, setWindManifest] = useState(null);
  const [windVar, setWindVar] = useState(() =>
    localStorage.getItem('mv-wind-variable') === 'gust' ? 'gust' : 'speed'
  );
  const pickWindVar = (v) => {
    localStorage.setItem('mv-wind-variable', v);
    setWindVar(v);
  };

  // Wave overlay (waves = HTSGW, swell = partition-1) — same tile+particle
  // machinery as wind, pointed at /api/tiles/waves. Particle speed is deep-
  // water group velocity, so the color ramp maps it back to period seconds.
  const waveCtlRef        = useRef(null);
  const waveParticlesRef  = useRef(null);
  const waveParticlesVarRef = useRef(null);
  const [waveManifest, setWaveManifest] = useState(null);
  const waveActive = state.showWaves || state.showSwell;
  const waveVar = state.showSwell ? 'swell' : 'height';
  const WAVE_PERIOD_RAMP = useMemo(() => ({
    ramp: 'wave_period',
    valueAt: (t) => (t * 40 * 4 * Math.PI) / 9.8,  // group vel m/s → period s
  }), []);

  // True while the visible overlay's next frame is still loading tiles —
  // drives a small pulse in the legend so a cold hour reads as "loading",
  // not "the slider is broken".
  const [overlayLoading, setOverlayLoading] = useState(false);

  // Warm the browser cache for the frames the user is about to hit: the next
  // two 3-hourly steps' tiles in view, plus the +6h uv texture (the particle
  // layer itself keeps the current pair loaded).
  const idlePrefetch = useCallback((fn) => {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1500 });
    else setTimeout(fn, 300);
  }, []);

  const location = useLocation();

  const {
    spots, userSpots, buoys, storms, loading, updatedAt,
    spotsRef, userSpotsRef, buoysRef, stormsRef,
    toggleFavorite, addUserSpot, removeUserSpot,
  } = useMapBundle();

  // Deep-link: ?storm=<id> opens StormCard directly
  const stormIdParam = useMemo(() => {
    return new URLSearchParams(location.search).get('storm');
  }, [location.search]);

  useEffect(() => {
    if (!stormIdParam || stormOpenedRef.current || storms.length === 0) return;
    const target = storms.find(s => s.id === stormIdParam);
    if (target) {
      stormOpenedRef.current = true;
      setDetailStorm(target);
    }
  }, [stormIdParam, storms]);

  const [addSpotMode,  setAddSpotMode]  = useState(false);
  const [addSpotForm,  setAddSpotForm]  = useState(null);  // {lat, lng} when pin dropped
  const pendingPinRef = useRef(null);   // temporary pin marker

  // ─── Marker management ───────────────────────────────────────────
  const clearAllMarkers = useCallback(() => {
    for (const m of markersRef.current) {
      if (mapRef.current) mapRef.current.removeLayer(m);
    }
    markersRef.current = [];
  }, []);

  const addSpotMarker = useCallback((spot) => {
    const map = mapRef.current;
    if (!map) return;
    const raw   = spot.current_conditions?.overall_score;
    const score = spot.rating ?? (raw != null ? raw / 2 : null);
    const icon = L.divIcon({
      html: spotMarkerHtml(spot),
      className: '',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
    const marker = L.marker([spot.latitude, spot.longitude], { icon });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      setStormPreview(null);
      setDetailStorm(null);
      const cc = spot.current_conditions || {};
      setPreview({
        id:     spot.id   || spot.slug,
        name:   spot.name,
        slug:   spot.slug,
        region: spot.region || '',
        rating: score,
        swell:  spot.swell  ?? cc.surf_height_ft  ?? cc.wave_height_ft,
        period: spot.period ?? cc.dominant_period_sec,
        wind:   spot.wind   ?? cc.wind_speed_mph,
        water:  spot.water  ?? celsiusToF(cc.water_temp_c),
      });
    });
    marker.addTo(map);
    markersRef.current.push(marker);
  }, []);

  const addBuoyMarker = useCallback((buoy) => {
    const map = mapRef.current;
    if (!map) return;
    const icon = L.divIcon({
      html: buoyMarkerHtml(),
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker([buoy.lat, buoy.lon], { icon });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      setPreview(null);
      setStormPreview(null);
      setBuoyPreview(buoy);
    });
    marker.addTo(map);
    markersRef.current.push(marker);
  }, []);

  const addClusterMarker = useCallback((clusterSpots, avgRating) => {
    const map = mapRef.current;
    if (!map) return;
    const lat = clusterSpots.reduce((s, sp) => s + sp.latitude,  0) / clusterSpots.length;
    const lon = clusterSpots.reduce((s, sp) => s + sp.longitude, 0) / clusterSpots.length;
    const icon = L.divIcon({
      html: clusterMarkerHtml(clusterSpots.length, avgRating),
      className: '',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const marker = L.marker([lat, lon], { icon });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      map.flyTo([lat, lon], Math.min(map.getZoom() + 2.5, 7));
    });
    marker.addTo(map);
    markersRef.current.push(marker);
  }, []);

  const addStormMarker = useCallback((storm, curH = 0) => {
    const map = mapRef.current;
    if (!map) return;

    const track = Array.isArray(storm.forecast_track) ? storm.forecast_track : [];

    // Interpolate position at curH if track data is available
    let displayLat = storm.lat;
    let displayLon = storm.lon;
    if (track.length > 0 && curH > 0) {
      // Find surrounding waypoints
      const sorted = [...track].filter(w => w.hours_ahead != null).sort((a, b) => a.hours_ahead - b.hours_ahead);
      if (sorted.length > 0) {
        if (curH <= sorted[0].hours_ahead) {
          // Before first waypoint — interpolate from current pos to first wp
          const frac = curH / sorted[0].hours_ahead;
          displayLat = storm.lat + (sorted[0].lat - storm.lat) * frac;
          displayLon = storm.lon + (sorted[0].lon - storm.lon) * frac;
        } else if (curH >= sorted[sorted.length - 1].hours_ahead) {
          displayLat = sorted[sorted.length - 1].lat;
          displayLon = sorted[sorted.length - 1].lon;
        } else {
          for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i];
            const b = sorted[i + 1];
            if (curH >= a.hours_ahead && curH <= b.hours_ahead) {
              const frac = (curH - a.hours_ahead) / (b.hours_ahead - a.hours_ahead);
              displayLat = a.lat + (b.lat - a.lat) * frac;
              displayLon = a.lon + (b.lon - a.lon) * frac;
              break;
            }
          }
        }
      }
    }

    const opacity = curH === 0 ? 1 : Math.max(0.4, 1 - curH / 240);
    const icon = L.divIcon({
      html: stormMarkerHtml(storm, opacity),
      className: '',
      iconSize: [120, 120],
      iconAnchor: [60, 60],
    });
    // Outer container is non-interactive (rings cover too much area).
    // Click is wired directly to the .core dot via L.DomEvent after addTo.
    const marker = L.marker([displayLat, displayLon], { icon, interactive: false });
    marker.addTo(map);
    const core = marker.getElement()?.querySelector('.core');
    if (core) {
      L.DomEvent.on(core, 'click', (e) => {
        L.DomEvent.stopPropagation(e);
        setPreview(null);
        setStormPreview(storm);
      });
    }
    markersRef.current.push(marker);

    // Draw forecast track polyline + ghost waypoints
    if (track.length > 0) {
      const sorted = [...track].filter(w => w.hours_ahead != null && w.lat != null && w.lon != null)
        .sort((a, b) => a.hours_ahead - b.hours_ahead);
      if (sorted.length > 0) {
        // Full track path: current pos → all waypoints
        const trackLatLngs = [[storm.lat, storm.lon], ...sorted.map(w => [w.lat, w.lon])];
        const trackLine = L.polyline(trackLatLngs, {
          color: '#e5743d',
          weight: 1.5,
          opacity: 0.45,
          dashArray: '4 6',
          interactive: false,
        });
        trackLine.addTo(map);
        markersRef.current.push(trackLine);

        // Ghost markers at future waypoints (those ahead of curH)
        for (const wp of sorted) {
          if (wp.hours_ahead <= curH) continue;
          const ghostOpacity = Math.max(0.15, 0.5 - wp.hours_ahead / 300);
          const ghostIcon = L.divIcon({
            html: `<div style="width:8px;height:8px;border-radius:50%;background:#e5743d;opacity:${ghostOpacity};border:1px solid rgba(229,116,61,0.6)"></div>`,
            className: '',
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          });
          const ghost = L.marker([wp.lat, wp.lon], { icon: ghostIcon, interactive: false });
          ghost.addTo(map);
          markersRef.current.push(ghost);
        }
      }
    }
  }, []);

  const addUserSpotMarker = useCallback((spot) => {
    const map = mapRef.current;
    if (!map) return;
    const icon = L.divIcon({
      html: userSpotMarkerHtml(spot.name),
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    const marker = L.marker([spot.latitude, spot.longitude], { icon });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      setStormPreview(null);
      setPreview({
        id:     spot.slug,
        name:   spot.name,
        slug:   spot.slug,
        region: 'My Spot',
        rating: null,
        is_user_spot: true,
      });
    });
    marker.addTo(map);
    markersRef.current.push(marker);
  }, []);

  // ─── Render pass ─────────────────────────────────────────────────
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const s      = stateRef.current;
    const bounds = map.getBounds();
    const zoom   = map.getZoom();

    const renderKey = [
      bounds.toBBoxString(), zoom,
      s.region, s.showSpots, s.showBuoys, s.showStorms, s.stormStrength, s.favsOnly, s.query,
      spotsRef.current.length, buoysRef.current.length, stormsRef.current.length,
      userSpotsRef.current.length, curHRef.current,
    ].join('_');
    if (renderKey === lastRenderKeyRef.current) return;
    lastRenderKeyRef.current = renderKey;

    clearAllMarkers();

    if (s.showBuoys && zoom >= 2) {
      for (const b of buoysRef.current) {
        if (b.lat != null && b.lon != null && bounds.contains([b.lat, b.lon])) {
          addBuoyMarker(b);
        }
      }
    }

    if (s.showStorms) {
      for (const storm of stormsRef.current) {
        if (!stormPassesStrength(storm, s.stormStrength)) continue;
        addStormMarker(storm, curHRef.current);
      }
    }

    if (s.showSpots) {
      let visible = spotsRef.current.filter(sp =>
        sp.latitude != null && sp.longitude != null &&
        bounds.contains([sp.latitude, sp.longitude])
      );
      if (s.favsOnly) visible = visible.filter(sp => sp.fav);
      if (s.query) {
        const q = s.query.toLowerCase();
        visible = visible.filter(sp =>
          sp.name.toLowerCase().includes(q) ||
          (sp.region || '').toLowerCase().includes(q)
        );
      }
      if (s.region !== 'all') {
        const r = REGIONS.find(r => r.id === s.region);
        if (r?.bbox) visible = visible.filter(sp => inBbox(sp, r.bbox));
      }

      if (zoom < 5) {
        const cells = buildClusters(visible, map);
        for (const cellSpots of cells.values()) {
          if (cellSpots.length === 1) {
            addSpotMarker(cellSpots[0]);
          } else {
            const scores = cellSpots
              .map(sp => sp.current_conditions?.overall_score)
              .filter(Boolean);
            const avg = scores.length
              ? scores.reduce((a, b) => a + b, 0) / scores.length
              : null;
            addClusterMarker(cellSpots, avg);
          }
        }
      } else {
        visible.forEach(addSpotMarker);
      }

      setInViewCount(visible.length);
    } else {
      setInViewCount(0);
    }

    // Always render user spots (not subject to favsOnly / region filter)
    for (const us of userSpotsRef.current) {
      if (us.latitude != null && us.longitude != null) {
        addUserSpotMarker(us);
      }
    }
  }, [
    clearAllMarkers, addSpotMarker, addBuoyMarker, addClusterMarker, addStormMarker,
    addUserSpotMarker, stateRef, spotsRef, userSpotsRef, buoysRef, stormsRef,
  ]);

  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(renderMarkers, 80);
  }, [renderMarkers]);

  // ─── Map init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [25, -50],
      zoom: 2,
      zoomControl: false,
      attributionControl: true,
    });

    const isDaylight = document.documentElement.dataset.theme === 'daylight';
    baseTileRef.current = L.tileLayer(isDaylight ? CARTO_LIGHT : CARTO_DARK, {
      attribution: CARTO_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    labelTileRef.current = L.tileLayer(isDaylight ? CARTO_LIGHT_LABELS : CARTO_LABELS, {
      attribution: '',
      subdomains: 'abcd',
      maxZoom: 19,
      opacity: 0.6,
    }).addTo(map);

    map.on('moveend', scheduleRender);
    map.on('zoomend', scheduleRender);
    map.on('click', () => {
      setPreview(null);
      setBuoyPreview(null);
      setStormPreview(null);
    });
    mapRef.current = map;

    // Force Leaflet to re-measure its container after React paints the layout
    const sizeTimer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(sizeTimer);
      map.off('moveend', scheduleRender);
      map.off('zoomend', scheduleRender);
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [scheduleRender]);

  // Swap CARTO tile layers when theme changes (dark ↔ daylight)
  useEffect(() => {
    const html = document.documentElement;
    const swap = () => {
      const map = mapRef.current;
      if (!map || !baseTileRef.current || !labelTileRef.current) return;
      const isDaylight = html.dataset.theme === 'daylight';
      baseTileRef.current.setUrl(isDaylight ? CARTO_LIGHT : CARTO_DARK);
      labelTileRef.current.setUrl(isDaylight ? CARTO_LIGHT_LABELS : CARTO_LABELS);
    };
    const observer = new MutationObserver(swap);
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Re-render when data or filter state changes
  useEffect(() => { scheduleRender(); }, [spots, userSpots, buoys, storms, state, scheduleRender]);

  // Keep curHRef in sync; force marker re-render (storm dimming) on timeline change
  useEffect(() => {
    curHRef.current = curH;
    lastRenderKeyRef.current = ''; // invalidate so next scheduleRender fires
    scheduleRender();
  }, [curH, scheduleRender]);

  // ─── Wind overlay lifecycle (toggle in NavDrawer) ────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!state.showWind) {
      if (windCtlRef.current) { windCtlRef.current.remove(); windCtlRef.current = null; }
      if (windParticlesRef.current) { windParticlesRef.current.destroy(); windParticlesRef.current = null; }
      setOverlayLoading(false);
      return;
    }

    let alive = true;
    if (!windManifest) {
      fetchWindManifest('gfs')
        .then((m) => { if (alive) setWindManifest(m); })
        .catch((e) => console.warn('🌬️ wind manifest failed:', e));
      return () => { alive = false; };
    }

    // Keep CARTO layers ordered around the wind tiles: base < wind < labels
    if (baseTileRef.current) baseTileRef.current.setZIndex(200);
    if (labelTileRef.current) labelTileRef.current.setZIndex(400);

    if (!windCtlRef.current) {
      windCtlRef.current = new WindTileController(map, {
        opacity: 0.85,
        maxNativeZoom: Math.min(windManifest.max_zoom ?? 7, 7),
        zIndex: 210,
        onLoading: () => setOverlayLoading(true),
        onLoad: () => setOverlayLoading(false),
      });
    }
    if (!windParticlesRef.current) {
      windParticlesRef.current = new WindParticlesGL(map, {
        numParticles: Number(localStorage.getItem('particleCount')) || 10000,
      });
    }
    // Idempotent for an unchanged run; on a new run it drops cached GL
    // textures so particles advect against the fresh frames.
    windParticlesRef.current.setRun('gfs', windManifest.run);

    // The tile backend keeps only the newest runs on disk, so a map left
    // open must follow new GFS runs or its tile URLs eventually 404.
    const refresh = setInterval(() => {
      fetchWindManifest('gfs')
        .then((m) => { if (alive && m.run !== windManifest.run) setWindManifest(m); })
        .catch(() => {});   // transient failure: keep serving the current run
    }, 15 * 60 * 1000);

    return () => { alive = false; clearInterval(refresh); };
  }, [state.showWind, windManifest]);

  // ─── Wave overlay lifecycle (Waves / Swell toggles in LeftRail) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!waveActive) {
      if (waveCtlRef.current) { waveCtlRef.current.remove(); waveCtlRef.current = null; }
      if (waveParticlesRef.current) { waveParticlesRef.current.destroy(); waveParticlesRef.current = null; }
      setOverlayLoading(false);
      return;
    }

    let alive = true;
    if (!waveManifest) {
      fetchWaveManifest()
        .then((m) => { if (alive) setWaveManifest(m); })
        .catch((e) => console.warn('🌊 wave manifest failed:', e));
      return () => { alive = false; };
    }

    if (baseTileRef.current) baseTileRef.current.setZIndex(200);
    if (labelTileRef.current) labelTileRef.current.setZIndex(400);

    if (!waveCtlRef.current) {
      waveCtlRef.current = new WindTileController(map, {
        opacity: 0.85,
        maxNativeZoom: Math.min(waveManifest.max_zoom ?? 7, 7),
        zIndex: 210,
        urlBuilder: waveTileUrl,
        onLoading: () => setOverlayLoading(true),
        onLoad: () => setOverlayLoading(false),
      });
    }
    // Particles advect against the selected variable's direction field, so a
    // waves ↔ swell switch needs a fresh instance pointed at the other uv set.
    if (waveParticlesRef.current && waveParticlesVarRef.current !== waveVar) {
      waveParticlesRef.current.destroy();
      waveParticlesRef.current = null;
    }
    if (!waveParticlesRef.current) {
      waveParticlesRef.current = new WindParticlesGL(map, {
        numParticles: Number(localStorage.getItem('particleCount')) || 10000,
        uvUrl: waveUVUrl(waveVar),
        colorRamp: WAVE_PERIOD_RAMP,
      });
      waveParticlesVarRef.current = waveVar;
    }
    waveParticlesRef.current.setRun('gfswave', waveManifest.run);

    const refresh = setInterval(() => {
      fetchWaveManifest()
        .then((m) => { if (alive && m.run !== waveManifest.run) setWaveManifest(m); })
        .catch(() => {});
    }, 15 * 60 * 1000);

    return () => { alive = false; clearInterval(refresh); };
  }, [waveActive, waveVar, waveManifest, WAVE_PERIOD_RAMP]);

  // Wave frame follows the shared timeline (same 3-hourly crossfade as wind)
  useEffect(() => {
    if (!waveActive || !waveManifest || !waveCtlRef.current) return;
    const maxHour = waveManifest.hours[waveManifest.hours.length - 1];
    const h0 = Math.min(maxHour, Math.floor(curH / 3) * 3);
    const h1 = Math.min(maxHour, h0 + 3);
    const mix = h1 > h0 ? (curH - h0) / 3 : 0;

    waveCtlRef.current.setFrame({ run: waveManifest.run, hour: h0, variable: waveVar });
    if (waveParticlesRef.current && !waveParticlesRef.current.unsupported) {
      waveParticlesRef.current.setTime(h0, h1, mix);
    }

    idlePrefetch(() => {
      const map = mapRef.current;
      if (!map || !waveCtlRef.current) return;
      const zoomOpts = {
        maxNativeZoom: Math.min(waveManifest.max_zoom ?? 7, 7),
        urlBuilder: waveTileUrl,
      };
      for (const ahead of [3, 6]) {
        const h = Math.min(maxHour, h0 + ahead);
        if (h > h0) prefetchFrame(map, { run: waveManifest.run, hour: h, variable: waveVar }, zoomOpts);
      }
      const hUv = Math.min(maxHour, h0 + 6);
      if (hUv > h1) new Image().src = waveUVUrl(waveVar)({ run: waveManifest.run, hour: hUv });
    });
  }, [waveActive, waveManifest, curH, waveVar, idlePrefetch]);

  // Coastline stroke above the overlay tiles — keeps land/ocean separation
  // crisp under the ramp colors (same Natural Earth outline map-lab used).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!state.showWind && !waveActive) {
      if (coastRef.current) { coastRef.current.remove(); coastRef.current = null; }
      return;
    }
    if (coastRef.current) return;
    let alive = true;
    fetch('/geojson/ne_50m_land.geojson')
      .then((r) => r.json())
      .then((geo) => {
        if (!alive || !mapRef.current || coastRef.current) return;
        coastRef.current = L.geoJSON(geo, {
          interactive: false,
          style: { color: 'rgba(10, 18, 24, 0.55)', weight: 1, fill: false },
        }).addTo(mapRef.current);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [state.showWind, waveActive]);

  // Tear down wind layers on unmount (the toggle effect above only handles
  // showWind flipping off, not leaving the page with wind still on)
  useEffect(() => () => {
    if (windCtlRef.current) { windCtlRef.current.remove(); windCtlRef.current = null; }
    if (windParticlesRef.current) { windParticlesRef.current.destroy(); windParticlesRef.current = null; }
    if (waveCtlRef.current) { waveCtlRef.current.remove(); waveCtlRef.current = null; }
    if (waveParticlesRef.current) { waveParticlesRef.current.destroy(); waveParticlesRef.current = null; }
    if (coastRef.current) { coastRef.current.remove(); coastRef.current = null; }
  }, []);

  // Wind frame follows the shared timeline. curH is hourly (0-168); tiles are
  // 3-hourly, so particles crossfade across the gap for smooth playback.
  useEffect(() => {
    if (!state.showWind || !windManifest || !windCtlRef.current) return;
    const maxHour = windManifest.hours[windManifest.hours.length - 1];
    const h0 = Math.min(maxHour, Math.floor(curH / 3) * 3);
    const h1 = Math.min(maxHour, h0 + 3);
    const mix = h1 > h0 ? (curH - h0) / 3 : 0;

    windCtlRef.current.setFrame({ model: 'gfs', run: windManifest.run, hour: h0, variable: windVar });
    if (windParticlesRef.current && !windParticlesRef.current.unsupported) {
      windParticlesRef.current.setTime(h0, h1, mix);
    }

    idlePrefetch(() => {
      const map = mapRef.current;
      if (!map || !windCtlRef.current) return;
      const zoomOpts = { maxNativeZoom: Math.min(windManifest.max_zoom ?? 7, 7) };
      for (const ahead of [3, 6]) {
        const h = Math.min(maxHour, h0 + ahead);
        if (h > h0) prefetchFrame(map, { model: 'gfs', run: windManifest.run, hour: h, variable: windVar }, zoomOpts);
      }
      const hUv = Math.min(maxHour, h0 + 6);
      if (hUv > h1) new Image().src = windUVUrl({ model: 'gfs', run: windManifest.run, hour: hUv });
    });
  }, [state.showWind, windManifest, curH, windVar, idlePrefetch]);

  // Geolocation: auto-select nearest region on first load
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        const match = REGIONS.find(r => {
          if (!r.bbox) return false;
          const [[s, w], [n, e]] = r.bbox;
          return lat >= s && lat <= n && lng >= w && lng <= e;
        });
        if (match) {
          setRegion(match.id);
          if (mapRef.current) {
            const [[s, w], [n, e]] = match.bbox;
            mapRef.current.fitBounds([[s, w], [n, e]], { padding: [40, 40], animate: true });
          }
        } else if (mapRef.current) {
          mapRef.current.flyTo([lat, lng], 6, { duration: 1.2 });
        }
      },
      () => {},
      { timeout: 8000, maximumAge: 300000 }
    );
  }, []); // run once on mount

  // Search: fly to first match (Spot > Buoy) when query changes
  useEffect(() => {
    const q = (state.query || '').toLowerCase().trim();
    if (!q) { queryFlyRef.current = ''; return; }
    if (q === queryFlyRef.current || !mapRef.current) return;
    queryFlyRef.current = q;
    const spot = spotsRef.current.find(sp =>
      sp.name.toLowerCase().includes(q) || (sp.region || '').toLowerCase().includes(q)
    );
    if (spot?.latitude != null && spot?.longitude != null) {
      mapRef.current.flyTo([spot.latitude, spot.longitude], 8, { duration: 0.9 });
      return;
    }
    const buoy = buoysRef.current.find(b =>
      (b.name || '').toLowerCase().includes(q) || b.id?.toLowerCase().includes(q)
    );
    if (buoy?.lat != null && buoy?.lon != null) {
      mapRef.current.flyTo([buoy.lat, buoy.lon], 7, { duration: 0.9 });
    }
  }, [state.query, spotsRef, buoysRef]);

  // Add-spot mode: map click drops a pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!addSpotMode) return;

    map.getContainer().style.cursor = 'crosshair';

    const onClick = (e) => {
      const { lat, lng } = e.latlng;
      if (pendingPinRef.current) map.removeLayer(pendingPinRef.current);
      const pin = L.marker([lat, lng], {
        icon: L.divIcon({
          html: '<div class="mv-add-spot-pin"></div>',
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(map);
      pendingPinRef.current = pin;
      setAddSpotForm({ lat, lng });
    };

    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
      map.getContainer().style.cursor = '';
      if (pendingPinRef.current) {
        map.removeLayer(pendingPinRef.current);
        pendingPinRef.current = null;
      }
    };
  }, [addSpotMode]);

  // Esc closes open cards
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setPreview(null);
        setBuoyPreview(null);
        setStormPreview(null);
        setDetailStorm(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ─── Region handler (needs map access) ───────────────────────────
  const handleRegion = (id) => {
    const r = REGIONS.find(r => r.id === id);
    setRegion(id);
    if (r?.bbox && mapRef.current) {
      const [[s, w], [n, e]] = r.bbox;
      mapRef.current.fitBounds([[s, w], [n, e]], { padding: [40, 40] });
    }
  };

  const handleSaveUserSpot = async ({ name, breakType }) => {
    const { lat, lng } = addSpotForm;
    try {
      const { getAuthHeaders } = await import('../supabaseClient');
      const headers = await getAuthHeaders();
      const res = await fetch('/api/user/spots', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, latitude: lat, longitude: lng, break_type: breakType || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { spot } = await res.json();
      addUserSpot(spot);
    } catch (err) {
      console.warn('addUserSpot failed:', err);
    } finally {
      setAddSpotMode(false);
      setAddSpotForm(null);
    }
  };

  return (
    <div className="mv-root">
      <div id="mv-map" ref={mapContainerRef} className="mv-map" />
      <div id="dim-layer" />
      {addSpotMode && (
        <div className="mv-add-spot-hint">
          {addSpotForm ? 'Spot pinned — fill in details below' : 'Click the map to drop a pin'}
          <button onClick={() => { setAddSpotMode(false); setAddSpotForm(null); }}>Cancel</button>
        </div>
      )}
      {addSpotForm && (
        <AddSpotForm
          lat={addSpotForm.lat}
          lng={addSpotForm.lng}
          onSave={handleSaveUserSpot}
          onCancel={() => { setAddSpotMode(false); setAddSpotForm(null); }}
        />
      )}
      {state.showWind && (
        <div className="mv-wind-legend">
          <div className="mv-wind-var-toggle" role="group" aria-label="Wind layer variable">
            <button
              className={windVar === 'speed' ? 'on' : ''}
              onClick={() => pickWindVar('speed')}
            >Wind</button>
            <button
              className={windVar === 'gust' ? 'on' : ''}
              onClick={() => pickWindVar('gust')}
            >Gusts</button>
          </div>
          <WindLegend variable={windVar} />
          {overlayLoading && <div className="mv-overlay-loading"><LogoPulse size={12} compact /> loading forecast…</div>}
        </div>
      )}
      {waveActive && (
        <div className="mv-wind-legend">
          <WaveLegend variable={waveVar} />
          {overlayLoading && <div className="mv-overlay-loading"><LogoPulse size={12} compact /> loading forecast…</div>}
        </div>
      )}
      <Chrome
        mapRef={mapRef}
        state={state}
        onRegion={handleRegion}
        onToggle={toggleState}
        onStormStrength={setStormStrength}
        spots={spots}
        buoys={buoys}
        storms={storms}
        loading={loading}
        inViewCount={inViewCount}
        updatedAt={updatedAt}
        preview={preview}
        isFav={preview ? spots.find(s => s.slug === preview.slug)?.fav ?? false : false}
        onToggleFav={toggleFavorite}
        onPreviewClose={() => setPreview(null)}
        buoyPreview={buoyPreview}
        onBuoyPreviewClose={() => setBuoyPreview(null)}
        stormPreview={stormPreview}
        onStormPreviewClose={() => setStormPreview(null)}
        onStormOpenDetail={() => {
          setDetailStorm(stormPreview);
          setStormPreview(null);
        }}
        addSpotMode={addSpotMode}
        onAddSpotToggle={() => { setAddSpotMode(m => !m); setAddSpotForm(null); }}
        curH={curH}
        onCurHChange={setCurH}
      />
      {detailStorm && (
        <StormCard
          storm={detailStorm}
          mapRef={mapRef}
          onClose={() => setDetailStorm(null)}
        />
      )}
    </div>
  );
}
