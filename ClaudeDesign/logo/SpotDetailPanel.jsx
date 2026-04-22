// SpotDetailPanel.jsx — right-side floating panel with full forecast for selected spot

function SpotDetailPanel({ spot, onClose, forecast, timeIndex, onTimeChange, theme }) {
  const [tab, setTab] = React.useState('forecast'); // 'forecast' | 'ai' | 'log'
  if (!spot) return null;

  const current = forecast[timeIndex] || forecast[0];
  const next24 = forecast.slice(timeIndex, timeIndex + 24);

  return (
    <div className="panel spot-detail">
      <div className="panel-head">
        <div>
          <div className="eyebrow">
            <span className={`dot rating-${spot.rating}`} />
            {spot.label}
          </div>
          <h2 className="panel-title">{spot.name}</h2>
          <div className="panel-sub">{spot.region} · {spot.lat.toFixed(2)}°, {spot.lon.toFixed(2)}°</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="now-strip">
        <NowStat label="Swell" value={current.swell.toFixed(1)} unit="ft" sub={`${current.period}s @ ${Math.round(current.dir)}°`} accent />
        <NowStat label="Wind" value={Math.round(current.wind)} unit="mph" sub="offshore" />
        <NowStat label="Tide" value={current.tide.toFixed(1)} unit="ft" sub={spot.tide} />
        <NowStat label="Water" value={spot.temp} unit="°F" sub="" />
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'forecast' ? 'active' : ''}`} onClick={() => setTab('forecast')}>7-Day Forecast</button>
        <button className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>AI Insight</button>
        <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>My History</button>
      </div>

      {tab === 'forecast' && <ForecastTab forecast={forecast} timeIndex={timeIndex} onTimeChange={onTimeChange} />}
      {tab === 'ai' && <AITab spot={spot} current={current} next24={next24} />}
      {tab === 'log' && <LogTab spot={spot} />}
    </div>
  );
}

function NowStat({ label, value, unit, sub, accent }) {
  return (
    <div className={`now-stat ${accent ? 'accent' : ''}`}>
      <div className="now-label">{label}</div>
      <div className="now-value">
        <span className="num">{value}</span>
        <span className="unit">{unit}</span>
      </div>
      <div className="now-sub">{sub}</div>
    </div>
  );
}

function ForecastTab({ forecast, timeIndex, onTimeChange }) {
  // Weekly chart: show 7 days × 24h as a bar strip
  const max = Math.max(...forecast.map(f => f.swell));
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const today = new Date().getDay();

  return (
    <div className="forecast-tab">
      <div className="chart-label">
        <span>Swell height — next 7 days</span>
        <span className="mono-tiny">{max.toFixed(1)} ft max</span>
      </div>
      <div className="forecast-chart">
        {forecast.map((f, i) => {
          const h = (f.swell / max) * 100;
          const rating = f.rating;
          const ratingColor = rating > 4 ? 'var(--fire)' : rating > 2.5 ? 'var(--accent)' : 'var(--muted-2)';
          return (
            <div
              key={i}
              className={`bar ${i === timeIndex ? 'active' : ''}`}
              style={{ height: `${h}%`, background: ratingColor }}
              onClick={() => onTimeChange(i)}
              title={`Day ${f.d + 1} ${f.h}:00 — ${f.swell}ft`}
            />
          );
        })}
      </div>
      <div className="day-labels">
        {days.map((d, i) => (
          <div key={i} className={`day-label ${i === today ? 'today' : ''}`}>
            <span>{d}</span>
            <span className="mono-tiny">{Math.round(forecast[i * 24 + 12]?.swell || 0)}ft</span>
          </div>
        ))}
      </div>

      <div className="hourly-row">
        <div className="hourly-label">Next 24h</div>
        <div className="hourly-strip">
          {Array.from({ length: 24 }).map((_, i) => {
            const f = forecast[timeIndex + i];
            if (!f) return null;
            const h = (f.swell / max) * 30 + 4;
            return (
              <div key={i} className="hourly-cell">
                <div className="hourly-bar" style={{ height: h }} />
                <div className="mono-tiny">{f.h}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AITab({ spot, current, next24 }) {
  const peak = next24.reduce((best, f, i) => f.rating > best.r ? { r: f.rating, i, f } : best, { r: 0, i: 0, f: next24[0] });
  const peakHour = (current.h + peak.i) % 24;
  const confidence = Math.round(72 + Math.sin(spot.lat) * 18);

  return (
    <div className="ai-tab">
      <div className="ai-banner">
        <div className="ai-pulse" />
        <div>
          <div className="eyebrow">AI Forecast · confidence {confidence}%</div>
          <div className="ai-headline">
            Best window opens at <strong>{peakHour.toString().padStart(2, '0')}:00</strong> — swell peaks at <strong>{peak.f.swell}ft</strong>, winds drop to <strong>{Math.round(peak.f.wind)}mph</strong>.
          </div>
        </div>
      </div>

      <div className="ai-reasoning">
        <div className="ai-reasoning-head">Why I think this:</div>
        <ul>
          <li>
            <span className="ai-tag">Storm tracking</span>
            Long-period NW swell from storm <span className="mono-tiny">LOW-442</span> arrives on schedule. Wrap angle favorable for this spot.
          </li>
          <li>
            <span className="ai-tag">Your history</span>
            You scored this spot <strong>5/5</strong> on <strong>Apr 18</strong> under nearly identical conditions (swell 4.2ft, wind 6mph).
          </li>
          <li>
            <span className="ai-tag">Tide</span>
            {spot.tide === 'rising' ? 'Rising tide through your preferred window — you\'ve logged 4 of your top-5 sessions on pushing tide here.' : 'Tide less ideal than your historical pattern.'}
          </li>
          <li>
            <span className="ai-tag">Crowd</span>
            Tuesday morning — expected 40% of weekend crowd based on your past 6 sessions.
          </li>
        </ul>
      </div>

      <button className="ai-action">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        Set alert for this window
      </button>
    </div>
  );
}

function LogTab({ spot }) {
  const entries = (window.SESSIONS || []).filter(s => s.spot === spot.name);
  const avg = entries.length ? entries.reduce((a, s) => a + s.rating, 0) / entries.length : 0;
  return (
    <div className="log-tab">
      <div className="log-summary">
        <div>
          <div className="eyebrow">Your history here</div>
          <div className="log-count">{entries.length} sessions · avg {avg.toFixed(1)}/5</div>
        </div>
        <button className="btn-ghost">+ Log session</button>
      </div>
      {entries.length === 0 && (
        <div className="empty-state">No sessions logged here yet. Log one to help the AI learn your preferences.</div>
      )}
      {entries.map((s, i) => (
        <div key={i} className="log-entry">
          <div className="log-date">
            <div className="log-day">{new Date(s.date).toLocaleDateString('en-US', { day: '2-digit' })}</div>
            <div className="mono-tiny">{new Date(s.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</div>
          </div>
          <div className="log-body">
            <div className="log-meta">
              <span className="mono-tiny">{s.duration}min</span>
              <span className="sep">·</span>
              <span className="mono-tiny">{s.waves} waves</span>
              <span className="sep">·</span>
              <span className="mono-tiny">{s.swell}ft / {s.wind}mph</span>
            </div>
            <div className="log-note">{s.note}</div>
          </div>
          <div className="log-rating">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className={`rating-dot ${j < s.rating ? 'filled' : ''}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { SpotDetailPanel });
