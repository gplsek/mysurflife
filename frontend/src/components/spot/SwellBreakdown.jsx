import React from 'react';
import SwellRow from './SwellRow';

export default function SwellBreakdown({ swells = [], wind = null, detectedCount, compact = false }) {
  return (
    <div className="sd-swell-breakdown">
      <div className="sd-swell-head">
        <div>
          <span className="sd-card-title">Swells in the water</span>
          <span className="sd-swell-badge">{detectedCount} detected</span>
        </div>
        {!compact && (
          <p className="sd-swell-desc">
            Compass shows live direction for each swell + wind at the selected time. Arrows rotate as you scrub.
          </p>
        )}
      </div>
      <div className="sd-swell-list">
        {swells.length === 0 && !wind ? (
          <div className="sd-swell-empty">No rideable swell at this time.</div>
        ) : (
          <>
            {swells.map((s, i) => {
              const name = (s.direction_label && s.type_label)
                ? `${s.direction_label} ${s.type_label}`
                : `Swell ${i + 1}`;
              const source_label = s.direction_deg != null
                ? `${Math.round(s.direction_deg)}°`
                : undefined;
              return (
                <SwellRow
                  key={i}
                  color={s.color || 'var(--s1)'}
                  name={name}
                  source_label={source_label}
                  size_ft={s.size_ft ?? s.height_ft}
                  period_s={s.period_s ?? s.period}
                  direction_label={s.direction_label}
                  compact={compact}
                />
              );
            })}
            {wind && (
              <SwellRow
                color="var(--wind)"
                name={`${wind.direction_label ? wind.direction_label + ' ' : ''}Wind`}
                source_label={wind.direction_deg != null ? `${Math.round(wind.direction_deg)}°` : undefined}
                speed_mph={wind.speed_mph}
                direction_label={wind.direction_label}
                compact={compact}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
