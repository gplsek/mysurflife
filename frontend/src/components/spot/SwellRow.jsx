import React from 'react';

export default function SwellRow({ color, name, source_label, size_ft, period_s, direction_label, speed_mph, type_label, compact }) {
  return (
    <div className={`sd-swell-row${compact ? ' compact' : ''}`}>
      <div className="sd-swell-dot" style={{ background: color }} />
      <div className="sd-swell-info">
        <span className="sd-swell-name">{name}</span>
        {!compact && source_label && (
          <span className="sd-swell-source">{source_label}</span>
        )}
      </div>
      <div className="sd-swell-stats">
        {size_ft != null && (
          <>
            <span className="sd-swell-val" style={{ color }}>{size_ft.toFixed(1)}<span className="sd-swell-u">ft</span></span>
          </>
        )}
        {size_ft != null && period_s != null && (
          <span className="sd-swell-sep">·</span>
        )}
        {period_s != null && (
          <span className="sd-swell-val">{Math.round(period_s)}<span className="sd-swell-u">s</span></span>
        )}
        {speed_mph != null && (
          <span className="sd-swell-val" style={{ color }}>{Math.round(speed_mph)}<span className="sd-swell-u">mph</span></span>
        )}
        {direction_label && (
          <span className="sd-swell-dir">{direction_label}</span>
        )}
      </div>
    </div>
  );
}
