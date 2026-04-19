// States.jsx — loading, empty, offline, error states

function OfflineBanner({ show }) {
  if (!show) return null;
  return (
    <div className="state-banner offline">
      <div className="banner-dot" />
      <div>
        <strong>You're offline.</strong> Showing last synced forecast from <span className="mono-tiny">06:12 — 34 min ago.</span>
      </div>
      <button className="banner-action">Retry</button>
    </div>
  );
}

function ErrorBanner({ show, onDismiss }) {
  if (!show) return null;
  return (
    <div className="state-banner error">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="6"/><path d="M7 4v3M7 9.5v.5"/></svg>
      <div>
        <strong>Forecast model delayed.</strong> NOAA WW3 run 18Z failed to publish — we're using the 12Z run. AI confidence reduced.
      </div>
      <button className="banner-action" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function MapLoadingOverlay({ show }) {
  if (!show) return null;
  return (
    <div className="map-loading">
      <div className="loading-pulse" />
      <div className="mono-tiny">Fetching forecast · NOAA WW3 · GFS 0.25° · tide stations</div>
      <div className="loading-bars">
        <div><span>Storm tracking</span><span className="mono-tiny">done</span></div>
        <div><span>Wave model</span><span className="mono-tiny loading">loading…</span></div>
        <div className="pending"><span>Personal AI model</span><span className="mono-tiny">queued</span></div>
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="panel skeleton">
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <div className="sk sk-eyebrow" />
          <div className="sk sk-title" />
          <div className="sk sk-sub" />
        </div>
      </div>
      <div className="now-strip">
        {[1,2,3,4].map(i => (
          <div key={i} className="now-stat">
            <div className="sk sk-line" style={{ width: '40%' }} />
            <div className="sk sk-num" />
            <div className="sk sk-line" style={{ width: '60%' }} />
          </div>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        <div className="sk sk-chart" />
        <div className="sk sk-line" style={{ width: '100%', marginTop: 16 }} />
        <div className="sk sk-line" style={{ width: '80%' }} />
        <div className="sk sk-line" style={{ width: '60%' }} />
      </div>
    </div>
  );
}

function EmptyFavorites({ onAdd }) {
  return (
    <div className="empty-favs">
      <div className="empty-illustration">
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none">
          <path d="M4 50 Q30 30 60 50 T116 50" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
          <path d="M4 58 Q30 38 60 58 T116 58" stroke="currentColor" strokeWidth="1.2" opacity="0.25" />
          <path d="M4 66 Q30 46 60 66 T116 66" stroke="currentColor" strokeWidth="1.2" opacity="0.15" />
          <circle cx="60" cy="20" r="4" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6"/>
          <path d="M60 28v10" stroke="currentColor" strokeWidth="1" opacity="0.4" strokeDasharray="2 2"/>
        </svg>
      </div>
      <div className="empty-title">No favorited spots yet.</div>
      <div className="empty-body">
        Tap the star on any spot to add it here. The AI learns faster with more spots to compare — <span className="mono-tiny">aim for 3–5</span>.
      </div>
      <button className="btn-primary" onClick={onAdd}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        Browse map
      </button>
    </div>
  );
}

function StormTrackerDetail({ show, onClose }) {
  if (!show) return null;
  return (
    <div className="storm-modal-bg" onClick={onClose}>
      <div className="storm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="eyebrow"><span className="dot rating-5" /> Active · Category 2-equivalent</div>
            <h2 className="panel-title">Storm LOW-442</h2>
            <div className="panel-sub">North Pacific · 52°N, 168°W · moving ENE at 34kt</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="now-strip">
          <div className="now-stat accent"><div className="now-label">Central pressure</div><div className="now-value"><span className="num">967</span><span className="unit">mb</span></div><div className="now-sub">dropping</div></div>
          <div className="now-stat"><div className="now-label">Max winds</div><div className="now-value"><span className="num">68</span><span className="unit">kt</span></div><div className="now-sub">100mph gusts</div></div>
          <div className="now-stat"><div className="now-label">Sea state</div><div className="now-value"><span className="num">38</span><span className="unit">ft</span></div><div className="now-sub">seas</div></div>
          <div className="now-stat"><div className="now-label">Fetch</div><div className="now-value"><span className="num">1,240</span><span className="unit">nm</span></div><div className="now-sub">NW quadrant</div></div>
        </div>
        <div style={{ padding: 20 }}>
          <div className="eyebrow">Projected impact on your spots</div>
          <div className="storm-impact-list">
            <div className="storm-impact-row">
              <div className="mono-tiny">APR 22 06:00</div>
              <div>Mavericks</div>
              <div className="storm-impact fire">18–24ft @ 17s</div>
            </div>
            <div className="storm-impact-row">
              <div className="mono-tiny">APR 22 14:00</div>
              <div>Ocean Beach</div>
              <div className="storm-impact fire">10–14ft @ 16s</div>
            </div>
            <div className="storm-impact-row">
              <div className="mono-tiny">APR 22 20:00</div>
              <div>Rincon</div>
              <div className="storm-impact">4–6ft @ 15s</div>
            </div>
            <div className="storm-impact-row">
              <div className="mono-tiny">APR 23 02:00</div>
              <div>Lower Trestles</div>
              <div className="storm-impact">3–5ft @ 14s</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { OfflineBanner, ErrorBanner, MapLoadingOverlay, PanelSkeleton, EmptyFavorites, StormTrackerDetail });
