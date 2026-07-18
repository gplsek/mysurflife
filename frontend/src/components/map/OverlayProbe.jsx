import React, { useEffect, useState } from 'react';
import LogoPulse from '../../design/LogoPulse';

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const toCardinal = (deg) =>
  CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// FROM-direction arrow: glyph points down at 0° (wind from N flows S),
// rotated by direction_deg directly — project direction convention.
function DirArrow({ deg }) {
  return (
    <svg width="12" height="12" viewBox="-6 -6 12 12"
         style={{ transform: `rotate(${deg}deg)`, flexShrink: 0 }}>
      <path d="M0 5.5 L-4 -3.5 L0 -1.5 L4 -3.5 Z" fill="currentColor" />
    </svg>
  );
}

function ProbeRow({ label, value, unit, extra, deg }) {
  return (
    <div className="mv-probe-row">
      <span className="mv-probe-label">{label}</span>
      <span className="mv-probe-value">
        {value != null ? value : '—'}
        {value != null && <span className="mv-probe-unit">{unit}</span>}
        {extra}
      </span>
      {deg != null && (
        <span className="mv-probe-dir">
          <DirArrow deg={deg} />
          {toCardinal(deg)}
        </span>
      )}
    </div>
  );
}

/**
 * OverlayProbe — Windy-style picker for the wind/wave tile overlays.
 * A dot anchors the clicked lat/lon, a stem rises to a pill showing the
 * sampled model values for whichever overlay layers are active. Tracks the
 * map through pan/zoom and refetches when the timeline hour changes.
 */
export function OverlayProbe({ mapRef, lat, lon, curH, showWind, windVar,
                               waveActive, waveVar, onClose }) {
  const [pos, setPos]   = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);

  // Screen position follows the geographic anchor through pan/zoom
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const p = map.latLngToContainerPoint([lat, lon]);
      setPos({ x: p.x, y: p.y });
    };
    update();
    map.on('move zoom', update);
    return () => map.off('move zoom', update);
  }, [mapRef, lat, lon]);

  // Sample the grids — debounced so timeline scrubbing coalesces
  useEffect(() => {
    const ac = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      fetch(`/api/tiles/point?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&hour=${curH}`,
            { signal: ac.signal })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { setData(d); setBusy(false); })
        .catch(() => {});
    }, 120);
    return () => { clearTimeout(t); ac.abort(); };
  }, [lat, lon, curH]);

  if (!pos) return null;

  const gust  = windVar === 'gust';
  const swell = waveVar === 'swell';
  const windVal = gust ? data?.gust_kts : data?.wind_kts;
  const waveH   = swell ? data?.swell_height_ft : data?.wave_height_ft;
  const waveP   = swell ? data?.swell_period_s  : data?.wave_period_s;
  const waveDeg = swell ? data?.swell_from_deg  : data?.wave_from_deg;
  const empty = !busy && data && windVal == null && waveH == null;

  return (
    <div className="mv-probe" style={{ left: pos.x, top: pos.y }}>
      <div className="mv-probe-dot" />
      <div className="mv-probe-stem" />
      <div className="mv-probe-pill">
        {busy && !data ? (
          <LogoPulse size={12} compact />
        ) : empty ? (
          <span className="mv-probe-empty">no data here</span>
        ) : (
          <div className="mv-probe-rows">
            {showWind && (
              <ProbeRow
                label={gust ? 'Gust' : 'Wind'}
                value={windVal != null ? Math.round(windVal) : null}
                unit="kt"
                deg={data?.wind_from_deg}
              />
            )}
            {waveActive && (
              <ProbeRow
                label={swell ? 'Swell' : 'Waves'}
                value={waveH != null ? waveH : null}
                unit="ft"
                extra={waveP != null && (
                  <span className="mv-probe-period">{Math.round(waveP)}s</span>
                )}
                deg={waveDeg}
              />
            )}
          </div>
        )}
        <button className="mv-probe-close" onClick={onClose} aria-label="Close probe">×</button>
      </div>
    </div>
  );
}
