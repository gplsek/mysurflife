import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../../design/Logo';
import { TIER_LEGEND, TIER_LABELS, TIER_COLORS } from '../../components/map/constants';

const NAV_ITEMS = [
  {
    id: 'map', path: '/map', label: 'Map',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="7" cy="7" r="6"/><path d="M1 7h12M7 1c2 2 2 8 0 12M7 1c-2 2-2 8 0 12"/></svg>,
  },
  {
    id: 'dashboard', path: '/', label: 'Dashboard',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="1" width="5" height="6"/><rect x="8" y="1" width="5" height="4"/><rect x="1" y="9" width="5" height="4"/><rect x="8" y="7" width="5" height="6"/></svg>,
  },
  {
    id: 'journal', path: '/journal', label: 'Journal',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="2" width="10" height="10" rx="1"/><path d="M2 6h10M6 2v10"/></svg>,
  },
  {
    id: 'alerts', path: '/alerts', label: 'Alerts',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 6a5 5 0 0110 0v3l1 2H1l1-2V6z"/><path d="M5 11a2 2 0 004 0"/></svg>,
  },
  {
    id: 'sione', path: '/sione', label: 'Sione',
    icon: <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M12 1H2a1 1 0 00-1 1v7a1 1 0 001 1h2l3 3 3-3h2a1 1 0 001-1V2a1 1 0 00-1-1z"/><path d="M4 6h6M4 8h3"/></svg>,
  },
];

const LAYER_TOGGLES = [
  {
    key: 'showSpots', label: 'Surf spots',
    icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M2 9 Q4.5 5 6.5 7 Q8.5 9 11 5" strokeLinecap="round"/><circle cx="6.5" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>,
  },
  {
    key: 'showBuoys', label: 'Buoys',
    icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="6.5" cy="6.5" r="2.5"/><path d="M6.5 1v1.5M6.5 10v1.5M1 6.5h1.5M10 6.5h1.5" strokeLinecap="round"/></svg>,
  },
  {
    key: 'showStorms', label: 'Storms',
    icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="6.5" cy="6.5" r="2.5"/><path d="M6.5 4v1M6.5 8v1M4 6.5H3M9 6.5h1" strokeLinecap="round"/><path d="M4.9 4.9l-.7-.7M8.8 8.8l-.7-.7M8.8 4.2l.7-.7M4.2 8.8l-.7.7" strokeLinecap="round"/></svg>,
  },
  {
    key: 'favsOnly', label: 'Favorites only',
    icon: null, // rendered dynamically below
  },
];

export default function NavDrawer({ open, onClose, view, mapState, onMapToggle }) {
  const navigate = useNavigate();
  const drawerRef = useRef(null);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    const getFocusable = () => Array.from(
      drawer.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')
    );

    // Auto-focus first element
    const focusable = getFocusable();
    if (focusable.length) focusable[0].focus();

    const trapFocus = (e) => {
      if (e.key !== 'Tab') return;
      const els = getFocusable();
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [open]);

  const handleNav = (path) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      <div
        className={`nav-drawer-backdrop${open ? ' show' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className={`nav-drawer${open ? ' open' : ''}`}
        aria-hidden={!open}
        aria-label="Navigation menu"
      >
        <div className="nav-drawer-head">
          <Logo variant="mark" size={22} />
          <span className="brand-name">mysurf<span className="dim">life</span></span>
          <button className="nav-drawer-close icon-btn" onClick={onClose} aria-label="Close menu">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l8 8M10 2l-8 8"/>
            </svg>
          </button>
        </div>

        <nav className="nav-drawer-nav" role="navigation">
          {NAV_ITEMS.map(({ id, path, label, icon }) => (
            <button
              key={id}
              className={`nav-drawer-nav-item${view === id ? ' active' : ''}`}
              onClick={() => handleNav(path)}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {view === 'map' && (
          <div className="nav-drawer-section">
            <div className="nav-drawer-section-head">Markers</div>
            {TIER_LEGEND.map(({ tier, range }) => (
              <div key={tier} className="nav-drawer-legend-row">
                <span className="nav-drawer-legend-dot" style={{ background: TIER_COLORS[tier] }} />
                <span className="nav-drawer-legend-label">{TIER_LABELS[tier]}</span>
              </div>
            ))}
            <div className="nav-drawer-legend-sep" />
            <div className="nav-drawer-legend-row">
              <span className="nav-drawer-buoy-swatch" />
              <span className="nav-drawer-legend-label">NOAA Buoys</span>
            </div>
          </div>
        )}

        {view === 'map' && mapState && onMapToggle && (
          <div className="nav-drawer-section">
            <div className="nav-drawer-section-head">Layers</div>
            {LAYER_TOGGLES.map(({ key, label, icon }) => {
              const on = mapState[key];
              const renderIcon = key === 'favsOnly'
                ? <svg width="13" height="13" viewBox="0 0 13 13" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3"><path d="M6.5 11C6.5 11 1.5 7.5 1.5 4.5C1.5 3 2.7 2 4 2C5 2 5.8 2.6 6.5 3.4C7.2 2.6 8 2 9 2C10.3 2 11.5 3 11.5 4.5C11.5 7.5 6.5 11 6.5 11Z" strokeLinejoin="round"/></svg>
                : icon;
              return (
                <button
                  key={key}
                  className="nav-drawer-layer-row"
                  onClick={() => onMapToggle(key)}
                >
                  {renderIcon}
                  <span className="nav-drawer-layer-label">{label}</span>
                  <span className={`nav-drawer-toggle${on ? ' on' : ''}`}>
                    <span className="nav-drawer-toggle-knob" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </aside>
    </>
  );
}
