/**
 * OverlayTimeline.jsx — forecast-hour scrubber for tile overlays.
 *
 * Portable: props-only, no data fetching. Hours come from the tile run
 * manifest (/api/tiles/wind/{model}/runs).
 */
import React, { useMemo } from 'react';

function formatValidTime(runIso, hour) {
  if (!runIso) return '';
  const t = new Date(new Date(runIso).getTime() + hour * 3600 * 1000);
  return t.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OverlayTimeline({
  hours = [],
  index = 0,
  onIndexChange,
  playing = false,
  onTogglePlay,
  runIso,
  disabled = false,
}) {
  const hour = hours[index] ?? 0;
  const label = useMemo(() => formatValidTime(runIso, hour), [runIso, hour]);

  if (!hours.length) return null;

  return (
    <div className="ovl-timeline">
      <button
        type="button"
        className="ovl-play"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <input
        className="ovl-slider"
        type="range"
        min={0}
        max={hours.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(e) => onIndexChange(Number(e.target.value))}
        aria-label="Forecast hour"
      />
      <div className="ovl-time">
        <span className="ovl-time-valid">{label}</span>
        <span className="ovl-time-hour">+{hour}h</span>
      </div>
    </div>
  );
}
