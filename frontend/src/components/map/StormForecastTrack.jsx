import React from 'react';

export function StormForecastTrack({ track }) {
  if (!track || track.length === 0) {
    return <div className="track-missing">Forecast track unavailable</div>;
  }

  const lats = track.map(p => p.lat);
  const lons = track.map(p => p.lon);
  const latMin = Math.min(...lats) - 1;
  const latMax = Math.max(...lats) + 1;
  const lonMin = Math.min(...lons) - 1;
  const lonMax = Math.max(...lons) + 1;

  const toX = (lon) => ((lon - lonMin) / (lonMax - lonMin)) * 100;
  const toY = (lat)  => 100 - ((lat - latMin) / (latMax - latMin)) * 100;

  const points = track
    .map(p => `${toX(p.lon).toFixed(1)},${toY(p.lat).toFixed(1)}`)
    .join(' ');

  return (
    <>
      <div className="track-viz">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <title>Forecast track polyline</title>
          <polyline
            points={points}
            fill="none"
            stroke="var(--warn-storm)"
            strokeWidth="1.4"
            strokeDasharray="3 3"
            opacity="0.65"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {track.slice(0, 3).map((p, i) => (
          <div
            key={i}
            className="wp"
            style={{
              left:    `${toX(p.lon).toFixed(1)}%`,
              top:     `${toY(p.lat).toFixed(1)}%`,
              opacity: 1 - i * 0.25,
            }}
          />
        ))}
      </div>

      <div className="track-rows" role="list">
        {track.slice(0, 3).map((p, i) => (
          <div key={i} className="track-row" role="listitem">
            <span className="when">+{p.t_plus}h</span>
            <span className="coord">
              {p.lat.toFixed(1)}°N {Math.abs(p.lon).toFixed(1)}°W
            </span>
            <span className="stat">{p.mb} mb · {p.kt} kt</span>
          </div>
        ))}
      </div>
    </>
  );
}
