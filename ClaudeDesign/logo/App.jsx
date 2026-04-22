// App.jsx — main shell that composes map + topbar + panels + screens + mobile + tweaks

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "ocean",
  "density": "normal",
  "showWind": true,
  "showSwell": true,
  "showMobile": true,
  "panelStyle": "glass",
  "state": "normal"
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweaks] = React.useState(DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const [view, setView] = React.useState('map'); // map | dashboard | sessions | alerts
  const [selectedSpot, setSelectedSpot] = React.useState(window.SPOTS[0]);
  const [timeIndex, setTimeIndex] = React.useState(6);
  const [playing, setPlaying] = React.useState(false);
  const [vpWide, setVpWide] = React.useState(() => typeof window !== 'undefined' && window.innerWidth >= 1380);

  React.useEffect(() => {
    const onR = () => setVpWide(window.innerWidth >= 1380);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const forecast = React.useMemo(
    () => window.genForecast(selectedSpot ? selectedSpot.lat : 1),
    [selectedSpot]
  );

  // Persist view + spot
  React.useEffect(() => {
    const saved = localStorage.getItem('surflife:view');
    if (saved) setView(saved);
  }, []);
  React.useEffect(() => { localStorage.setItem('surflife:view', view); }, [view]);

  // Playing animation across timeline
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTimeIndex(i => (i + 1) % forecast.length), 120);
    return () => clearInterval(id);
  }, [playing, forecast.length]);

  // Tweaks: listen for host activate/deactivate
  React.useEffect(() => {
    const onMsg = (e) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const updateTweak = (k, v) => {
    setTweaks(t => ({ ...t, [k]: v }));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*');
  };

  // Apply theme
  React.useEffect(() => {
    const t = tweaks.theme === 'dawn' ? 'dawn' : tweaks.theme === 'daylight' ? 'daylight' : 'ocean';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.setProperty('--density', tweaks.density === 'compact' ? '0.85' : '1');
  }, [tweaks.theme, tweaks.density]);

  const [errorDismissed, setErrorDismissed] = React.useState(false);
  const [stormOpen, setStormOpen] = React.useState(false);
  const loading = tweaks.state === 'loading';
  const offline = tweaks.state === 'offline';
  const errored = tweaks.state === 'error' && !errorDismissed;
  const empty = tweaks.state === 'empty';

  return (
    <div className="app" data-screen-label={`01 ${view}`}>
      {/* Map layer — always beneath */}
      {view === 'map' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <MapBackground theme={tweaks.theme === 'dawn' ? 'dawn' : 'ocean'} showWind={tweaks.showWind} showSwell={tweaks.showSwell} animated />
          {window.SPOTS.map(s => {
            const x = ((s.lon + 180) / 360) * 100;
            const y = ((90 - s.lat) / 180) * 100;
            return (
            <div
              key={s.id}
              className={`spot-marker ${s.rating >= 4 ? 'fire' : ''} ${selectedSpot && selectedSpot.id === s.id ? 'selected' : ''}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => setSelectedSpot(s)}
            >
              <div className="spot-marker-dot" />
              <div className="spot-marker-label">
                {s.name}
                <span className="spot-num">{s.swell.toFixed(1)}ft</span>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Non-map screens */}
      {view === 'dashboard' && <DashboardScreen onOpenSpot={(s) => { setSelectedSpot(s); setView('map'); }} empty={empty} onOpenStorm={() => setStormOpen(true)} />}
      {view === 'sessions' && <SessionsScreen />}
      {view === 'alerts' && <AlertsScreen />}

      {/* Top chrome — on every view */}
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-name">mysurf<span className="dim">life</span></div>
        </div>
        <div className="nav">
          <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="6" cy="6" r="5"/><path d="M1 6h10M6 1c2 1.5 2 8 0 10M6 1c-2 1.5-2 8 0 10"/></svg>
            Map
          </button>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="1" width="4" height="5"/><rect x="7" y="1" width="4" height="3"/><rect x="1" y="8" width="4" height="3"/><rect x="7" y="6" width="4" height="5"/></svg>
            Dashboard
          </button>
          <button className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 2h8v8H2z"/><path d="M2 5h8M5 2v8"/></svg>
            Journal
          </button>
          <button className={view === 'alerts' ? 'active' : ''} onClick={() => setView('alerts')}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 5a4 4 0 018 0v3l1 2H1l1-2V5z"/><path d="M4 10a2 2 0 004 0"/></svg>
            Alerts
          </button>
        </div>
        <div className="search">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="5" cy="5" r="3.5"/><path d="M8 8l3 3"/></svg>
          <input placeholder="Search spots, regions, storms…" defaultValue="" />
          <span className="mono-tiny" style={{ opacity: 0.6 }}>⌘K</span>
        </div>
        <div className="topbar-right">
          <button className="icon-btn-lg storm-btn" title="Storm tracker" onClick={() => setStormOpen(true)} style={{ width: 'auto', padding: '0 12px', gap: 8, display: 'inline-flex', alignItems: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M7 2a3 3 0 013 3 2 2 0 01-2 2H4a2 2 0 01-1-3.8A3 3 0 017 2z"/>
              <path d="M5 9l-1 3M8 9l-1 3M10 9l-1 2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 12 }}>Storms</span>
            <span className="mono-tiny" style={{ padding: '1px 5px', background: 'var(--fire)', color: 'var(--bg)', borderRadius: 3, fontSize: 9 }}>3</span>
          </button>
          <button className="icon-btn-lg" title="Notifications">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 5a5 5 0 0110 0v3l1 2H1l1-2V5z"/><path d="M5 11a2 2 0 004 0"/></svg>
          </button>
          <div className="avatar">AR</div>
        </div>
      </div>

      {/* Map-only chrome */}
      {view === 'map' && (
        <>
          <div className="layers">
            <LayerBtn label="WIND" icon="wind" on={tweaks.showWind} onClick={() => updateTweak('showWind', !tweaks.showWind)} />
            <LayerBtn label="SWL" icon="swell" on={tweaks.showSwell} onClick={() => updateTweak('showSwell', !tweaks.showSwell)} />
            <LayerBtn label="TIDE" icon="tide" on={false} onClick={() => {}} />
            <LayerBtn label="TEMP" icon="temp" on={false} onClick={() => {}} />
            <div className="layers-sep" />
            <LayerBtn label="CAMS" icon="cam" on={false} onClick={() => {}} />
          </div>

          <div className="legend">
            <div className="legend-head">SPOT RATING</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: 'var(--fire)' }} /> Firing / XXL</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: 'var(--accent)' }} /> Solid</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: 'oklch(0.58 0.10 230)' }} /> Fair</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: 'var(--muted-2)' }} /> Flat / Blown</div>
          </div>

          <Timeline
            timeIndex={timeIndex}
            forecast={forecast}
            onTimeChange={setTimeIndex}
            playing={playing}
            onPlay={() => setPlaying(p => !p)}
          />

          {selectedSpot && !loading && (
            <SpotDetailPanel
              spot={selectedSpot}
              onClose={() => setSelectedSpot(null)}
              forecast={forecast}
              timeIndex={timeIndex}
              onTimeChange={setTimeIndex}
              theme={tweaks.theme}
            />
          )}
          {selectedSpot && loading && <PanelSkeleton />}

          <MapLoadingOverlay show={loading} />
          <OfflineBanner show={offline} />
          <ErrorBanner show={errored} onDismiss={() => setErrorDismissed(true)} />

          {tweaks.showMobile && vpWide && !selectedSpot && (
            <div className="mobile-container">
              <div className="mobile-label">↓ mobile companion</div>
              <MobileCompanion theme={tweaks.theme === 'dawn' ? 'dawn' : 'ocean'} />
            </div>
          )}
        </>
      )}

      {/* Storm modal — always rendered regardless of view */}
      <StormTrackerDetail show={stormOpen} onClose={() => setStormOpen(false)} />

      {/* Tweaks panel */}
      <div className={`tweaks ${tweaksOpen ? '' : 'hidden'}`}>
        <h3>Tweaks</h3>
        <div className="tweak-row">
          <label>Theme</label>
          <div className="tweak-seg">
            <button className={tweaks.theme === 'ocean' ? 'active' : ''} onClick={() => updateTweak('theme', 'ocean')}>Ocean</button>
            <button className={tweaks.theme === 'dawn' ? 'active' : ''} onClick={() => updateTweak('theme', 'dawn')}>Dawn</button>
            <button className={tweaks.theme === 'daylight' ? 'active' : ''} onClick={() => updateTweak('theme', 'daylight')}>Daylight</button>
          </div>
        </div>
        <div className="tweak-row">
          <label>State</label>
          <div className="tweak-seg">
            <button className={tweaks.state === 'normal' ? 'active' : ''} onClick={() => { updateTweak('state', 'normal'); setErrorDismissed(false); }}>Normal</button>
            <button className={tweaks.state === 'loading' ? 'active' : ''} onClick={() => updateTweak('state', 'loading')}>Loading</button>
            <button className={tweaks.state === 'offline' ? 'active' : ''} onClick={() => updateTweak('state', 'offline')}>Offline</button>
          </div>
          <div className="tweak-seg" style={{ marginTop: 4 }}>
            <button className={tweaks.state === 'error' ? 'active' : ''} onClick={() => { updateTweak('state', 'error'); setErrorDismissed(false); }}>Model error</button>
            <button className={tweaks.state === 'empty' ? 'active' : ''} onClick={() => updateTweak('state', 'empty')}>Empty favs</button>
          </div>
        </div>
        <div className="tweak-row">
          <label>Density</label>
          <div className="tweak-seg">
            <button className={tweaks.density === 'compact' ? 'active' : ''} onClick={() => updateTweak('density', 'compact')}>Compact</button>
            <button className={tweaks.density === 'normal' ? 'active' : ''} onClick={() => updateTweak('density', 'normal')}>Normal</button>
          </div>
        </div>
        <div className="tweak-row">
          <label>Mobile companion</label>
          <div className="tweak-seg">
            <button className={tweaks.showMobile ? 'active' : ''} onClick={() => updateTweak('showMobile', true)}>Show</button>
            <button className={!tweaks.showMobile ? 'active' : ''} onClick={() => updateTweak('showMobile', false)}>Hide</button>
          </div>
        </div>
        <div className="tweak-row">
          <label>Wind layer</label>
          <div className="tweak-seg">
            <button className={tweaks.showWind ? 'active' : ''} onClick={() => updateTweak('showWind', true)}>On</button>
            <button className={!tweaks.showWind ? 'active' : ''} onClick={() => updateTweak('showWind', false)}>Off</button>
          </div>
        </div>
        <div className="tweak-row">
          <label>Swell rings</label>
          <div className="tweak-seg">
            <button className={tweaks.showSwell ? 'active' : ''} onClick={() => updateTweak('showSwell', true)}>On</button>
            <button className={!tweaks.showSwell ? 'active' : ''} onClick={() => updateTweak('showSwell', false)}>Off</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerBtn({ label, on, onClick, icon }) {
  const icons = {
    wind: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2 6h8a2 2 0 100-4M2 10h10a2 2 0 110 4M2 8h6"/></svg>,
    swell: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1 8c2-2 3 2 5 0s3-2 5 0 3 2 4 0M1 12c2-2 3 2 5 0s3-2 5 0 3 2 4 0"/></svg>,
    tide: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1 11c2-1 3 1 5 0s3-1 5 0 3 1 4 0M8 2v5"/><path d="M6 4l2-2 2 2"/></svg>,
    temp: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M8 1v8a3 3 0 103 3"/><circle cx="8" cy="12" r="1.5" fill="currentColor"/></svg>,
    cam: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="4" width="10" height="8" rx="1"/><path d="M11 7l4-2v6l-4-2z"/></svg>,
  };
  return (
    <button className={on ? 'on' : ''} onClick={onClick} title={label}>
      {icons[icon]}
      <span>{label}</span>
    </button>
  );
}

function Timeline({ timeIndex, forecast, onTimeChange, playing, onPlay }) {
  const trackRef = React.useRef(null);
  const max = Math.max(...forecast.map(f => f.swell));
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const today = new Date().getDay();

  const current = forecast[timeIndex] || forecast[0];
  const day = (today + current.d) % 7;
  const hour = current.h;

  const handleClick = (e) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onTimeChange(Math.floor(pct * forecast.length));
  };

  return (
    <div className="timeline">
      <button className="timeline-play" onClick={onPlay}>
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="3" y="2" width="2.5" height="8" fill="currentColor"/><rect x="6.5" y="2" width="2.5" height="8" fill="currentColor"/></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2l7 4-7 4V2z" fill="currentColor"/></svg>
        )}
      </button>
      <div className="timeline-label">
        {days[day]} · <span>{hour.toString().padStart(2,'0')}:00</span>
        <span className="dim"> · swell {current.swell.toFixed(1)}ft / wind {Math.round(current.wind)}mph</span>
      </div>
      <div className="timeline-track" ref={trackRef} onClick={handleClick}>
        <div className="timeline-heatmap">
          {forecast.map((f, i) => {
            const rating = f.rating;
            const color = rating > 4 ? 'var(--fire)' : rating > 3 ? 'var(--accent)' : rating > 2 ? 'oklch(0.58 0.10 230)' : 'var(--muted-2)';
            const opacity = 0.35 + (f.swell / max) * 0.6;
            return <div key={i} style={{ background: color, opacity }} />;
          })}
        </div>
        <div className="timeline-ticks">
          {days.map((d, i) => (
            <div key={i} className="timeline-tick">
              <span className="timeline-tick-label">{days[(today + i) % 7]}</span>
            </div>
          ))}
        </div>
        <div className="timeline-playhead" style={{ left: `${(timeIndex / forecast.length) * 100}%` }}>
          <div className="timeline-playhead-label">{days[day]} {hour.toString().padStart(2,'0')}:00</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { App });

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
