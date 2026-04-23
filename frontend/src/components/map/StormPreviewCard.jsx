import React from 'react';

const TIER_INFO = {
  gale:      { label: 'Gale Force',      bg: 'oklch(0.82 0.14 85)',  btnBg: 'oklch(0.82 0.14 85)' },
  storm:     { label: 'Storm Force',     bg: 'oklch(0.72 0.16 30)',  btnBg: 'oklch(0.72 0.16 20)' },
  hurricane: { label: 'Hurricane Force', bg: 'oklch(0.65 0.22 25)',  btnBg: 'oklch(0.62 0.22 22)' },
};

export function StormPreviewCard({ storm, onClose, onOpenDetail }) {
  const tier     = storm.warning_tier || 'none';
  const tierInfo = TIER_INFO[tier];
  const fetchNm  = storm.fetch?.radius_nm;
  const fetchTag = fetchNm
    ? `${fetchNm} nm ${storm.fetch.quadrant || 'fetch'}`
    : null;

  const btnBg    = tierInfo?.btnBg || 'var(--accent)';
  const name     = storm.label || storm.name || '—';
  const region   = storm.ocean
    ? storm.ocean.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : '';

  return (
    <div className="mv-storm-preview">
      <div className="mv-storm-preview-head">
        <div className="mv-storm-preview-title-block">
          <span className="mv-storm-preview-name" style={{ color: tierInfo ? 'oklch(0.94 0.03 25)' : 'var(--fg)' }}>
            {name}
          </span>
          {region && <span className="mv-storm-preview-region">{region}</span>}
        </div>
        <button className="mv-prev-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {tierInfo && (
        <div className="mv-storm-preview-strip">
          <span className="mv-storm-preview-pill" style={{ background: tierInfo.bg }}>
            {tierInfo.label}
          </span>
          {fetchTag && <span className="mv-storm-preview-tag">{fetchTag}</span>}
        </div>
      )}

      <div className="mv-storm-preview-metrics">
        <div className="m">
          <div className="k">Pressure</div>
          <div className="v">{storm.pressure_mb ?? '—'}<span className="u">mb</span></div>
        </div>
        <div className="m">
          <div className="k">Max winds</div>
          <div className="v">{storm.wind_kts ?? '—'}<span className="u">kt</span></div>
        </div>
        <div className="m">
          <div className="k">Max seas</div>
          <div className="v">{storm.sea_height_ft ?? '—'}<span className="u">ft</span></div>
        </div>
        <div className="m">
          <div className="k">Fetch</div>
          <div className="v">{fetchNm ? `${fetchNm} nm` : '—'}</div>
        </div>
      </div>

      <button
        className="mv-storm-preview-open"
        style={{ background: btnBg, color: 'oklch(0.98 0.01 230)' }}
        onClick={onOpenDetail}
      >
        See storm detail →
      </button>
    </div>
  );
}
