import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { WindTileController, fetchWindManifest, fetchWaveManifest, waveTileUrl }
  from '../overlays/WindTileLayer';

const BASE_ZOOM = 15;     // satellite close-up (hero default)
const OVERLAY_ZOOM = 10;  // 0.25° model data has no structure at street zoom —
                          // pull back so the field reads as a field

/**
 * HeroOverlays — wind/wave/swell tile overlays for the SpotDetail hero map.
 *
 * Reuses the same server-baked PNG tiles and double-buffered frame controller
 * as /map. Must be rendered inside the hero's <MapContainer> (uses useMap()).
 * The spot marker (marker pane) and the compass (sibling DOM layer) both sit
 * above the tile overlays, so they stay visible whatever is toggled.
 *
 * @param {boolean} showWind  wind speed layer on/off
 * @param {'height'|'swell'|null} waveVar  wave layer variable, null = off
 * @param {number} hour  forecast hour from the page scrubber (snapped to 3h)
 */
export default function HeroOverlays({ showWind, waveVar, hour }) {
  const map = useMap();
  const windCtlRef = useRef(null);
  const waveCtlRef = useRef(null);
  const [windManifest, setWindManifest] = useState(null);
  const [waveManifest, setWaveManifest] = useState(null);

  const anyOverlay = showWind || !!waveVar;

  // Auto zoom: pull back while any overlay is on, return to the satellite
  // close-up when everything is off. Center never changes (it's the spot).
  useEffect(() => {
    if (!map) return;
    map.setZoom(anyOverlay ? OVERLAY_ZOOM : BASE_ZOOM, { animate: true });
  }, [map, anyOverlay]);

  // ── Wind layer ──
  useEffect(() => {
    if (!map) return;
    if (!showWind) {
      if (windCtlRef.current) { windCtlRef.current.remove(); windCtlRef.current = null; }
      return;
    }
    let alive = true;
    if (!windManifest) {
      fetchWindManifest('gfs')
        .then((m) => { if (alive && m) setWindManifest(m); })
        .catch(() => {});
      return () => { alive = false; };
    }
    if (!windCtlRef.current) {
      windCtlRef.current = new WindTileController(map, {
        opacity: 0.75,
        maxNativeZoom: Math.min(windManifest.max_zoom ?? 7, 7),
        zIndex: 210,
      });
    }
    const hours = windManifest.hours || [];
    const maxHour = hours.length ? hours[hours.length - 1] : 0;
    const h = Math.max(0, Math.min(hour - (hour % 3), maxHour));
    windCtlRef.current.setFrame({ model: 'gfs', run: windManifest.run, hour: h, variable: 'speed' });
    return () => { alive = false; };
  }, [map, showWind, windManifest, hour]);

  // ── Wave / swell layer ──
  useEffect(() => {
    if (!map) return;
    if (!waveVar) {
      if (waveCtlRef.current) { waveCtlRef.current.remove(); waveCtlRef.current = null; }
      return;
    }
    let alive = true;
    if (!waveManifest) {
      fetchWaveManifest()
        .then((m) => { if (alive && m) setWaveManifest(m); })
        .catch(() => {});
      return () => { alive = false; };
    }
    if (!waveCtlRef.current) {
      waveCtlRef.current = new WindTileController(map, {
        opacity: 0.75,
        maxNativeZoom: Math.min(waveManifest.max_zoom ?? 7, 7),
        zIndex: 205,
        urlBuilder: waveTileUrl,
      });
    }
    const hours = waveManifest.hours || [];
    const maxHour = hours.length ? hours[hours.length - 1] : 0;
    const h = Math.max(0, Math.min(hour - (hour % 3), maxHour));
    waveCtlRef.current.setFrame({ run: waveManifest.run, hour: h, variable: waveVar });
    return () => { alive = false; };
  }, [map, waveVar, waveManifest, hour]);

  // Unmount: drop both layers
  useEffect(() => () => {
    if (windCtlRef.current) { windCtlRef.current.remove(); windCtlRef.current = null; }
    if (waveCtlRef.current) { waveCtlRef.current.remove(); waveCtlRef.current = null; }
  }, []);

  return null;
}
