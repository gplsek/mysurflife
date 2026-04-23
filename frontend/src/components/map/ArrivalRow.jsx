import React from 'react';

const SCORE_COLORS = { 4: 'solid', 5: 'firing' };

export function ArrivalRow({ spot, highlight, stormId, regionId }) {
  const isHighlight = highlight === spot.id;
  const scoreColor  = SCORE_COLORS[spot.score] || 'default';

  const windSuffix =
    spot.wind_class === 'offshore' ? ' off' :
    spot.wind_class === 'onshore'  ? ' on'  : '';

  return (
    <div
      className={`spot-row${isHighlight ? ' highlight' : ''}`}
      data-score={spot.score}
    >
      {/* (a) Name + score bars */}
      <div className="spot-name-row">
        <span className="name">{spot.name}</span>
        <div
          className={`score score-${scoreColor}`}
          aria-label={`Score ${spot.score} of 5`}
        >
          {[1, 2, 3, 4, 5].map(i => (
            <span key={i} className={`bar${i <= spot.score ? ' filled' : ''}`} />
          ))}
        </div>
      </div>

      {/* (b) Swell stats */}
      <div className="swell-stats">
        <b>{spot.ft} ft</b>
        <span className="sep">·</span>
        <span>{spot.period}s period</span>
        <span className="sep">·</span>
        <span>from {spot.dir}</span>
      </div>

      {/* (c) When row */}
      <div className="when-row">
        <span>first <span className="v">{spot.first}</span></span>
        <span>peak <span className="v peak">{spot.peak}</span></span>
      </div>

      {/* (d) Wind / tide strip */}
      <div className="wind-tide-strip">
        <span className="wind-item">
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <path d="M5.5 1 L8.5 9 L5.5 6.5 L2.5 9 Z" fill="currentColor" opacity="0.65" />
          </svg>
          wind{' '}
          <span className={spot.wind_class || ''}>
            {spot.wind}{windSuffix}
          </span>
        </span>
        <span className="tide-item">
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <path
              d="M1.5 8.5 Q5.5 2 9.5 8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          tide{' '}
          <span className={spot.tide_class || ''}>{spot.tide}</span>
        </span>
      </div>

      {/* (e) CTA row */}
      <div className="ctas">
        <button
          className="spot-cta primary"
          onClick={() => {
            /* Phase 5: Scout handoff — POST /api/scout/sessions */
          }}
        >
          Plan trip with Sione
        </button>
        <a href={`/spots/${spot.id}`} className="spot-cta">
          Open spot
        </a>
        <button
          className="spot-cta"
          onClick={() => {
            /* Future: open Alerts form pre-filled */
          }}
        >
          Set alert
        </button>
      </div>
    </div>
  );
}
