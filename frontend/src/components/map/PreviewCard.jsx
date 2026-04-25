import React from 'react';
import { Link } from 'react-router-dom';
import { ratingTier, ratingColor } from './markers';
import { TIER_LABELS } from './constants';

export function PreviewCard({ preview, isFav, onToggleFav, onClose }) {
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
          <div className="mv-prev-rating">
            <span
              className="mv-prev-pill"
              style={{ background: ratingColor(preview.rating) }}
            >
              {TIER_LABELS[ratingTier(preview.rating)]}
            </span>
            <span>
              {preview.rating != null ? preview.rating.toFixed(1) : '—'} / 5.0
              {preview.swell != null ? ` · ${preview.swell.toFixed(1)}ft primary swell` : ''}
            </span>
          </div>
          <div className="mv-prev-metrics">
            <div>
              <span>Swell</span>
              <strong>{preview.swell != null ? preview.swell.toFixed(1) : '—'}</strong>
              <span>ft</span>
            </div>
            <div>
              <span>Period</span>
              <strong>{preview.period ?? '—'}</strong>
              <span>s</span>
            </div>
            <div>
              <span>Wind</span>
              <strong>{preview.wind != null ? Math.round(preview.wind) : '—'}</strong>
              <span>mph</span>
            </div>
            <div>
              <span>Water</span>
              <strong>{preview.water ?? '—'}</strong>
              <span>°F</span>
            </div>
          </div>
          {!preview.is_user_spot && preview.slug && (
            <Link to={`/spots/${preview.slug}`} className="mv-prev-open">
              Open spot →
            </Link>
          )}
        </>
      )}
    </div>
  );
}
