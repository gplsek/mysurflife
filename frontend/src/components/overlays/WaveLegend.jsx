/**
 * WaveLegend.jsx — legend for the wave tile overlay (waves / primary swell).
 *
 * Colors come exclusively from design/ramps.js (shared ramps.json) so the
 * legend can never drift from the server-baked tile colors. No hex literals.
 */
import React, { useMemo } from 'react';
import { rampStops, rampDomain } from '../../design/ramps';

const TITLES = { height: 'Waves', swell: 'Swell' };

export default function WaveLegend({ variable = 'height' }) {
  const { gradient, marks, unit } = useMemo(() => {
    const stops = rampStops('wave_height');
    const [d0, d1] = rampDomain('wave_height');
    const parts = stops.map((s) => {
      const pct = (((s.value - d0) / (d1 - d0)) * 100).toFixed(1);
      const [r, g, b, a] = s.rgba;
      return `rgba(${r}, ${g}, ${b}, ${a}) ${pct}%`;
    });
    return {
      gradient: `linear-gradient(to right, ${parts.join(', ')})`,
      marks: stops.filter((s) => s.label != null),
      unit: 'ft',
    };
  }, []);

  return (
    <div className="wind-legend" role="img" aria-label={`${TITLES[variable]} height color scale`}>
      <div className="wind-legend-title">
        {TITLES[variable] || 'Waves'} ({unit})
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
