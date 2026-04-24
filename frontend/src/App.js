import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider } from './design/ThemeProvider';
import MapView from './pages/Map';
import MapOverlay from './MapOverlay';
import SpotDetail from './SpotDetail';
import ManagePersonas from './ManagePersonas';
import ManageUsers from './ManageUsers';
import ManageStorms from './ManageStorms';
import Dashboard from './screens/Dashboard';
import SessionJournal from './screens/SessionJournal';
import Alerts from './screens/Alerts';
import Copilot from './screens/Copilot';
import Home from './screens/Home';
import Logo from './design/Logo';
import LogoPulse from './design/LogoPulse';
import NavDrawer from './components/shell/NavDrawer';
import { useMapState } from './components/map/useMapState';
import './design/shell.css';

// ─── Nav icon helpers ──────────────────────────────────────────────
const MapIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="6" cy="6" r="5"/>
    <path d="M1 6h10M6 1c2 1.5 2 8 0 10M6 1c-2 1.5-2 8 0 10"/>
  </svg>
);
const DashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="1" y="1" width="4" height="5"/><rect x="7" y="1" width="4" height="3"/>
    <rect x="1" y="8" width="4" height="3"/><rect x="7" y="6" width="4" height="5"/>
  </svg>
);
const JournalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M2 2h8v8H2z"/><path d="M2 5h8M5 2v8"/>
  </svg>
);
const AlertsIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M2 5a4 4 0 018 0v3l1 2H1l1-2V5z"/>
    <path d="M4 10a2 2 0 004 0"/>
  </svg>
);
const CopilotIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M10 1H2a1 1 0 00-1 1v6a1 1 0 001 1h2l2 2 2-2h2a1 1 0 001-1V2a1 1 0 00-1-1z"/>
    <path d="M4 5h4M4 7h2" strokeLinecap="round"/>
  </svg>
);

// ─── Auth helpers ─────────────────────────────────────────────────
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg, oklch(0.16 0.018 230))' }}>
      <LogoPulse size={96} />
    </div>
  );
  if (!user) return <Navigate to="/" state={{ from: location }} replace />;
  return children;
}

// Root "/" — shows Home if unauthenticated, Shell (dashboard) if authenticated
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg, oklch(0.16 0.018 230))' }}>
      <LogoPulse size={96} />
    </div>
  );
  return user ? <Shell /> : <Home />;
}

