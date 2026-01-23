import React from 'react';

const KTS_TO_MPH = 1.15078;

// MUST match WindCanvasLayer getWindSpeedColor() stops (kts thresholds)
const STOPS = [
  { kts: 0,  rgba: 'rgba(173,216,230,1)' },
  { kts: 5,  rgba: 'rgba(135,206,250,1)' },
  { kts: 10, rgba: 'rgba(100,200,200,1)' },
  { kts: 15, rgba: 'rgba(144,238,144,1)' },
  { kts: 20, rgba: 'rgba(255,255,100,1)' },
  { kts: 25, rgba: 'rgba(255,200,50,1)' },
  { kts: 30, rgba: 'rgba(255,140,30,1)' },
  { kts: 35, rgba: 'rgba(255,80,30,1)' },
  { kts: 40, rgba: 'rgba(220,40,60,1)' },
  { kts: 50, rgba: 'rgba(180,20,80,1)' },
];

export default function WindSpeedLegend({ units = 'mph' }) {
  const labels = STOPS.map(s => ({
    ...s,
    mph: Math.round(s.kts * KTS_TO_MPH),
  }));

  const gradient = `linear-gradient(to right, ${labels.map(l => l.rgba).join(', ')})`;

  return (
    <div style={{ width: 260, userSelect: 'none' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#333', marginBottom: 6 }}>
        Wind speed ({units.toUpperCase()})
      </div>

      <div style={{
        height: 12,
        borderRadius: 6,
        background: gradient,
        border: '1px solid rgba(0,0,0,0.25)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)'
      }} />

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        color: '#333',
        marginTop: 6
      }}>
        {labels.map((l, i) => (
          <span key={i} style={{ whiteSpace: 'nowrap' }}>{l.mph}</span>
        ))}
      </div>
    </div>
  );
}




