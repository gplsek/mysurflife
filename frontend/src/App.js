import React from 'react';
import MapOverlay from './MapOverlay';

function App() {
  return (
    <div className="App" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ 
        textAlign: 'center', 
        padding: '1rem',
        backgroundColor: '#0066cc',
        color: 'white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        zIndex: 1001
      }}>
        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>
          🏄 mysurflife: Live Buoy Tracker
        </h1>
      </header>
      <MapOverlay />
    </div>
  );
}

export default App;