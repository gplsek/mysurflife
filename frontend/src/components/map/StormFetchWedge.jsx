import React from 'react';

const QUADS = {
  'N quadrant':   { from: -45,  to: 45  },
  'E quadrant':   { from: 45,   to: 135 },
  'S quadrant':   { from: 135,  to: 225 },
  'W quadrant':   { from: 225,  to: 315 },
  'NE quadrant':  { from: 0,    to: 90  },
  'SE quadrant':  { from: 90,   to: 180 },
  'SW quadrant':  { from: 180,  to: 270 },
  'NW quadrant':  { from: 270,  to: 360 },
  'N semicircle': { from: -90,  to: 90  },
  'E semicircle': { from: 0,    to: 180 },
  'S semicircle': { from: 90,   to: 270 },
  'W semicircle': { from: 180,  to: 360 },
  'ALL':          { from: 0,    to: 360 },
};

function polar(deg, r, cx = 48, cy = 48) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function StormFetchWedge({ fetch }) {
  if (!fetch) return null;

  const arc   = QUADS[fetch.quadrant] || QUADS['W semicircle'];
  const R     = 38, CX = 48, CY = 48;
  const [x1, y1] = polar(arc.from, R, CX, CY);
  const [x2, y2] = polar(arc.to,   R, CX, CY);
  const span     = Math.abs(arc.to - arc.from);
  const largeArc = span > 180 ? 1 : 0;
  const isFullCircle = span >= 360;

  const wedgePath = isFullCircle
    ? null
    : `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;

  const label = `${fetch.quadrant} · ${fetch.radius_nm} nm · ${fetch.severity || fetch.wind_kts_in_fetch + ' kt'} winds`;

  return (
    <div className="sc-fetch-wedge">
      <svg viewBox="0 0 96 96" role="img" aria-label={label}>
        <title>{label}</title>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border-2)" strokeWidth="1" />
        {isFullCircle
          ? <circle cx={CX} cy={CY} r={R} fill="var(--warn-storm)" fillOpacity="0.22" stroke="var(--warn-storm)" strokeWidth="1.2" />
          : <path d={wedgePath} fill="var(--warn-storm)" fillOpacity="0.22" stroke="var(--warn-storm)" strokeWidth="1.2" strokeLinejoin="round" />
        }
        {/* Cardinal ticks */}
        <line x1={CX}   y1={CY-R}   x2={CX}   y2={CY-R-3} stroke="var(--muted)" strokeWidth="1" />
        <line x1={CX}   y1={CY+R}   x2={CX}   y2={CY+R+3} stroke="var(--muted)" strokeWidth="1" />
        <line x1={CX-R} y1={CY}     x2={CX-R-3} y2={CY}   stroke="var(--muted)" strokeWidth="1" />
        <line x1={CX+R} y1={CY}     x2={CX+R+3} y2={CY}   stroke="var(--muted)" strokeWidth="1" />
        <text x={CX} y="10" textAnchor="middle" fontSize="8" fontFamily="Geist Mono, monospace" fill="var(--muted)" letterSpacing="1">N</text>
        <circle cx={CX} cy={CY} r="2" fill="var(--fg)" />
        <text x={CX} y={CY+R+12} textAnchor="middle" fontSize="8" fontFamily="Geist Mono, monospace" fill="var(--muted)" letterSpacing="1">{fetch.radius_nm} NM</text>
      </svg>
    </div>
  );
}
