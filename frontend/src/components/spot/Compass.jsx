/**
 * <Compass>
 * SVG radial compass with up to 3 swell arrows + wind arrow.
 * Arrows rotate to the FROM direction of each swell/wind.
 *
 * @param {{ height_ft: number, period_s: number, direction_deg: number, color: string, ring: 'inner'|'mid'|'outer' }[]} swells
 * @param {{ speed_mph: number, direction_deg: number, color: string }} wind
 * @param {number} size - diameter in px (default 520)
 * @param {'default'|'mini'|'titled'} variant
 * @param {string} spotName - shown in center when variant='titled'
 */
export default function Compass({ swells = [], wind = null, size = 520, variant = 'default', spotName }) {
  const isMini = variant === 'mini';

  const ringRadii = { outer: 240, mid: 175, inner: 110 };

  return (
    <div style={{ width: size, height: size }}>
      <svg
        viewBox="-260 -260 520 520"
        width={size}
        height={size}
        overflow="visible"
        style={{ display: 'block' }}
      >
        {/* ── Background rings ── */}
        <circle r={240} fill="none" stroke="oklch(1 0 0 / 0.12)" strokeWidth="1.2" />
        <circle r={175} fill="none" stroke="oklch(1 0 0 / 0.18)" strokeWidth="1.2" />
        <circle r={110} fill="none" stroke="oklch(1 0 0 / 0.22)" strokeWidth="1.2" />

        {/* ── Cardinal labels (omit in mini) ── */}
        {!isMini && (
          <>
            <text x={0} y={-246} textAnchor="middle" dominantBaseline="auto"
              fontFamily="Geist Mono, monospace" fontSize={11} fill="oklch(1 0 0 / 0.5)" letterSpacing="1.5">N</text>
            <text x={246} y={4} textAnchor="start" dominantBaseline="middle"
              fontFamily="Geist Mono, monospace" fontSize={11} fill="oklch(1 0 0 / 0.5)" letterSpacing="1.5">E</text>
            <text x={0} y={252} textAnchor="middle" dominantBaseline="hanging"
              fontFamily="Geist Mono, monospace" fontSize={11} fill="oklch(1 0 0 / 0.5)" letterSpacing="1.5">S</text>
            <text x={-246} y={4} textAnchor="end" dominantBaseline="middle"
              fontFamily="Geist Mono, monospace" fontSize={11} fill="oklch(1 0 0 / 0.5)" letterSpacing="1.5">W</text>
          </>
        )}

        {/* ── Cardinal tick marks (omit in mini) ── */}
        {!isMini && (
          <>
            <line x1={0} y1={-235} x2={0} y2={-225} stroke="oklch(1 0 0 / 0.3)" strokeWidth="1.5" />
            <line x1={235} y1={0} x2={225} y2={0} stroke="oklch(1 0 0 / 0.3)" strokeWidth="1.5" />
            <line x1={0} y1={235} x2={0} y2={225} stroke="oklch(1 0 0 / 0.3)" strokeWidth="1.5" />
            <line x1={-235} y1={0} x2={-225} y2={0} stroke="oklch(1 0 0 / 0.3)" strokeWidth="1.5" />
          </>
        )}

        {/* ── Wind arrow (outer ring r=240) ── */}
        {wind && wind.direction_deg != null && (
          <g transform={`rotate(${wind.direction_deg})`}>
            <g transform="translate(0, -240)">
              <path d="M0 18 L-10 -2 L0 6 L10 -2 Z"
                fill={wind.color || 'var(--wind)'} opacity={0.85} />
              {/* Label pill (omit in mini) */}
              {!isMini && wind.speed_mph != null && (
                <g transform={`translate(0, -20)${wind.direction_deg > 90 && wind.direction_deg < 270 ? ' rotate(180)' : ''}`}>
                  <rect
                    x={-26} y={-11} width={52} height={22} rx={11}
                    fill="oklch(0.14 0.02 230)" stroke={wind.color || 'var(--wind)'} strokeWidth="1"
                    strokeOpacity="0.6"
                  />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontFamily="Geist, sans-serif" fontWeight={600} fontSize={11}
                    fill={wind.color || 'var(--wind)'}>
                    {Math.round(wind.speed_mph)} mph
                  </text>
                </g>
              )}
            </g>
          </g>
        )}

        {/* ── Swell arrows ── */}
        {swells.map((swell, i) => {
          if (swell.direction_deg == null) return null;
          const ring = swell.ring || 'mid';
          const r = ringRadii[ring] || ringRadii.mid;
          const color = swell.color || 'var(--s1)';

          let arrowPath, labelWidth, labelHeight, labelRx, labelFontSize, labelFontWeight, labelTranslateY;

          if (ring === 'mid') {
            arrowPath = 'M0 20 L-10 0 L0 8 L10 0 Z';
            labelWidth = 68; labelHeight = 22; labelRx = 11;
            labelFontSize = 11; labelFontWeight = 700;
            labelTranslateY = -20;
          } else if (ring === 'inner') {
            arrowPath = 'M0 14 L-7 2 L0 7 L7 2 Z';
            labelWidth = 60; labelHeight = 20; labelRx = 10;
            labelFontSize = 10; labelFontWeight = 700;
            labelTranslateY = -16;
          } else {
            // outer (not normally used for swells but handle gracefully)
            arrowPath = 'M0 18 L-10 -2 L0 6 L10 -2 Z';
            labelWidth = 68; labelHeight = 22; labelRx = 11;
            labelFontSize = 11; labelFontWeight = 700;
            labelTranslateY = -20;
          }

          const hasLabel = !isMini && swell.height_ft != null;
          const labelText = hasLabel
            ? `${swell.height_ft.toFixed(1)}ft · ${swell.period_s ? Math.round(swell.period_s) : '—'}s`
            : null;

          return (
            <g key={i} transform={`rotate(${swell.direction_deg})`}>
              <g transform={`translate(0, -${r})`}>
                <path d={arrowPath} fill={color} opacity={0.85} />
                {hasLabel && (
                  <g transform={`translate(0, ${labelTranslateY})${swell.direction_deg > 90 && swell.direction_deg < 270 ? ' rotate(180)' : ''}`}>
                    <rect
                      x={-labelWidth / 2} y={-labelHeight / 2}
                      width={labelWidth} height={labelHeight} rx={labelRx}
                      fill="oklch(0.14 0.02 230)" stroke={color} strokeWidth="1"
                      strokeOpacity="0.6"
                    />
                    <text textAnchor="middle" dominantBaseline="middle"
                      fontFamily="Geist, sans-serif" fontWeight={labelFontWeight} fontSize={labelFontSize}
                      fill={color}>
                      {labelText}
                    </text>
                  </g>
                )}
              </g>
            </g>
          );
        })}

        {/* ── Center spot icon ── */}
        {/* Outer dark circle */}
        <circle r={30} fill="oklch(0.14 0.02 230)" stroke="oklch(1 0 0 / 0.3)" strokeWidth={1.5} />
        {/* Inner fill circle (accent tint) */}
        <circle r={22} fill="var(--accent)" opacity={0.12} />
        {/* Inner ring */}
        <circle r={22} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.5} />
        {/* Bolt icon */}
        <svg x={-12} y={-12} width={24} height={24} viewBox="0 0 24 24">
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" fill="var(--fire)" />
        </svg>
      </svg>
    </div>
  );
}
