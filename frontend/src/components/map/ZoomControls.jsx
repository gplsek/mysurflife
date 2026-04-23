import React from 'react';

export function ZoomControls({ mapRef }) {
  return (
    <div className="mv-zoom-ctrl">
      <button aria-label="Zoom in"  onClick={() => mapRef.current?.zoomIn()}>+</button>
      <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
    </div>
  );
}
