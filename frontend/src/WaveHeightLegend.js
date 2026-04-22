import React from 'react';

const M_TO_FT = 3.28084;

// MUST match WaveCanvasLayer getWaveHeightColor() stops (Windy.com palette)
// Color stops in meters: deep purple → magenta → pink → blue → cyan → yellow → orange → red
// Matches Windy.com's vibrant wave visualization (purple/magenta dominant)
const STOPS_M = [
  { m: 0,    r: 60,  g: 0,   b: 120 }, // Deep purple (calm)
  { m: 0.6,  r: 100, g: 0,   b: 180 }, // Purple
  { m: 1.2,  r: 180, g: 0,   b: 200 }, // Magenta
  { m: 1.8,  r: 220, g: 0,   b: 180 }, // Pink/magenta
  { m: 2.4,  r: 150, g: 50,  b: 255 }, // Purple-blue
  { m: 3.0,  r: 50,  g: 150, b: 255 }, // Blue
  { m: 3.7,  r: 0,   g: 200, b: 255 }, // Cyan
  { m: 4.6,  r: 255, g: 255, b: 0   }, // Yellow
  { m: 5.5,  r: 255, g: 100, b: 0   }, // Orange
  { m: 6.7,  r: 255, g: 0,   b: 0   }  // Red (extreme)
];

// Convert to feet and create rgba strings
const STOPS = STOPS_M.map(stop => ({
  meters: stop.m,
  feet: Math.round(stop.m * M_TO_FT * 10) / 10, // Round to 1 decimal
  rgba: `rgba(${stop.r},${stop.g},${stop.b},1)`
}));

export default function WaveHeightLegend({ units = 'imperial' }) {
  const gradient = `linear-gradient(to right, ${STOPS.map(s => s.rgba).join(', ')})`;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      width: '280px',
      userSelect: 'none'
    }}>
      <div style={{ fontSize: '11px', color: 'var(--fg-2)', fontWeight: 'bold' }}>
        Wave Height ({units === 'imperial' ? 'FEET' : 'METERS'})
      </div>
      <div style={{
        position: 'relative',
        height: '12px',
        borderRadius: '6px',
        background: gradient,
        border: '1px solid rgba(0,0,0,0.15)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
        overflow: 'hidden'
      }} />
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '10px',
        color: 'var(--fg-2)',
        marginTop: '2px'
      }}>
        {STOPS.map((s, idx) => (
          <span key={idx} style={{ whiteSpace: 'nowrap' }}>
            {units === 'imperial' ? `${s.feet}ft` : `${s.meters}m`}
          </span>
        ))}
      </div>
    </div>
  );
}

