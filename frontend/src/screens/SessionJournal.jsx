import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { getAuthHeaders } from '../supabaseClient';
import LogoPulse from '../design/LogoPulse';
import QuickLog from '../components/QuickLog';

function RatingDots({ value }) {
  return (
    <div className="session-rating">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`rating-dot ${i < value ? 'filled' : ''}`} />
      ))}
    </div>
  );
}

export default function SessionJournal() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logOpen, setLogOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const headers = await getAuthHeaders();
      const res = await window.fetch('/api/sessions', { headers });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (_) {
      // silently degrade — endpoint may not be live yet
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const totalMin = sessions.reduce((a, s) => a + (s.duration || 0), 0);
  const totalWaves = sessions.reduce((a, s) => a + (s.waves || 0), 0);
  const avgRating = sessions.length
    ? sessions.reduce((a, s) => a + (s.rating || 0), 0) / sessions.length
    : 0;

  if (loading) {
    return (
      <div className="screen sessions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogoPulse size={56} />
      </div>
    );
  }

  return (
    <div className="screen sessions">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Session Journal</div>
          <h1 className="screen-title">Your surf memory, indexed.</h1>
          <div className="screen-sub">Every session feeds your personal forecast model.</div>
        </div>
        {user && (
          <button className="btn-primary" onClick={() => setLogOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New session
          </button>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="sessions-stats">
          <div className="stat-block">
            <div className="num-big">{sessions.length}</div>
            <div className="lbl">sessions</div>
          </div>
          <div className="stat-block">
            <div className="num-big">
              {Math.floor(totalMin / 60)}<span className="unit">h</span>
              {totalMin % 60}<span className="unit">m</span>
            </div>
            <div className="lbl">in water</div>
          </div>
          <div className="stat-block">
            <div className="num-big">{totalWaves}</div>
            <div className="lbl">waves caught</div>
          </div>
          <div className="stat-block">
            <div className="num-big">{avgRating.toFixed(1)}<span className="unit">/5</span></div>
            <div className="lbl">avg rating</div>
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div style={{
          padding: '60px 40px', textAlign: 'center',
          background: 'var(--bg-2)', border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--radius-l)', marginBottom: 28,
        }}>
          <div style={{ color: 'var(--accent)', marginBottom: 16 }}>
            <svg width="80" height="60" viewBox="0 0 120 80" fill="none">
              <path d="M4 50 Q30 30 60 50 T116 50" stroke="currentColor" strokeWidth="1.2" opacity="0.4"/>
              <path d="M4 58 Q30 38 60 58 T116 58" stroke="currentColor" strokeWidth="1.2" opacity="0.25"/>
              <circle cx="60" cy="20" r="4" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6"/>
            </svg>
          </div>
          <div style={{ fontSize: 20, fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--fg)', marginBottom: 8 }}>
            No sessions logged yet.
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', maxWidth: 400, margin: '0 auto' }}>
            {user
              ? 'Log your first session to start building your personal forecast model.'
              : 'Sign in to log sessions and get AI-powered forecasts tuned to your preferences.'}
          </div>
        </div>
      )}

      <div className="sessions-list">
        {sessions.map((s, i) => (
          <div key={i} className="session-row">
            <div className="session-date">
              <div className="session-day">
                {new Date(s.date).toLocaleDateString('en-US', { day: '2-digit' })}
              </div>
              <div className="mono-tiny">
                {new Date(s.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
              </div>
            </div>
            <div className="session-body">
              <div className="session-head-row">
                <div className="session-spot">{s.spot}</div>
                <RatingDots value={s.rating || 0} />
              </div>
              <div className="session-meta">
                {s.duration && <><span className="mono-tiny">{s.duration}min</span><span className="sep">·</span></>}
                {s.waves && <><span className="mono-tiny">{s.waves} waves</span><span className="sep">·</span></>}
                {(s.swell || s.size || s.wind_label) && (
                  <span className="mono-tiny">
                    {s.swell ? `${s.swell}ft` : s.size}
                    {(s.swell || s.size) && s.wind_label ? ' · ' : ''}
                    {s.wind_label}
                  </span>
                )}
              </div>
              {s.note && <div className="session-note">{s.note}</div>}
            </div>
          </div>
        ))}
      </div>

      <QuickLog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onLogged={(session) => {
          setSessions(prev => [session, ...prev]);
          setLogOpen(false);
        }}
      />
    </div>
  );
}
