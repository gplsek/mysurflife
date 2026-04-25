import React, { useState, useEffect } from 'react';
import LogoPulse from '../../design/LogoPulse';

export function StatusBar({ loading, inViewCount, totalCount, updatedAt, timelineOpen }) {
  const [ago, setAgo] = useState('');

  useEffect(() => {
    if (!updatedAt) return;
    const tick = () => {
      const diff = Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000);
      setAgo(diff < 1 ? 'just now' : `${diff}m ago`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [updatedAt]);

  return (
    <div className={`mv-statusbar${timelineOpen ? ' tl-open' : ''}`}>
      <div className="mv-status-left">
        <span className="mv-live-dot" />
        <span>Live</span>
        {updatedAt && ago && <span className="mv-status-ago">· {ago}</span>}
        {loading && <LogoPulse size={12} compact className="mv-status-pulse" />}
      </div>
      <div className="mv-status-right">
        <span>{inViewCount} in view</span>
        <span className="mv-status-sep">·</span>
        <span>{totalCount} total</span>
      </div>
    </div>
  );
}
