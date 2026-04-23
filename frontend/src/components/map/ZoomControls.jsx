import React, { useRef, useState } from 'react';
import L from 'leaflet';

export function ZoomControls({ mapRef, addSpotMode, onAddSpotToggle }) {
  const [locating, setLocating]   = useState(false);
  const youAreHereRef             = useRef(null);

  const handleLocate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        const map = mapRef.current;
        if (!map) { setLocating(false); return; }

        // Remove previous marker
        if (youAreHereRef.current) {
          map.removeLayer(youAreHereRef.current);
          youAreHereRef.current = null;
        }

        // Drop "you are here" marker
        const icon = L.divIcon({
          html: '<div class="mv-you-here"><div class="mv-yh-ring"></div><div class="mv-yh-dot"></div></div>',
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const marker = L.marker([lat, lng], { icon }).addTo(map);
        youAreHereRef.current = marker;

        map.flyTo([lat, lng], 10, { duration: 1.4 });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="mv-zoom-ctrl">
      <button aria-label="Zoom in"  onClick={() => mapRef.current?.zoomIn()}>+</button>
      <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
      <div className="mv-zoom-sep" />
      <button
        className={locating ? 'locating' : ''}
        aria-label="Show my location"
        onClick={handleLocate}
        disabled={locating}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="7" cy="7" r="3"/>
          <path d="M7 1v2M7 11v2M1 7h2M11 7h2"/>
        </svg>
      </button>
      {onAddSpotToggle && (
        <>
          <div className="mv-zoom-sep" />
          <button
            className={addSpotMode ? 'active' : ''}
            aria-label="Add my spot"
            onClick={onAddSpotToggle}
            title="Pin your own spot"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="6" r="3.5"/>
              <path d="M7 9.5v3M5 12h4"/>
              <path d="M10.5 3.5 L12 2" strokeWidth="1.2"/>
              <circle cx="12.5" cy="1.5" r="1" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