// ─── Shell — map + topbar + all views ─────────────────────────────
function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef(null);
  const { state: mapState, stateRef: mapStateRef, toggleState: mapToggle, setRegion: mapSetRegion, setQuery: mapSetQuery } = useMapState();

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const view = pathname === '/map' ? 'map'
             : pathname === '/journal' ? 'journal'
             : pathname === '/alerts' ? 'alerts'
             : pathname === '/copilot' ? 'copilot'
             : 'dashboard';

  const navTo = (v) => navigate(v === 'dashboard' ? '/' : `/${v}`);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
  };

  React.useEffect(() => {
    const h = (e) => {
      if (menuOpen && !e.target.closest('.auth-menu-container')) setMenuOpen(false);
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [menuOpen]);

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '??';

  return (
    <div className="app">
      {/* ── Background screens ── */}
      {view === 'map' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <MapView
            state={mapState}
            stateRef={mapStateRef}
            toggleState={mapToggle}
            setRegion={mapSetRegion}
            setQuery={mapSetQuery}
          />
        </div>
      )}
      {view === 'dashboard' && <Dashboard onOpenMap={() => navTo('map')} />}
      {view === 'journal' && <SessionJournal />}
      {view === 'alerts' && <Alerts />}
      {view === 'copilot' && <Copilot />}

      {/* ── Floating topbar ── */}
      <div className="topbar">
        {/* Hamburger (mobile) */}
        <button
          className="hamburger-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Brand */}
        <div className="brand" onClick={() => navTo('dashboard')} style={{ cursor: 'pointer' }}>
          <Logo variant="mark" size={22} />
          <span className="brand-name">mysurf<span className="dim">life</span></span>
        </div>

        {/* Nav tabs */}
        <nav className="nav">
          <button className={view === 'map' ? 'active' : ''} onClick={() => navTo('map')}>
            <MapIcon /> Map
          </button>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => navTo('dashboard')}>
            <DashIcon /> Dashboard
          </button>
          <button className={view === 'journal' ? 'active' : ''} onClick={() => navTo('journal')}>
            <JournalIcon /> Journal
          </button>
          <button className={view === 'alerts' ? 'active' : ''} onClick={() => navTo('alerts')}>
            <AlertsIcon /> Alerts
          </button>
          <button className={view === 'copilot' ? 'active' : ''} onClick={() => navTo('copilot')}>
            <CopilotIcon /> Copilot
          </button>
        </nav>

        {/* Search */}
        <div className="search">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="5" cy="5" r="3.5"/><path d="M8 8l3 3"/>
          </svg>
          <input ref={searchRef} placeholder="Search spots, regions…" />
          <span className="mono-tiny" style={{ opacity: 0.5 }}>⌘K</span>
        </div>

        {/* Right side */}
        <div className="topbar-right">
          {user ? (
            <div className="auth-menu-container" style={{ position: 'relative' }}>
              <button
                className="avatar"
                onClick={() => setMenuOpen(m => !m)}
                title={user.email}
              >
                {initials}
              </button>

              {menuOpen && (
                <div className="auth-dropdown">
                  <div className="auth-dropdown-user">
                    <div className="auth-dropdown-role">
                      {isAdmin ? 'Admin' : 'Member'}
                    </div>
                    <div className="auth-dropdown-email">{user.email}</div>
                  </div>
                  <div className="auth-dropdown-items">
                    {isAdmin && (
                      <>
                        <Link
                          to="/admin/users"
                          className="auth-dropdown-link"
                          onClick={() => setMenuOpen(false)}
                        >
                          Manage Users
                        </Link>
                        <Link
                          to="/admin/personas"
                          className="auth-dropdown-link"
                          onClick={() => setMenuOpen(false)}
                        >
                          Manage AI Personas
                        </Link>
                        <Link
                          to="/admin/storms"
                          className="auth-dropdown-link"
                          onClick={() => setMenuOpen(false)}
                        >
                          Storm Filters
                        </Link>
                        <div className="auth-dropdown-divider" />
                      </>
                    )}
                    <button
                      className="auth-dropdown-btn auth-dropdown-signout"
                      onClick={handleSignOut}
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="icon-btn-lg"
              style={{ textDecoration: 'none', fontSize: 12, width: 'auto', padding: '0 12px', gap: 6, display: 'inline-flex', alignItems: 'center' }}
            >
              Login
            </Link>
          )}
        </div>
      </div>

      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        mapState={mapState}
        onMapToggle={mapToggle}
      />
    </div>
  );
}

// ─── Root app with routing ─────────────────────────────────────────
const DevPrimitives = process.env.NODE_ENV !== 'production'
  ? React.lazy(() => import('./screens/DevPrimitives'))
  : null;

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            {/* Root: Home if logged out, Shell (dashboard) if logged in */}
            <Route path="/" element={<RootRoute />} />

            {/* Protected shell routes */}
            <Route path="/map"      element={<RequireAuth><Shell /></RequireAuth>} />
            <Route path="/journal"  element={<RequireAuth><Shell /></RequireAuth>} />
            <Route path="/alerts"   element={<RequireAuth><Shell /></RequireAuth>} />
            <Route path="/copilot"  element={<RequireAuth><Shell /></RequireAuth>} />

            {/* Old map — available until Phase 5 ships */}
            <Route path="/old-map" element={<RequireAuth><MapOverlay /></RequireAuth>} />

            {/* Spot detail — auth required */}
            <Route path="/spots/:slug" element={<RequireAuth><SpotDetail /></RequireAuth>} />

            {/* Admin — protected */}
            <Route path="/admin/users"    element={<RequireAuth><ManageUsers /></RequireAuth>} />
            <Route path="/admin/personas" element={<RequireAuth><ManagePersonas /></RequireAuth>} />
            <Route path="/admin/storms"   element={<RequireAuth><ManageStorms /></RequireAuth>} />

            {/* /login → home (auth card is on the homepage) */}
            <Route path="/login" element={<Navigate to="/" replace />} />

            {/* Dev harness — not available in production */}
            {process.env.NODE_ENV !== 'production' && DevPrimitives && (
              <Route path="/dev/primitives" element={
                <React.Suspense fallback={null}><DevPrimitives /></React.Suspense>
              } />
            )}
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
