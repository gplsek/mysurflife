/**
 * MapLab.jsx — /map-lab dev harness for the wind tile pipeline (Phases B+C,
 * notes/WIND_TILES_EXECUTION_PLAN.md).
 *
 * Thin, throwaway chrome around portable components (components/overlays/*).
 * The components migrate to pages/Map.jsx in Phase D; this page does not.
 * Compare side-by-side against /old-map's canvas rendering.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CARTO_DARK, CARTO_LABELS, CARTO_LIGHT, CARTO_LIGHT_LABELS, CARTO_ATTR,
} from '../components/map/constants';
import {
  WindTileController,
  fetchWindManifest,
  prefetchFrame,
} from '../components/overlays/WindTileLayer';
import {
  WindParticlesGL,
  clampParticleCount,
} from '../components/overlays/WindParticlesLayerGL';
import OverlayTimeline from '../components/overlays/OverlayTimeline';
import WindLegend from '../components/overlays/WindLegend';
import LogoPulse from '../design/LogoPulse';
import '../styles/map-lab.css';

const PLAY_INDEX_PER_SEC = 1.4;   // timeline indices advanced per second
const PREFETCH_IDLE_MS = 400;
const MODEL = 'gfs';
const PARTICLE_CHOICES = [1000, 5000, 10000, 25000, 50000];

export default function MapLab() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const windRef = useRef(null);
  const particlesRef = useRef(null);
  const prefetchTimerRef = useRef(null);
  const playPosRef = useRef(0);

  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(null);
  const [hourIdx, setHourIdx] = useState(0);
  const [variable, setVariable] = useState('speed');
  const [opacity, setOpacity] = useState(0.92);
  const [playing, setPlaying] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [particlesOn, setParticlesOn] = useState(true);
  const [glUnsupported, setGlUnsupported] = useState(false);
  const [particleCount, setParticleCount] = useState(() =>
    clampParticleCount(Number(localStorage.getItem('particleCount')) || 10000)
  );
  const [basemap, setBasemap] = useState(() => localStorage.getItem('mapLabBasemap2') || 'dark');
  const baseLayersRef = useRef({ base: null, labels: null });
  const coastRef = useRef(null);

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
    mapRef.current = map;

    return () => {
      if (windRef.current) windRef.current.remove();
      if (particlesRef.current) particlesRef.current.destroy();
      map.remove();
      mapRef.current = null;
      windRef.current = null;
      particlesRef.current = null;
    };
  }, []);

  // Basemap (dark/light) — swap base + label tile layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    localStorage.setItem('mapLabBasemap2', basemap);
    const { base, labels } = baseLayersRef.current;
    if (base) base.remove();
    if (labels) labels.remove();
    const baseUrl = basemap === 'light' ? CARTO_LIGHT : CARTO_DARK;
    const labelUrl = basemap === 'light' ? CARTO_LIGHT_LABELS : CARTO_LABELS;
    baseLayersRef.current = {
      base: L.tileLayer(baseUrl, { attribution: CARTO_ATTR, zIndex: 200 }).addTo(map),
      labels: L.tileLayer(labelUrl, { zIndex: 400 }).addTo(map),
    };
  }, [basemap]);

  // Coastline stroke above the near-opaque wind layer — land/water separation
  // stays crisp without letting the basemap wash out the ramp colors.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || coastRef.current) return;
    fetch('/geojson/ne_50m_land.geojson')
      .then((r) => r.json())
      .then((geo) => {
        if (!mapRef.current || coastRef.current) return;
        coastRef.current = L.geoJSON(geo, {
          interactive: false,
          style: { color: 'rgba(244, 241, 234, 0.45)', weight: 1, fill: false },
        }).addTo(map);
      })
      .catch(() => {});
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

  // Particle layer lifecycle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !manifest || glUnsupported) return;

    if (particlesOn && !particlesRef.current) {
      particlesRef.current = new WindParticlesGL(map, {
        numParticles: particleCount,
        onUnsupported: () => setGlUnsupported(true),
      });
    }
    const gl = particlesRef.current;
    if (!gl || gl.unsupported) return;

    gl.setVisible(particlesOn);
    if (particlesOn) {
      gl.setRun(MODEL, manifest.run);
      const h0 = manifest.hours[hourIdx];
      const h1 = manifest.hours[hourIdx + 1] ?? h0;
      gl.setTime(h0, h1, 0);
    }
  }, [manifest, particlesOn, hourIdx, glUnsupported, particleCount]);

  // Particle count changes
  useEffect(() => {
    localStorage.setItem('particleCount', String(particleCount));
    if (particlesRef.current && !particlesRef.current.unsupported) {
      particlesRef.current.setNumParticles(particleCount);
    }
  }, [particleCount]);

  // Opacity
  useEffect(() => {
    if (windRef.current) windRef.current.setOpacity(opacity);
  }, [opacity]);

  // Slider/keyboard jumps keep the playhead ref in sync
  useEffect(() => {
    if (!playing) playPosRef.current = hourIdx;
  }, [hourIdx, playing]);

  // Continuous play: fractional playhead drives particle crossfade every
  // frame; tiles (and the slider) snap when the integer index changes.
  useEffect(() => {
    if (!playing || !manifest) return;
    let rafId;
    let last = performance.now();

    const tick = (now) => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      let pos = playPosRef.current + dt * PLAY_INDEX_PER_SEC;
      if (pos >= manifest.hours.length - 1) pos = 0;
      playPosRef.current = pos;

      const idx = Math.floor(pos);
      const mix = pos - idx;
      setHourIdx((cur) => (cur === idx ? cur : idx));

      const gl = particlesRef.current;
      if (gl && !gl.unsupported && particlesOn) {
        const h0 = manifest.hours[idx];
        const h1 = manifest.hours[idx + 1] ?? h0;
        gl.setTime(h0, h1, mix);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, manifest, particlesOn]);

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
        {glUnsupported && (
          <span className="map-lab-sub">animated flow needs WebGL — heatmap only</span>
        )}
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
          <button
            type="button"
            className={particlesOn ? 'active' : ''}
            onClick={() => setParticlesOn((p) => !p)}
            disabled={glUnsupported}
          >
            Flow
          </button>
          <button
            type="button"
            onClick={() => setBasemap((b) => (b === 'light' ? 'dark' : 'light'))}
          >
            {basemap === 'light' ? 'Dark map' : 'Light map'}
          </button>
        </div>
        <label className="map-lab-opacity">
          Particles
          <select
            value={particleCount}
            onChange={(e) => setParticleCount(Number(e.target.value))}
            disabled={!particlesOn || glUnsupported}
          >
            {PARTICLE_CHOICES.map((n) => (
              <option key={n} value={n}>{n >= 1000 ? `${n / 1000}k` : n}</option>
            ))}
          </select>
        </label>
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
          onIndexChange={(i) => { playPosRef.current = i; setHourIdx(i); }}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          runIso={manifest?.run_iso}
          disabled={!manifest}
        />
      </div>
    </div>
  );
}
