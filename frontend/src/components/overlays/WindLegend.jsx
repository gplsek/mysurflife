/**
 * WindLegend.jsx — legend for the wind tile overlay.
 *
 * Colors come exclusively from design/ramps.js (shared ramps.json) so the
 * legend can never drift from the server-baked tile colors. No hex literals.
 */
import React, { useMemo } from 'react';
import { rampStops, rampDomain } from '../../design/ramps';

const VARIABLE_RAMPS = { speed: 'wind_speed', gust: 'wind_gust' };

export default function WindLegend({ variable = 'speed' }) {
  const rampName = VARIABLE_RAMPS[variable] || 'wind_speed';

  const { gradient, marks, unit } = useMemo(() => {
    const stops = rampStops(rampName);
    const [d0, d1] = rampDomain(rampName);
    const parts = stops.map((s) => {
      const pct = (((s.value - d0) / (d1 - d0)) * 100).toFixed(1);
      const [r, g, b, a] = s.rgba;
      return `rgba(${r}, ${g}, ${b}, ${a}) ${pct}%`;
    });
    return {
      gradient: `linear-gradient(to right, ${parts.join(', ')})`,
      marks: stops.filter((s) => s.label != null),
      unit: 'kts',
    };
  }, [rampName]);

  return (
    <div className="wind-legend" role="img" aria-label={`Wind ${variable} color scale`}>
      <div className="wind-legend-title">
        {variable === 'gust' ? 'Gusts' : 'Wind'} ({unit})
      </div>
      <div className="wind-legend-bar" style={{ background: gradient }} />
      <div className="wind-legend-marks">
        {marks.map((s) => (
          <span key={s.value} className="wind-legend-mark">{s.value}</span>
        ))}
      </div>
    </div>
  );
}
