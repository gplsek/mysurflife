import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ratingTier, ratingColor } from './markers';

export function PreviewCard({ preview, isFav, onToggleFav, onClose }) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (!preview?.slug) {
      setLive(null);
      return;
    }
    setLive(null);
    let cancelled = false;
    (async () => {
      const { getAuthHeaders } = await import('../../supabaseClient');
      const headers = await getAuthHeaders();
      fetch(`/api/surf-spots/${preview.slug}/conditions`, { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (!cancelled && data && !data.error) setLive(data); })
        .catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [preview?.slug]);

  // Live conditions overlay bundle values (bundle may be null for un-rated spots)
  const wind   = live?.wind_speed_mph                           ?? preview?.wind;
  const swell  = live?.surf_height_ft ?? live?.adjusted_height_ft ?? preview?.swell;
  const period = live?.period_sec                               ?? preview?.period;
  const water  = live?.water_temp_c != null
    ? Math.round(live.water_temp_c * 9 / 5 + 32)
    : preview?.water;

  return (
    <div className={`mv-preview${preview ? ' show' : ''}`}>
      {preview && (
        <>
          <div className="mv-prev-head">
            <div>
              <div className="mv-prev-name">{preview.name}</div>
              <div className="mv-prev-region">{preview.region}</div>
            </div>
            <div className="mv-prev-actions">
              <button
                className={`mv-prev-fav${isFav ? ' active' : ''}`}
                onClick={() => onToggleFav?.(preview.slug)}
                aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4">
                  <path d="M8 13.5C8 13.5 2 9.5 2 5.5C2 3.6 3.6 2 5.5 2C6.6 2 7.5 2.6 8 3.4C8.5 2.6 9.4 2 10.5 2C12.4 2 14 3.6 14 5.5C14 9.5 8 13.5 8 13.5Z" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="mv-prev-close" onClick={onClose} aria-label="Close">×</button>
            </div>
          </div>
          {(() => {
            // preview.rating is on 0-5 (cached); live.overall_score is 0-10.
            const score10 = live?.overall_score ?? (preview.rating != null ? preview.rating * 2 : null);
            return (
              <div className="mv-prev-rating">
                <span
                  className="mv-prev-pill"
                  style={{ background: ratingColor(score10) }}
                  aria-label={`Score ${score10 != null ? score10.toFixed(1) : 'unknown'} out of 10`}
                />
                <span>
                  <strong style={{ fontSize: '1.05em' }}>{score10 != null ? score10.toFixed(1) : '—'}</strong>
                  <span style={{ opacity: 0.6 }}> / 10</span>
                  {swell != null ? ` · ${swell.toFixed(1)}ft primary swell` : ''}
                </span>
              </div>
            );
          })()}
          <div className="mv-prev-metrics">
            <div>
              <span>Swell</span>
              <strong>{swell != null ? swell.toFixed(1) : '—'}</strong>
              <span>ft</span>
            </div>
            <div>
              <span>Period</span>
              <strong>{period ?? '—'}</strong>
              <span>s</span>
            </div>
            <div>
              <span>Wind</span>
              <strong>{wind != null ? Math.round(wind) : '—'}</strong>
              <span>mph</span>
            </div>
            <div>
              <span>Water</span>
              <strong>{water ?? '—'}</strong>
              <span>°F</span>
            </div>
          </div>
          {preview.slug && (
            <Link to={`/spots/${preview.slug}`} className="mv-prev-open">
              Open spot →
            </Link>
          )}
        </>
      )}
    </div>
  );
}
