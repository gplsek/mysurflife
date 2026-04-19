// MobileCompanion.jsx — phone-sized companion rendering inside an iOS-ish frame

function MobileCompanion({ theme }) {
  const [screen, setScreen] = React.useState('home'); // home | spot | log
  const hero = window.SPOTS[0]; // Lowers

  return (
    <div className="phone-frame">
      <div className="phone-notch" />
      <div className="phone-status-bar">
        <span>9:41</span>
        <span className="status-icons">
          <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor"><rect x="0" y="6" width="2" height="4"/><rect x="4" y="4" width="2" height="6"/><rect x="8" y="2" width="2" height="8"/><rect x="12" y="0" width="2" height="10"/></svg>
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M6 2 Q3 2 1 4 M6 5 Q4.5 5 3.5 6" /><circle cx="6" cy="8" r="0.8" fill="currentColor" /></svg>
          <svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="18" height="9" rx="2" /><rect x="2" y="2" width="14" height="6" fill="currentColor" /><rect x="19.5" y="3.5" width="1.5" height="3" fill="currentColor" /></svg>
        </span>
      </div>

      <div className="phone-screen">
        {screen === 'home' && (
          <div className="m-home">
            <div className="m-hero">
              <div className="m-hero-bg"><MapBackground theme={theme} animated={false} /></div>
              <div className="m-hero-content">
                <div className="eyebrow">Tuesday · 06:12</div>
                <div className="m-hero-title">It's on.</div>
                <div className="m-hero-sub">AI predicts <strong>firing</strong> at Lowers until 09:30.</div>
                <div className="m-hero-numbers">
                  <div><span className="num">4.2</span><span className="unit">ft</span></div>
                  <div><span className="num">14</span><span className="unit">s</span></div>
                  <div><span className="num">6</span><span className="unit">mph</span></div>
                </div>
              </div>
            </div>

            <div className="m-section-label">FAVORITES</div>
            {window.SPOTS.slice(0, 4).map(s => (
              <div key={s.id} className="m-spot-row" onClick={() => setScreen('spot')}>
                <span className={`dot rating-${s.rating}`} />
                <div className="m-spot-text">
                  <div className="m-spot-name">{s.name}</div>
                  <div className="mono-tiny">{s.region}</div>
                </div>
                <div className="m-spot-num">
                  <div><span className="num">{s.swell.toFixed(1)}</span><span className="unit">ft</span></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {screen === 'spot' && (
          <div className="m-spot">
            <button className="m-back" onClick={() => setScreen('home')}>
              <svg width="14" height="14" viewBox="0 0 14 14"><path d="M9 2l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
              Back
            </button>
            <div className="eyebrow"><span className="dot rating-4" /> FIRING</div>
            <div className="m-spot-title">{hero.name}</div>
            <div className="mono-tiny">{hero.region}</div>

            <div className="m-now-grid">
              <div className="m-now"><div className="lbl">Swell</div><div className="num">{hero.swell}<span className="unit">ft</span></div></div>
              <div className="m-now"><div className="lbl">Period</div><div className="num">{hero.period}<span className="unit">s</span></div></div>
              <div className="m-now"><div className="lbl">Wind</div><div className="num">{hero.wind}<span className="unit">mph</span></div></div>
              <div className="m-now"><div className="lbl">Tide</div><div className="num">{hero.tide}</div></div>
            </div>

            <div className="m-ai">
              <div className="eyebrow"><div className="ai-pulse" />AI · 84% confidence</div>
              <div className="m-ai-text">Best window <strong>06:30–09:30</strong>. Conditions match your top session here (Apr 18, rated 5/5).</div>
            </div>

            <div className="m-chart">
              <div className="mono-tiny">NEXT 12H · SWELL</div>
              <div className="m-chart-bars">
                {Array.from({ length: 12 }).map((_, i) => {
                  const h = 40 + Math.sin(i / 2) * 20 + Math.cos(i / 3) * 10;
                  return <div key={i} className="m-bar" style={{ height: `${h}%` }} />;
                })}
              </div>
            </div>

            <button className="m-cta">Set alert for this window →</button>
          </div>
        )}
      </div>

      <div className="phone-tabbar">
        <button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 8l7-6 7 6v8h-4v-5H6v5H2V8z"/></svg>
          <span>Home</span>
        </button>
        <button>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="9" cy="9" r="7"/><path d="M2 9h14M9 2c3 2.5 3 11.5 0 14M9 2c-3 2.5-3 11.5 0 14"/></svg>
          <span>Map</span>
        </button>
        <button>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4h14v10H2z"/><path d="M2 7h14M6 4v10"/></svg>
          <span>Log</span>
        </button>
        <button>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 7a5 5 0 0110 0v4l1.5 2.5H2.5L4 11V7z"/><path d="M7 14a2 2 0 004 0"/></svg>
          <span>Alerts</span>
        </button>
      </div>
      <div className="phone-home-indicator" />
    </div>
  );
}

Object.assign(window, { MobileCompanion });
