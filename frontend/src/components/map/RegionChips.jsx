import React, { useState, useEffect, useRef } from 'react';
import { REGIONS } from './constants';

export function RegionChips({ activeRegion, onRegion, spots = [] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const barRef  = useRef(null);
  const rowRefs = useRef([]);

  // Close on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const handleOutside = (e) => {
      if (!barRef.current?.contains(e.target)) setMobileOpen(false);
    };
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, [mobileOpen]);

  // Close when viewport widens past breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const handler = (e) => { if (!e.matches) setMobileOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Focus first row when dropdown opens
  useEffect(() => {
    if (mobileOpen) {
      const activeIdx = REGIONS.findIndex(r => r.id === activeRegion);
      const focusIdx = activeIdx >= 0 ? activeIdx : 0;
      rowRefs.current[focusIdx]?.focus();
    }
  }, [mobileOpen, activeRegion]);

  const handleRowKeyDown = (e, index) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowRefs.current[(index + 1) % REGIONS.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rowRefs.current[(index - 1 + REGIONS.length) % REGIONS.length]?.focus();
    } else if (e.key === 'Escape') {
      setMobileOpen(false);
    }
  };

  const getCount = (region) => {
    if (region.id === 'all') return spots.length;
    if (!region.bbox) return 0;
    const [[s, w], [n, e]] = region.bbox;
    return spots.filter(sp => sp.latitude >= s && sp.latitude <= n && sp.longitude >= w && sp.longitude <= e).length;
  };

  const activeLabel = REGIONS.find(r => r.id === activeRegion)?.label || 'All regions';

  return (
    <div ref={barRef} className="mv-chips">
      {REGIONS.map(r => (
        <button
          key={r.id}
          className={`mv-chip mv-chip-desktop${activeRegion === r.id ? ' active' : ''}`}
          onClick={() => onRegion(r.id)}
        >
          {r.label}
          <span className="mv-chip-ct">{getCount(r)}</span>
        </button>
      ))}

      <button
        className="mv-chip active mv-chip-mobile-trigger"
        aria-haspopup="listbox"
        aria-expanded={mobileOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMobileOpen(o => !o);
        }}
      >
        {activeLabel} <span className="mv-chip-ct">{getCount(REGIONS.find(r => r.id === activeRegion) || REGIONS[0])}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10"
          fill="none" stroke="currentColor" strokeWidth="1.5"
          style={{ marginLeft: 4, transform: mobileOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
          aria-hidden="true"
        >
          <path d="M2 3.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {mobileOpen && (
        <div className="mv-chips-dropdown" role="listbox">
          {REGIONS.map((r, i) => (
            <button
              key={r.id}
              ref={el => rowRefs.current[i] = el}
              role="option"
              aria-selected={activeRegion === r.id}
              className={`mv-chips-dropdown-row${activeRegion === r.id ? ' active' : ''}`}
              onClick={() => { onRegion(r.id); setMobileOpen(false); }}
              onKeyDown={(e) => handleRowKeyDown(e, i)}
            >
              {r.label}
              <span className="mv-chip-ct">{getCount(r)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
