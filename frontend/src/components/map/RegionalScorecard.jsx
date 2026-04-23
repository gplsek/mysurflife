import React from 'react';
import LogoPulse from '../../design/LogoPulse';

function tierFromPeak(peakFt) {
  if (peakFt >= 10) return 'firing';
  if (peakFt >= 8)  return 'solid';
  if (peakFt >= 6)  return 'good';
  if (peakFt >= 4)  return 'fair';
  return 'flat';
}

export function RegionalScorecard({
  arrivals,
  status,
  sort,
  onSortChange,
  onRetry,
  selectedRegion,
  onSelectRegion,
}) {
  function renderRows() {
    if (status === 'loading') {
      return (
        <div className="l2-loading">
          <LogoPulse size={24} compact />
          <p>Computing arrivals…</p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="l2-empty">
          <div className="l2-empty-title">Can't compute arrivals right now</div>
          <div className="l2-empty-sub">Try again in a moment.</div>
          <button className="l2-retry" onClick={onRetry}>Retry</button>
        </div>
      );
    }

    if (!arrivals || arrivals.length === 0) {
      return (
        <div className="l2-empty">
          <div className="l2-empty-title">
            This storm isn't projected to deliver significant surf
          </div>
          <div className="l2-empty-sub">
            Below our 3 ft threshold across every sub-region. Either the fetch is too
            narrow, the storm is too weak, or the geometry points away from any coast.
          </div>
        </div>
      );
    }

    const sorted = [...arrivals].sort((a, b) => {
      if (sort === 'size') return b.peak_ft - a.peak_ft;
      return (a.peak_when || '').localeCompare(b.peak_when || '');
    });

    return sorted.map(arrival => {
      const tier = arrival.tier || tierFromPeak(arrival.peak_ft);
      const isOn = selectedRegion === arrival.region_id;
      return (
        <div
          key={arrival.region_id}
          className={`l2-row${isOn ? ' on' : ''}`}
          data-tier={tier}
          role="button"
          aria-pressed={isOn}
          aria-expanded={isOn}
          tabIndex={0}
          onClick={() => onSelectRegion(isOn ? null : arrival.region_id)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectRegion(isOn ? null : arrival.region_id);
            }
          }}
        >
          <div className="l2-tier-strip" />
          <div className="l2-main">
            <div className="l2-name-row">
              <span className="name">{arrival.name}</span>
              {arrival.parent && <span className="flag">{arrival.parent}</span>}
            </div>
            <div className="meta">
              first <b>{arrival.peak_when}</b>
              {' · '}
              <b>{arrival.window_h}h</b> window
            </div>
          </div>
          <div className="l2-peak">
            <div className="size">
              {arrival.peak_ft}<span className="u">ft</span>
            </div>
            <div className="when">
              peak <span className="hi">{arrival.peak_when}</span>
            </div>
          </div>
        </div>
      );
    });
  }

  return (
    <div className="l2-section">
      <div className="l2-head">
        <div className="l2-title">
          <span className="l2-title-mono">Reachable surf</span>
          <span className="l2-title-serif"> — where it lands</span>
        </div>
        <div className="sort-toggle">
          <button
            className={sort === 'size' ? 'on' : ''}
            onClick={() => onSortChange('size')}
          >
            Size
          </button>
          <button
            className={sort === 'arrival' ? 'on' : ''}
            onClick={() => onSortChange('arrival')}
          >
            Arrival
          </button>
        </div>
      </div>
      <div className="l2-rows">{renderRows()}</div>
    </div>
  );
}
