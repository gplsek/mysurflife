import React from 'react';
import { TIER_COLORS, TIER_LABELS, TIER_LEGEND } from './constants';

const STRENGTH_OPTS = [
  { k: 'all',       label: 'All' },
  { k: 'gale',      label: 'Gale 34+' },
  { k: 'storm',     label: 'Storm 48+' },
  { k: 'hurricane', label: 'Hurr 64+' },
];

export function LeftRail({ tierCounts, buoyCount, stormCount, state, onToggle, onStormStrength, loading }) {
  return (
    <div className="mv-rail">
      <div className="mv-rail-card">
        <div className="mv-rail-head">Markers</div>
        {TIER_LEGEND.map(({ tier, range }) => (
          <div key={tier} className="mv-legend-row">
            <span className="mv-legend-dot" style={{ borderColor: TIER_COLORS[tier] }} />
            <span className="mv-legend-label">{TIER_LABELS[tier]}</span>
            <span className="mv-legend-range">{range}</span>
            <span className="mv-legend-count">{loading ? '—' : (tierCounts[tier] ?? 0)}</span>
          </div>
        ))}
        <div className="mv-rail-sep" />
        <div className="mv-legend-row">
          <span className="mv-buoy-swatch" />
          <span className="mv-legend-label">NOAA Buoys</span>
          <span className="mv-legend-count">{buoyCount}</span>
        </div>
        <div className="mv-legend-row">
          <span className="mv-storm-swatch" />
          <span className="mv-legend-label">Active storms</span>
          <span className={`mv-legend-count${stormCount === 0 ? ' mv-legend-muted' : ''}`}>
            {stormCount}
          </span>
        </div>
      </div>

      <div className="mv-rail-card">
        <div className="mv-rail-head">Layers</div>
        <button
          className={`mv-layer-btn${state.showSpots ? ' on' : ''}`}
          onClick={() => onToggle('showSpots')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2 9 Q4.5 5 6.5 7 Q8.5 9 11 5" strokeLinecap="round"/>
            <circle cx="6.5" cy="7" r="1.5" fill="currentColor" stroke="none"/>
          </svg>
          Surf spots
          <span className="mv-toggle-pip" />
        </button>
        <button
          className={`mv-layer-btn${state.showBuoys ? ' on' : ''}`}
          onClick={() => onToggle('showBuoys')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="6.5" cy="6.5" r="2.5"/>
            <path d="M6.5 1v1.5M6.5 10v1.5M1 6.5h1.5M10 6.5h1.5" strokeLinecap="round"/>
          </svg>
          Buoys
          <span className="mv-toggle-pip" />
        </button>
        <button
          className={`mv-layer-btn${state.showStorms ? ' on' : ''}`}
          onClick={() => onToggle('showStorms')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="6.5" cy="6.5" r="2.5"/>
            <path d="M6.5 4v1M6.5 8v1M4 6.5H3M9 6.5h1" strokeLinecap="round"/>
            <path d="M4.9 4.9l-.7-.7M8.8 8.8l-.7-.7M8.8 4.2l.7-.7M4.2 8.8l-.7.7" strokeLinecap="round"/>
          </svg>
          Storms
          <span className="mv-toggle-pip" />
        </button>
        {state.showStorms && onStormStrength && (
          <div className="mv-strength" role="group" aria-label="Filter storms by strength">
            {STRENGTH_OPTS.map(opt => (
              <button
                key={opt.k}
                className={`mv-strength-btn${(state.stormStrength || 'all') === opt.k ? ' on' : ''}`}
                onClick={() => onStormStrength(opt.k)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        <button
          className={`mv-layer-btn${state.favsOnly ? ' on' : ''}`}
          onClick={() => onToggle('favsOnly')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill={state.favsOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3">
            <path d="M6.5 11C6.5 11 1.5 7.5 1.5 4.5C1.5 3 2.7 2 4 2C5 2 5.8 2.6 6.5 3.4C7.2 2.6 8 2 9 2C10.3 2 11.5 3 11.5 4.5C11.5 7.5 6.5 11 6.5 11Z" strokeLinejoin="round"/>
          </svg>
          Favorites
          <span className="mv-toggle-pip" />
        </button>
      </div>
    </div>
  );
}
