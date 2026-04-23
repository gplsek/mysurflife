/**
 * <ForecastScrubber>
 * 0–168h range slider with gradient track, tick labels, and an optional
 * mini wave strip chart below the thumb.
 */
export default function ForecastScrubber({
  totalHours = 168,
  selectedHour = 0,
  onChange,
  miniChartData = [],
  startDate = null,
}) {
  const tickLabels = ['Now', '24h', '48h', '72h', '96h', '120h', '144h', '168h'];

  // Build mini chart SVG paths
  let areaPath = '';
  let linePath = '';
  if (miniChartData.length > 1) {
    const maxVal = Math.max(...miniChartData.map(d => d.value), 0.1);
    const W = 700;
    const H = 46;
    const points = miniChartData.map(d => ({
      x: (d.t / totalHours) * W,
      y: H - (d.value / maxVal) * (H - 6) - 3,
    }));
    const lineStr = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    linePath = lineStr;
    areaPath = `${lineStr} L${points[points.length - 1].x.toFixed(1)},${H} L${points[0].x.toFixed(1)},${H} Z`;
  }

  const cursorX = (selectedHour / totalHours) * 700;

  return (
    <div className="sd-scrubber">
      {/* Track + thumb row */}
      <div className="sd-track-row">
        <div className="sd-track" />
        <input
          type="range"
          className="sd-range"
          min={0}
          max={totalHours}
          step={1}
          value={selectedHour}
          onChange={e => onChange?.(parseInt(e.target.value, 10))}
        />
      </div>

      {/* Tick labels */}
      <div className="sd-ticks">
        {tickLabels.map((label, i) => {
          const isFirst = i === 0;
          const isCurrent = isFirst && selectedHour === 0;
          const displayLabel = isFirst && selectedHour !== 0 ? `+${selectedHour}h` : label;
          return (
            <span
              key={i}
              className={isCurrent ? 'sd-tick-current' : undefined}
            >
              {displayLabel}
            </span>
          );
        })}
      </div>

      {/* Mini chart — always visible */}
      <div className="sd-mini-chart-row">
        <span className="sd-mini-chart-label">7-Day Wave</span>
        {miniChartData.length > 1 ? (
          <svg
            viewBox="0 0 700 46"
            preserveAspectRatio="none"
            className="sd-mini-chart-svg"
          >
            {Array.from({ length: 8 }, (_, i) => {
              const x = (i * 24 / totalHours) * 700;
              return (
                <line
                  key={i}
                  x1={x} y1={0} x2={x} y2={46}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
              );
            })}
            <path d={areaPath} fill="var(--s1)" fillOpacity={0.18} />
            <path d={linePath} fill="none" stroke="var(--s1)" strokeWidth="1.6" />
            <line
              x1={cursorX} y1={0} x2={cursorX} y2={46}
              stroke="var(--gold)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          </svg>
        ) : (
          <div className="sd-strip-skeleton" style={{ height: 46, flex: 1 }} />
        )}
      </div>
    </div>
  );
}
