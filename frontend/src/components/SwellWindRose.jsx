import React from 'react';

/**
 * SwellWindRose — compass rose visualizing a spot's swell + wind windows.
 *
 * Swell windows = the arcs the swell arrives FROM (outer band, accent).
 * Wind windows  = offshore (good) / side / onshore (poor) arcs (inner band).
 * Bearings: 0°=N at top, 90°=E right, 180°=S, 270°=W.
 */

const TAU = Math.PI * 2;

function pol(cx, cy, r, deg) {
  const a = (deg - 90) * (Math.PI / 180); // 0° = up (North)
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

// Annulus segment path from a0→a1 (degrees, clockwise) between radii r0,r1.
function band(cx, cy, r0, r1, a0, a1) {
  let span = (a1 - a0 + 360) % 360;
  if (span === 0) span = 360;
  const large = span > 180 ? 1 : 0;
  const [ox0, oy0] = pol(cx, cy, r1, a0);
  const [ox1, oy1] = pol(cx, cy, r1, a1);
  const [ix1, iy1] = pol(cx, cy, r0, a1);
  const [ix0, iy0] = pol(cx, cy, r0, a0);
  return [
    `M ${ox0} ${oy0}`,
    `A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1}`,
    `L ${ix1} ${iy1}`,
    `A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0}`,
    'Z',
  ].join(' ');
}

const WIND_FILL = {
  offshore:        'var(--good, #2fbf71)',
  'side-offshore': 'var(--gold, #e6b450)',
  cross:           'var(--gold, #e6b450)',
  'side-onshore':  'var(--coral, #e5734d)',
  onshore:         'var(--coral, #e5734d)',
};

// Per-index hue shades within the accent color so multiple swell windows read
// as distinct rings instead of one merged blob. 6 shades cycle if there are more.
const SWELL_SHADES = [
  'oklch(0.82 0.16 195)',
  'oklch(0.72 0.16 205)',
  'oklch(0.86 0.12 175)',
  'oklch(0.66 0.14 215)',
  'oklch(0.78 0.18 185)',
  'oklch(0.60 0.12 200)',
];

export default function SwellWindRose({ swell = [], wind = [], size = 180 }) {
  const cx = size / 2, cy = size / 2;
  const rOuter = size * 0.46, rSwellIn = size * 0.34;
  const rWindOut = size * 0.30, rWindIn = size * 0.18;

  // Stroke between arcs in the page bg color creates a visible gap so adjacent
  // or overlapping windows don't merge visually. Stroke width is intentionally
  // small (≈1.2px at size=180) — enough to separate, not so much it eats arcs.
  const sepStroke = 'var(--bg-1, #0a1218)';
  const sepWidth = Math.max(0.8, size * 0.007);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
         aria-label="Swell and wind exposure rose">
      {/* base ring */}
      <circle cx={cx} cy={cy} r={rOuter} fill="none"
              stroke="var(--border, rgba(255,255,255,0.12))" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={rWindOut} fill="none"
              stroke="var(--border, rgba(255,255,255,0.08))" strokeWidth="1" />

      {/* swell windows (outer band) — shade varies per index for legibility */}
      {swell.map((w, i) => (
        <path key={`s${i}`} d={band(cx, cy, rSwellIn, rOuter, w.dir_min, w.dir_max)}
              fill={SWELL_SHADES[i % SWELL_SHADES.length]}
              stroke={sepStroke} strokeWidth={sepWidth}
              opacity={0.45 + 0.5 * Math.min(1, Math.max(0.1, w.weight ?? 1))} />
      ))}

      {/* wind windows (inner band) — category color, gap-stroked for separation */}
      {wind.map((w, i) => (
        <path key={`w${i}`} d={band(cx, cy, rWindIn, rWindOut, w.dir_min, w.dir_max)}
              fill={WIND_FILL[(w.category || '').toLowerCase()] || 'var(--muted, #8a93a0)'}
              stroke={sepStroke} strokeWidth={sepWidth}
              opacity={0.45 + 0.5 * Math.min(1, Math.max(0.1, w.weight ?? 1))} />
      ))}

      {/* compass labels */}
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([lbl, deg]) => {
        const [x, y] = pol(cx, cy, rOuter + 0.5, deg);
        return (
          <text key={lbl} x={x} y={y + 3} textAnchor="middle"
                fontSize={size * 0.07} fontFamily="var(--font-mono, monospace)"
                fill="var(--muted, #8a93a0)">{lbl}</text>
        );
      })}
      <circle cx={cx} cy={cy} r={size * 0.02} fill="var(--fg-2, #c8cdd4)" />
    </svg>
  );
}
