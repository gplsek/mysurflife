import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { EmptyFavorites } from '../states/index.jsx';
import LogoPulse from '../design/LogoPulse';

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onChange} aria-pressed={on}>
      <span className="toggle-knob" />
    </button>
  );
}

export default function Dashboard({ onOpenMap }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [favs, setFavs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ sessions: 0, hours: 0, avgRating: null });
  const [stormOpen, setStormOpen] = useState(false);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        // TODO: wire to real /api/dashboard/{user_id} endpoint
        // For now use buoy status as proxy for "data is live"
        await fetch('/api/buoy-status/all').then(r => r.json());
      } catch (_) {
        // silently degrade
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (loading) {
    return (
      <div className="screen dashboard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogoPulse size={56} />
      </div>
    );
  }

  return (
    <div className="screen dashboard">
      <div className="screen-head">
        <div>
          <div className="eyebrow">{greeting} · {dateStr}</div>
          <h1 className="screen-title">
            Check the map for today's{' '}
            <span className="text-fire">conditions.</span>
          </h1>
          <div className="screen-sub">
            {user
              ? `Signed in as ${user.email} · real-time buoy data from 18 California stations`
              : 'Real-time buoy data from 18 California stations'}
          </div>
        </div>
        {stats.sessions > 0 && (
          <div className="screen-meta">
            <div className="meta-stat">
              <span className="num">{stats.sessions}</span>
              <span className="lbl">sessions YTD</span>
            </div>
            {stats.avgRating && (
              <div className="meta-stat">
                <span className="num">{stats.avgRating.toFixed(1)}</span>
                <span className="lbl">avg rating</span>
              </div>
            )}
            <div className="meta-stat">
              <span className="num">{stats.hours}<span style={{ fontSize: 14, color: 'var(--muted)' }}>h</span></span>
              <span className="lbl">in the water</span>
            </div>
          </div>
        )}
      </div>

      {/* Favorites grid — empty state until wired */}
      <div className="favs-grid">
        <div style={{ gridColumn: '1 / -1' }}>
          <EmptyFavorites onAdd={() => navigate('/map')} />
        </div>
      </div>

      {/* Quick access row */}
      <div className="dash-row">
        <div className="dash-card wide">
          <div className="card-head">
            <div className="eyebrow">Live Buoys</div>
            <button
              className="btn-ghost"
              onClick={() => navigate('/map')}
              style={{ fontSize: 12 }}
            >
              Open map →
            </button>
          </div>
          <div style={{ color: 'var(--fg-2)', fontSize: 13, lineHeight: 1.6 }}>
            18 NDBC stations along the California coast — Del Mar, Mission Bay,
            Point Loma, Santa Monica, Point Dume, Santa Maria, Monterey, Bodega Bay, and more.
            Observations update every 30–60 minutes.
          </div>
        </div>

        <div className="dash-card">
          <div className="card-head">
            <div className="eyebrow">Quick links</div>
          </div>
          <div className="window-list">
            <div className="window" style={{ cursor: 'pointer' }} onClick={() => navigate('/map')}>
              <span className="mono-tiny">MAP</span>
              <span>Live buoy map</span>
              <span className="dot rating-4" />
            </div>
            <div className="window" style={{ cursor: 'pointer' }} onClick={() => navigate('/journal')}>
              <span className="mono-tiny">LOG</span>
              <span>Session journal</span>
              <span className="dot rating-3" />
            </div>
            <div className="window" style={{ cursor: 'pointer' }} onClick={() => navigate('/alerts')}>
              <span className="mono-tiny">ALERTS</span>
              <span>Notifications</span>
              <span className="dot rating-3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
