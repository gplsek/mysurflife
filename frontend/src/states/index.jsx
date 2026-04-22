import React from 'react';
import LogoPulse from '../design/LogoPulse';

export function OfflineBanner({ show, lastSync }) {
  if (!show) return null;
  return (
    <div className="state-banner offline">
      <div className="banner-dot" />
      <div>
        <strong>You're offline.</strong>{' '}
        Showing last synced forecast
        {lastSync && <span className="mono-tiny"> from {lastSync}.</span>}
      </div>
      <button className="banner-action" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );
}

export function ErrorBanner({ show, message, onDismiss }) {
  if (!show) return null;
  return (
    <div className="state-banner error">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
        <circle cx="7" cy="7" r="6"/>
        <path d="M7 4v3M7 9.5v.5"/>
      </svg>
      <div>
        {message || (
          <>
            <strong>Forecast model delayed.</strong> NOAA WW3 run failed — using the prior run. AI confidence reduced.
          </>
        )}
      </div>
      {onDismiss && <button className="banner-action" onClick={onDismiss}>Dismiss</button>}
    </div>
  );
}

export function MapLoadingOverlay({ show }) {
  if (!show) return null;
  return (
    <div className="map-loading">
      <LogoPulse size={56} />
      <div className="mono-tiny" style={{ marginTop: 4 }}>Fetching forecast · NOAA WW3 · GFS 0.25° · tide stations</div>
      <div className="loading-bars">
        <div><span>Storm tracking</span><span className="mono-tiny">done</span></div>
        <div><span>Wave model</span><span className="mono-tiny loading">loading…</span></div>
        <div className="pending"><span>Personal AI model</span><span className="mono-tiny">queued</span></div>
      </div>
    </div>
  );
}

export function PanelSkeleton() {
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
      <div style={{ padding: '20px' }}>
        <div className="sk sk-chart" />
        <div className="sk sk-line" style={{ width: '100%', marginTop: 16 }} />
        <div className="sk sk-line" style={{ width: '80%' }} />
        <div className="sk sk-line" style={{ width: '60%' }} />
      </div>
    </div>
  );
}

export function EmptyFavorites({ onAdd }) {
  return (
    <div className="empty-favs">
      <div className="empty-illustration">
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none">
          <path d="M4 50 Q30 30 60 50 T116 50" stroke="currentColor" strokeWidth="1.2" opacity="0.4"/>
          <path d="M4 58 Q30 38 60 58 T116 58" stroke="currentColor" strokeWidth="1.2" opacity="0.25"/>
          <path d="M4 66 Q30 46 60 66 T116 66" stroke="currentColor" strokeWidth="1.2" opacity="0.15"/>
          <circle cx="60" cy="20" r="4" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6"/>
          <path d="M60 28v10" stroke="currentColor" strokeWidth="1" opacity="0.4" strokeDasharray="2 2"/>
        </svg>
      </div>
      <div className="empty-title">No favorited spots yet.</div>
      <div className="empty-body">
        Tap the star on any spot to add it here. The AI learns faster with more spots to compare —{' '}
        <span className="mono-tiny">aim for 3–5</span>.
      </div>
      <button className="btn-primary" onClick={onAdd}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        Browse map
      </button>
    </div>
  );
}
