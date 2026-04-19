// SideScreens.jsx — Dashboard, Sessions journal, Alerts settings

function DashboardScreen({ onOpenSpot, empty, onOpenStorm }) {
  const favs = empty ? [] : window.SPOTS.filter(s => ['lowers', 'rincon', 'malibu', 'pipeline', 'mavericks'].includes(s.id));
  return (
    <div className="screen dashboard">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Good morning · Tuesday, April 19</div>
          <h1 className="screen-title">Dawn patrol looks <span className="text-fire">firing</span> at Lowers.</h1>
          <div className="screen-sub">Your AI has 5 alerts and a forecast tuned to 27 past sessions.</div>
        </div>
        <div className="screen-meta">
          <div className="meta-stat"><span className="num">27</span><span className="lbl">sessions YTD</span></div>
          <div className="meta-stat"><span className="num">4.2</span><span className="lbl">avg rating</span></div>
          <div className="meta-stat"><span className="num">42h</span><span className="lbl">in the water</span></div>
        </div>
      </div>

      <div className="favs-grid">
        {favs.length === 0 && <div style={{ gridColumn: '1 / -1' }}><EmptyFavorites onAdd={() => onOpenSpot(window.SPOTS[0])} /></div>}
        {favs.map(s => (
          <div key={s.id} className="fav-card" onClick={() => onOpenSpot(s)}>
            <div className="fav-head">
              <span className={`dot rating-${s.rating}`} />
              <span className="fav-label">{s.label}</span>
            </div>
            <div className="fav-name">{s.name}</div>
            <div className="fav-region">{s.region}</div>
            <div className="fav-stats">
              <div><span className="num">{s.swell.toFixed(1)}</span><span className="unit">ft</span></div>
              <div><span className="num">{s.period}</span><span className="unit">s</span></div>
              <div><span className="num">{s.wind}</span><span className="unit">mph</span></div>
            </div>
            <div className="fav-bar">
              <div className="fav-bar-fill" style={{ width: `${s.rating * 20}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="dash-row">
        <div className="dash-card wide">
          <div className="card-head">
            <div className="eyebrow">AI Storm Tracker</div>
            <div className="mono-tiny">Updated 12 min ago</div>
          </div>
          <div className="storm-list">
            <div className="storm" style={{ cursor: 'pointer' }} onClick={onOpenStorm}>
              <div className="storm-id">LOW-442</div>
              <div className="storm-body">
                <div className="storm-name">North Pacific swell generator</div>
                <div className="storm-meta mono-tiny">Gen: Apr 16 · ETA: Apr 22 · Peak: 6–8ft @ 16s</div>
              </div>
              <div className="storm-impact fire">Impacts 4 of your spots</div>
            </div>
            <div className="storm">
              <div className="storm-id">LOW-451</div>
              <div className="storm-body">
                <div className="storm-name">Southern Hemisphere pulse</div>
                <div className="storm-meta mono-tiny">Gen: Apr 18 · ETA: Apr 26 · Peak: 3–5ft @ 14s</div>
              </div>
              <div className="storm-impact">Impacts 2 of your spots</div>
            </div>
            <div className="storm">
              <div className="storm-id">HIGH-203</div>
              <div className="storm-body">
                <div className="storm-name">Coastal ridge — light winds</div>
                <div className="storm-meta mono-tiny">Apr 19–21 · Offshore mornings likely</div>
              </div>
              <div className="storm-impact ok">Favorable all spots</div>
            </div>
          </div>
        </div>

        <div className="dash-card">
          <div className="card-head">
            <div className="eyebrow">This week's windows</div>
          </div>
          <div className="window-list">
            <div className="window"><span className="mono-tiny">TUE 06:30</span><span>Lowers · 4.2ft / 6mph</span><span className="dot rating-4" /></div>
            <div className="window"><span className="mono-tiny">WED 07:15</span><span>Rincon · 3.8ft / 5mph</span><span className="dot rating-4" /></div>
            <div className="window"><span className="mono-tiny">FRI 05:45</span><span>Lowers · 5.6ft / 4mph</span><span className="dot rating-5" /></div>
            <div className="window"><span className="mono-tiny">SAT 08:00</span><span>Malibu · 3.2ft / 7mph</span><span className="dot rating-3" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionsScreen() {
  const entries = window.SESSIONS || [];
  const totalMin = entries.reduce((a, s) => a + s.duration, 0);
  const totalWaves = entries.reduce((a, s) => a + s.waves, 0);
  const avgRating = entries.reduce((a, s) => a + s.rating, 0) / entries.length;

  return (
    <div className="screen sessions">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Session Journal</div>
          <h1 className="screen-title">Your surf memory, indexed.</h1>
          <div className="screen-sub">Every session feeds your personal forecast model.</div>
        </div>
        <button className="btn-primary">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          New session
        </button>
      </div>

      <div className="sessions-stats">
        <div className="stat-block"><div className="num-big">{entries.length}</div><div className="lbl">sessions</div></div>
        <div className="stat-block"><div className="num-big">{Math.round(totalMin / 60)}<span className="unit">h</span>{totalMin % 60}<span className="unit">m</span></div><div className="lbl">in water</div></div>
        <div className="stat-block"><div className="num-big">{totalWaves}</div><div className="lbl">waves caught</div></div>
        <div className="stat-block"><div className="num-big">{avgRating.toFixed(1)}<span className="unit">/5</span></div><div className="lbl">avg rating</div></div>
      </div>

      <div className="sessions-list">
        {entries.map((s, i) => (
          <div key={i} className="session-row">
            <div className="session-date">
              <div className="session-day">{new Date(s.date).toLocaleDateString('en-US', { day: '2-digit' })}</div>
              <div className="mono-tiny">{new Date(s.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</div>
            </div>
            <div className="session-body">
              <div className="session-head-row">
                <div className="session-spot">{s.spot}</div>
                <div className="session-rating">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className={`rating-dot ${j < s.rating ? 'filled' : ''}`} />
                  ))}
                </div>
              </div>
              <div className="session-meta">
                <span className="mono-tiny">{s.duration}min</span>
                <span className="sep">·</span>
                <span className="mono-tiny">{s.waves} waves</span>
                <span className="sep">·</span>
                <span className="mono-tiny">{s.swell}ft @ {s.wind}mph</span>
              </div>
              <div className="session-note">{s.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsScreen() {
  const [alerts, setAlerts] = React.useState(window.ALERTS);
  const toggle = (id) => setAlerts(a => a.map(x => x.id === id ? { ...x, active: !x.active } : x));

  return (
    <div className="screen alerts">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Alerts & Notifications</div>
          <h1 className="screen-title">Tell us when to wake you up.</h1>
          <div className="screen-sub">The AI watches conditions 24/7 and pings you only when it matters.</div>
        </div>
        <button className="btn-primary">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          New alert
        </button>
      </div>

      <div className="alert-list">
        {alerts.map(a => (
          <div key={a.id} className={`alert-row ${!a.active ? 'off' : ''}`}>
            <div className="alert-icon">
              {a.ai ? (
                <div className="ai-chip">AI</div>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5a5 5 0 0110 0v3l1 2H1l1-2V5z" stroke="currentColor" strokeWidth="1.3"/><path d="M5 11a2 2 0 004 0" stroke="currentColor" strokeWidth="1.3"/></svg>
              )}
            </div>
            <div className="alert-body">
              <div className="alert-head-row">
                <div className="alert-spot">{a.spot}</div>
                <div className="mono-tiny alert-channel">{a.channel}</div>
              </div>
              <div className="alert-cond">{a.condition}</div>
              <div className="mono-tiny alert-trig">Last triggered: {a.lastTriggered}</div>
            </div>
            <Toggle on={a.active} onChange={() => toggle(a.id)} />
          </div>
        ))}
      </div>

      <div className="quiet-hours">
        <div>
          <div className="eyebrow">Quiet hours</div>
          <div className="quiet-desc">Don't ping me between <strong>21:00</strong> and <strong>05:00</strong>.</div>
        </div>
        <Toggle on={true} />
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onChange} aria-pressed={on}>
      <span className="toggle-knob" />
    </button>
  );
}

Object.assign(window, { DashboardScreen, SessionsScreen, AlertsScreen, Toggle });
