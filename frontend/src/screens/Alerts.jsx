import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { getAuthHeaders } from '../supabaseClient';
import LogoPulse from '../design/LogoPulse';

function Toggle({ on, onChange }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onChange} aria-pressed={on}>
      <span className="toggle-knob" />
    </button>
  );
}

export default function Alerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quietHours, setQuietHours] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    const fetchAlerts = async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await window.fetch('/api/alerts', { headers });
        if (res.ok) {
          const data = await res.json();
          setAlerts(data.alerts || []);
        }
        // 404 means endpoint not yet built — show empty state
      } catch (_) {
        // silently degrade
      } finally {
        setLoading(false);
      }
    };
    fetchAlerts();
  }, [user]);

  const toggleAlert = (id) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a));
  };

  if (loading) {
    return (
      <div className="screen alerts" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LogoPulse size={56} />
      </div>
    );
  }

  return (
    <div className="screen alerts">
      <div className="screen-head">
        <div>
          <div className="eyebrow">Alerts & Notifications</div>
          <h1 className="screen-title">Tell us when to wake you up.</h1>
          <div className="screen-sub">The AI watches conditions 24/7 and pings you only when it matters.</div>
        </div>
        {user && (
          <button className="btn-primary" onClick={() => alert('Alert creation coming soon')}>
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New alert
          </button>
        )}
      </div>

      {alerts.length === 0 && (
        <div style={{
          padding: '56px 40px', textAlign: 'center',
          background: 'var(--bg-2)', border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--radius-l)', marginBottom: 28,
        }}>
          <div style={{ marginBottom: 16 }}>
            <svg width="48" height="48" viewBox="0 0 14 14" fill="none" stroke="var(--accent)" strokeWidth="1.2">
              <path d="M2 5a5 5 0 0110 0v3l1 2H1l1-2V5z"/>
              <path d="M5 11a2 2 0 004 0"/>
            </svg>
          </div>
          <div style={{ fontSize: 20, fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--fg)', marginBottom: 8 }}>
            No alerts set up yet.
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', maxWidth: 400, margin: '0 auto' }}>
            {user
              ? 'Create an alert to get notified when your spot hits the right conditions.'
              : 'Sign in to set up surf condition alerts for your favorite spots.'}
          </div>
        </div>
      )}

      <div className="alert-list">
        {alerts.map(a => (
          <div key={a.id} className={`alert-row ${!a.active ? 'off' : ''}`}>
            <div className="alert-icon">
              {a.ai ? (
                <div className="ai-chip">AI</div>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 5a5 5 0 0110 0v3l1 2H1l1-2V5z" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M5 11a2 2 0 004 0" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
              )}
            </div>
            <div className="alert-body">
              <div className="alert-head-row">
                <div className="alert-spot">{a.spot}</div>
                <div className="mono-tiny alert-channel">{a.channel}</div>
              </div>
              <div className="alert-cond">{a.condition}</div>
              {a.lastTriggered && (
                <div className="mono-tiny alert-trig">Last triggered: {a.lastTriggered}</div>
              )}
            </div>
            <Toggle on={a.active} onChange={() => toggleAlert(a.id)} />
          </div>
        ))}
      </div>

      <div className="quiet-hours">
        <div>
          <div className="eyebrow">Quiet hours</div>
          <div className="quiet-desc">
            Don't ping me between <strong>21:00</strong> and <strong>05:00</strong>.
          </div>
        </div>
        <Toggle on={quietHours} onChange={() => setQuietHours(q => !q)} />
      </div>
    </div>
  );
}
