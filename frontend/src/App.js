import React, { useState } from 'react';
import MapOverlay from './MapOverlay';

function App() {
  const [view, setView] = useState('buoys'); // 'buoys' | 'wind'

  return (
    <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
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
        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>🏄 mysurflife</h1>

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

      {/*
        MapOverlay currently renders the existing buoy UI.
        Next step: update MapOverlay to accept `mode="wind"` and call `/api/wind-overlay`
        using the current map bounds + forecast_hour.
      */}
      <MapOverlay mode={view} />
    </div>
  );
}

export default App;