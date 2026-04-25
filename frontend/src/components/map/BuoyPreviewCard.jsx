import React from 'react';

export function BuoyPreviewCard({ buoy, onClose }) {
  if (!buoy) return null;

  const wave   = buoy.wave   != null ? buoy.wave.toFixed(1)   : '—';
  const period = buoy.period != null ? `${buoy.period}s`       : '—';
  const wind   = buoy.wind   != null ? Math.round(buoy.wind)   : null;
  const water  = buoy.water  != null ? Math.round(buoy.water)  : null;

  return (
    <div className="mv-buoy-card show">
      <div className="mv-buoy-card-head">
        <div>
          <div className="mv-buoy-card-name">{buoy.name || `Buoy ${buoy.id}`}</div>
          <div className="mv-buoy-card-id">Station {buoy.id}</div>
        </div>
        <button className="mv-prev-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="mv-buoy-card-metrics">
        <div>
          <span>Wave</span>
          <strong>{wave}</strong>
          <span>ft</span>
        </div>
        <div>
          <span>Period</span>
          <strong>{buoy.period ?? '—'}</strong>
          <span>s</span>
        </div>
        <div>
          <span>Wind</span>
          <strong>{wind ?? '—'}</strong>
          <span>{wind != null ? 'mph' : ''}</span>
        </div>
        <div>
          <span>Water</span>
          <strong>{water ?? '—'}</strong>
          <span>{water != null ? '°F' : ''}</span>
        </div>
      </div>

      <a
        href={`https://www.ndbc.noaa.gov/station_page.php?station=${buoy.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mv-prev-open"
      >
        NOAA data →
      </a>
    </div>
  );
}
