import React from 'react';

export function hourToX(hour, totalHours = 168, width = 700) {
  return (hour / totalHours) * width;
}

export default function StripChart({ data = [], valueKey, color = 'var(--accent)', height = 34, cursorHour = 0, fillOpacity = 0.2, dayGridlines = true }) {
  const width = 700;
  const cursorX = hourToX(cursorHour, 168, width);

  if (data.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: `${height}px`, display: 'block', overflow: 'visible' }}
        aria-label={valueKey}
      >
        <line x1={cursorX} y1={0} x2={cursorX} y2={height} stroke="var(--gold)" strokeWidth={1.5} strokeDasharray="3 3" />
      </svg>
    );
  }

  const maxVal = Math.max(...data.map(d => d.value), 0.1);

  const points = data.map(d => ({
    x: hourToX(d.t, 168, width),
    y: height - (d.value / maxVal) * (height - 4) - 2,
  }));

  const lineStr = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const areaPath = `${lineStr} L${points[points.length - 1].x.toFixed(2)},${height} L${points[0].x.toFixed(2)},${height} Z`;

  const dayHours = [0, 24, 48, 72, 96, 120, 144, 168];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: `${height}px`, display: 'block', overflow: 'visible' }}
      aria-label={valueKey}
    >
      {dayGridlines && dayHours.map(h => {
        const x = hourToX(h, 168, width);
        return (
          <line key={h} x1={x} y1={0} x2={x} y2={height} stroke="white" strokeOpacity={0.06} strokeWidth={1} />
        );
      })}
      <path d={areaPath} fill={color} fillOpacity={fillOpacity} />
      <path d={lineStr} stroke={color} strokeWidth={1.5} fill="none" />
      <line x1={cursorX} y1={0} x2={cursorX} y2={height} stroke="var(--gold)" strokeWidth={1.5} strokeDasharray="3 3" />
    </svg>
  );
}
