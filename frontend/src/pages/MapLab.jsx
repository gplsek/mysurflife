/**
 * MapLab.jsx — /map-lab dev harness for the wind tile pipeline (Phase B,
 * notes/WIND_TILES_EXECUTION_PLAN.md).
 *
 * Thin, throwaway chrome around portable components (components/overlays/*).
 * The components migrate to pages/Map.jsx in Phase D; this page does not.
 * Compare side-by-side against /old-map's canvas rendering.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CARTO_DARK, CARTO_LABELS, CARTO_ATTR } from '../components/map/constants';
import {
  WindTileController,
  fetchWindManifest,
  prefetchFrame,
} from '../components/overlays/WindTileLayer';
import OverlayTimeline from '../components/overlays/OverlayTimeline';
import WindLegend from '../components/overlays/WindLegend';
import LogoPulse from '../design/LogoPulse';
import '../styles/map-lab.css';

const PLAY_INTERVAL_MS = 700;
const PREFETCH_IDLE_MS = 400;
const MODEL = 'gfs';

export default function MapLab() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const windRef = useRef(null);
  const prefetchTimerRef = useRef(null);

  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [hourIdx, setHourIdx] = useState(0);
  const [variable, setVariable] = useState('speed');
  const [opacity, setOpacity] = useState(0.8);
  const [playing, setPlaying] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);

  // Map init
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [35, -150],
      zoom: 3,
      minZoom: 2,
      maxZoom: 11,
      zoomControl: true,
      worldCopyJump: true,
      attributionControl: true,
    });
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, zIndex: 200 }).addTo(map);
    L.tileLayer(CARTO_LABELS, { zIndex: 400 }).addTo(map);
    mapRef.current = map;

    return () => {
      if (windRef.current) windRef.current.remove();
      map.remove();
      mapRef.current = null;
      windRef.current = null;
    };
  }, []);

  // Manifest load
  useEffect(() => {
    let alive = true;
    fetchWindManifest(MODEL)
      .then((m) => { if (alive) setManifest(m); })
      .catch((e) => { if (alive) setError(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  // Frame changes → tile layer + idle prefetch of neighbors
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !manifest) return;

    if (!windRef.current) {
      windRef.current = new WindTileController(map, {
        opacity,
        maxNativeZoom: Math.min(manifest.max_zoom ?? 7, 7),
        zIndex: 210,
        onLoading: () => setTilesLoading(true),
        onLoad: () => setTilesLoading(false),
      });
    }

    const hour = manifest.hours[hourIdx] ?? 0;
    windRef.current.setFrame({ model: MODEL, run: manifest.run, hour, variable });

    clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      [1, -1, 2].forEach((delta) => {
        const h = manifest.hours[hourIdx + delta];
        if (h != null) prefetchFrame(map, { model: MODEL, run: manifest.run, hour: h, variable });
      });
    }, PREFETCH_IDLE_MS);

    return () => clearTimeout(prefetchTimerRef.current);
  }, [manifest, hourIdx, variable, opacity]);

  // Opacity
  useEffect(() => {
    if (windRef.current) windRef.current.setOpacity(opacity);
  }, [opacity]);

  // Play loop
  useEffect(() => {
    if (!playing || !manifest) return;
    const id = setInterval(() => {
      setHourIdx((i) => (i + 1) % manifest.hours.length);
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, manifest]);

  // Keyboard scrubbing
  const onKeyDown = useCallback((e) => {
    if (!manifest) return;
    if (e.key === 'ArrowRight') setHourIdx((i) => Math.min(i + 1, manifest.hours.length - 1));
    if (e.key === 'ArrowLeft') setHourIdx((i) => Math.max(i - 1, 0));
    if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
  }, [manifest]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  return (
    <div className="map-lab">
      <div ref={containerRef} className="map-lab-map" />

      <div className="map-lab-chrome map-lab-header">
        <span className="map-lab-title">Wind Lab</span>
        <span className="map-lab-sub">
          {manifest
            ? `GFS ${manifest.run_iso.replace(':00:00Z', 'Z')}`
            : error
              ? `manifest error: ${error}`
              : 'loading run…'}
        </span>
        {tilesLoading && <LogoPulse size={24} />}
      </div>

      <div className="map-lab-chrome map-lab-controls">
        <div className="map-lab-var-toggle" role="group" aria-label="Variable">
          <button
            type="button"
            className={variable === 'speed' ? 'active' : ''}
            onClick={() => setVariable('speed')}
          >
            Wind
          </button>
          <button
            type="button"
            className={variable === 'gust' ? 'active' : ''}
            onClick={() => setVariable('gust')}
          >
            Gusts
          </button>
        </div>
        <label className="map-lab-opacity">
          Opacity
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="map-lab-chrome map-lab-legend">
        <WindLegend variable={variable} />
      </div>

      <div className="map-lab-chrome map-lab-timeline">
        <OverlayTimeline
          hours={manifest?.hours ?? []}
          index={hourIdx}
          onIndexChange={setHourIdx}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          runIso={manifest?.run_iso}
          disabled={!manifest}
        />
      </div>
    </div>
  );
}
