import React, { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CARTO_DARK, CARTO_LABELS, CARTO_ATTR, REGIONS } from '../components/map/constants';
import { buildClusters }                                  from '../components/map/clusterGrid';
import { spotMarkerHtml, buoyMarkerHtml, clusterMarkerHtml, userSpotMarkerHtml } from '../components/map/markers';
import { stormMarkerHtml }                                from '../components/map/StormMarker';
import { useMapBundle }                                   from '../components/map/useMapBundle';
import Chrome                                             from '../components/map/Chrome';
import { StormCard }                                      from '../components/map/StormCard';
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

export default function Map({ state, stateRef, toggleState, setRegion, setQuery }) {
  const mapContainerRef  = useRef(null);
  const mapRef           = useRef(null);
  const markersRef       = useRef([]);
  const renderTimerRef   = useRef(null);
  const lastRenderKeyRef = useRef('');

  const [preview,       setPreview]       = useState(null);
  const [inViewCount,   setInViewCount]   = useState(0);
  const [stormPreview,  setStormPreview]  = useState(null);
  const [detailStorm,   setDetailStorm]   = useState(null);

  const {
    spots, userSpots, buoys, storms, loading, updatedAt,
    spotsRef, userSpotsRef, buoysRef, stormsRef,
    toggleFavorite, addUserSpot, removeUserSpot,
  } = useMapBundle();

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
    marker.on('click', () => {
      setStormPreview(null);
      setDetailSpot(null);
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
    const htFt   = buoy.wave_height_ft != null
      ? buoy.wave_height_ft.toFixed(1)
      : buoy.wave_height_m != null
        ? (buoy.wave_height_m * 3.28).toFixed(1)
        : '—';
    const period = buoy.dominant_period_sec != null ? `${buoy.dominant_period_sec}s` : '—';
    marker.bindPopup(
      `<div class="mv-buoy-popup"><strong>${buoy.name || buoy.station}</strong><br/>${htFt} ft @ ${period}</div>`,
      { className: 'mv-popup' }
    );
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
    marker.on('click', () => {
      map.flyTo([lat, lon], Math.min(map.getZoom() + 2.5, 7));
    });
    marker.addTo(map);
    markersRef.current.push(marker);
  }, []);

  const addStormMarker = useCallback((storm) => {
    const map = mapRef.current;
    if (!map) return;
    const icon = L.divIcon({
      html: stormMarkerHtml(storm),
      className: '',
      iconSize: [120, 120],
      iconAnchor: [60, 60],
    });
    const marker = L.marker([storm.lat, storm.lon], { icon, interactive: true });
    marker.on('click', () => {
      setPreview(null);
      setStormPreview(storm);
    });
    marker.addTo(map);
    markersRef.current.push(marker);
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
    marker.on('click', () => {
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
      s.region, s.showSpots, s.showBuoys, s.showStorms, s.favsOnly, s.query,
      spotsRef.current.length, buoysRef.current.length, stormsRef.current.length,
      userSpotsRef.current.length,
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
        addStormMarker(storm);
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

    L.tileLayer(CARTO_DARK, {
      attribution: CARTO_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    L.tileLayer(CARTO_LABELS, {
      attribution: '',
      subdomains: 'abcd',
      maxZoom: 19,
      opacity: 0.6,
    }).addTo(map);

    map.on('moveend', scheduleRender);
    map.on('zoomend', scheduleRender);
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

  // Re-render when data or filter state changes
  useEffect(() => { scheduleRender(); }, [spots, userSpots, buoys, storms, state, scheduleRender]);

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
      <Chrome
        mapRef={mapRef}
        state={state}
        onRegion={handleRegion}
        onToggle={toggleState}
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
        stormPreview={stormPreview}
        onStormPreviewClose={() => setStormPreview(null)}
        onStormOpenDetail={() => {
          setDetailStorm(stormPreview);
          setStormPreview(null);
        }}
        addSpotMode={addSpotMode}
        onAddSpotToggle={() => { setAddSpotMode(m => !m); setAddSpotForm(null); }}
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
