import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import MapOverlay from './MapOverlay';
import SpotDetail from './SpotDetail';
import Login from './Login';
import ManagePersonas from './ManagePersonas';

function AppHeader({ view, setView }) {
  const { user, isAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const handleSignOut = async () => {
    console.log('🔘 Sign out button clicked');
    setMenuOpen(false);
    await signOut();
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuOpen && !e.target.closest('.admin-menu-container')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpen]);

  return (
    <header
      style={{
        textAlign: 'center',
        padding: '1rem',
        backgroundColor: '#0066cc',
        color: 'white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        zIndex: 1001,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>🏄 mysurflife</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', position: 'relative' }}>
          {user ? (
            <div className="admin-menu-container" style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                style={{
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.5)',
                  background: menuOpen ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s',
                }}
              >
                {isAdmin && <span>👑</span>}
                <span style={{ fontSize: '1rem' }}>☰</span>
              </button>

              {menuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '0.5rem',
                    background: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    minWidth: '220px',
                    overflow: 'hidden',
                    zIndex: 1000,
                  }}
                >
                  {/* User Info */}
                  <div
                    style={{
                      padding: '1rem',
                      borderBottom: '1px solid #e5e7eb',
                      background: '#f9fafb',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                      {isAdmin ? 'Admin User' : 'Signed in as'}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#1f2937', fontWeight: 600 }}>
                      {user.email}
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div style={{ padding: '0.5rem 0' }}>
                    {isAdmin && (
                      <>
                        <Link
                          to="/admin/personas"
                          onClick={() => setMenuOpen(false)}
                          style={{
                            display: 'block',
                            padding: '0.75rem 1rem',
                            color: '#374151',
                            textDecoration: 'none',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => e.target.style.background = '#f3f4f6'}
                          onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                          🤖 Manage AI Personas
                        </Link>
                        <Link
                          to="/"
                          onClick={() => setMenuOpen(false)}
                          style={{
                            display: 'block',
                            padding: '0.75rem 1rem',
                            color: '#374151',
                            textDecoration: 'none',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => e.target.style.background = '#f3f4f6'}
                          onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                          🗺️ View All Spots
                        </Link>
                        <div
                          style={{
                            height: '1px',
                            background: '#e5e7eb',
                            margin: '0.5rem 0',
                          }}
                        />
                      </>
                    )}

                    <button
                      onClick={handleSignOut}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.75rem 1rem',
                        border: 'none',
                        background: 'transparent',
                        color: '#dc2626',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.target.style.background = '#fef2f2'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      🚪 Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.12)',
                color: 'white',
                textDecoration: 'none',
                fontSize: '0.85rem',
              }}
            >
              Admin Login
            </Link>
          )}
        </div>
      </div>

      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
        <button
          onClick={() => setView('buoys')}
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.5)',
            background: view === 'buoys' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Live Buoys
        </button>

        <button
          onClick={() => setView('wind')}
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid rgba(255,255,255,0.5)',
            background: view === 'wind' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Global Wind
        </button>
      </div>

      <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', opacity: 0.9 }}>
        {view === 'buoys'
          ? 'Live buoy observations'
          : 'GFS 0.25° wind vectors (NOAA/NOMADS) — use map pan/zoom in the next step'}
      </div>
    </header>
  );
}

function App() {
  const [view, setView] = useState('buoys'); // 'buoys' | 'wind'

  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Main Map View */}
          <Route
            path="/"
            element={
            <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
              <AppHeader view={view} setView={setView} />
              <MapOverlay mode={view} />
            </div>
          }
        />

        {/* Spot Detail Page */}
        <Route path="/spots/:slug" element={<SpotDetail />} />

        {/* Admin Pages */}
        <Route path="/admin/personas" element={<ManagePersonas />} />

        {/* Login Page */}
        <Route path="/login" element={<Login />} />
      </Routes>
    </Router>
    </AuthProvider>
  );
}

export default App;