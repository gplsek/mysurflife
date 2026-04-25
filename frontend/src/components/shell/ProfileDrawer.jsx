import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../design/ThemeProvider';
import { getAuthHeaders } from '../../supabaseClient';
import LogoPulse from '../../design/LogoPulse';
import './ProfileDrawer.css';

const SKILL_LABELS = {
  beginner:     'Beginner',
  intermediate: 'Intermediate',
  experienced:  'Experienced',
  expert:       'Expert',
};

const SKILL_COLORS = {
  beginner:     'oklch(0.80 0.16 150)',
  intermediate: 'oklch(0.70 0.16 230)',
  experienced:  'oklch(0.82 0.14 85)',
  expert:       'oklch(0.72 0.22 25)',
};

function Switch({ on, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={`pd-switch${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div className="pd-seg">
      {options.map(opt => (
        <button
          key={opt.value ?? opt}
          className={(opt.value ?? opt) === value ? 'on' : ''}
          onClick={() => onChange(opt.value ?? opt)}
        >
          {opt.label ?? opt}
        </button>
      ))}
    </div>
  );
}

export default function ProfileDrawer({ open, onClose }) {
  const { user, isAdmin, signOut } = useAuth();
  const { preference: themePref, setTheme } = useTheme();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [mode, setMode] = useState('view'); // view | edit | dirty | saving
  const [showSignOut, setShowSignOut] = useState(false);
  const [toast, setToast] = useState(false);
  const toastTimerRef = useRef(null);

  // Edit form state
  const [draft, setDraft] = useState({});
  const [saveError, setSaveError] = useState('');

  // Preferences (localStorage-backed)
  const [prefs, setPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('msl_prefs') || '{}');
    } catch { return {}; }
  });

  const savePrefs = useCallback((updates) => {
    setPrefs(p => {
      const next = { ...p, ...updates };
      localStorage.setItem('msl_prefs', JSON.stringify(next));
      return next;
    });
  }, []);

  // Notification prefs (localStorage)
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('msl_notif_prefs') || '{}');
    } catch { return {}; }
  });

  const saveNotifPrefs = useCallback((updates) => {
    setNotifPrefs(p => {
      const next = { ...p, ...updates };
      localStorage.setItem('msl_notif_prefs', JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    setProfileLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/user/profile', { headers });
      const data = await res.json();
      setProfile(data.profile || {});
    } catch {
      setProfile({});
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (open && user) fetchProfile();
  }, [open, user, fetchProfile]);

  // Reset mode when drawer closes
  useEffect(() => {
    if (!open) {
      setMode('view');
      setShowSignOut(false);
      setSaveError('');
    }
  }, [open]);

  const handleEditStart = () => {
    setDraft({
      display_name: profile?.display_name || '',
      home_spot_name: profile?.home_spot_name || '',
      skill_level: profile?.skill_level || '',
      stance: profile?.stance || '',
      years_surfing: profile?.years_surfing ?? '',
    });
    setSaveError('');
    setMode('edit');
  };

  const handleEditField = (field, value) => {
    setDraft(d => ({ ...d, [field]: value }));
    if (mode === 'edit') setMode('dirty');
  };

  const handleCancel = () => {
    setMode('view');
    setSaveError('');
  };

  const handleSave = async () => {
    setMode('saving');
    setSaveError('');
    try {
      const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
      const payload = { ...draft };
      if (payload.years_surfing !== '' && payload.years_surfing !== null) {
        payload.years_surfing = parseInt(payload.years_surfing, 10) || null;
      } else {
        payload.years_surfing = null;
      }
      const res = await fetch('/api/user/profile', {
        method: 'PUT', headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Save failed');
      }
      const data = await res.json();
      setProfile(data.profile);
      setMode('view');
      showToast();
    } catch (err) {
      setSaveError(err.message);
      setMode('dirty');
    }
  };

  const showToast = () => {
    setToast(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(false), 2600);
  };

  const handleSignOut = async () => {
    setShowSignOut(false);
    onClose();
    await signOut();
  };

  const handleAdminNav = (path) => {
    onClose();
    navigate(path);
  };

  const initials = profile?.display_name
    ? profile.display_name.slice(0, 2).toUpperCase()
    : user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : '??';

  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'You';
  const isEditing = mode === 'edit' || mode === 'dirty' || mode === 'saving';
  const isDirty = mode === 'dirty';
  const isSaving = mode === 'saving';

  return (
    <>
      {/* Scrim */}
      <div
        className={`pd-scrim${open ? ' open' : ''}`}
        onClick={() => !showSignOut && onClose()}
      />

      {/* Drawer */}
      <aside
        className={`pd-drawer${open ? ' open' : ''}`}
        role="dialog"
        aria-label="Profile"
        aria-modal="true"
      >
        {/* Head */}
        <header className="pd-head">
          <h2>
            {isEditing ? <>Edit <em>profile</em></> : 'Profile'}
          </h2>
          <div className="pd-actions">
            {isEditing && (
              <button className="pd-btn-ghost" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </button>
            )}
            {!isEditing && (
              <button className="pd-btn-primary" onClick={handleEditStart}>
                Edit
              </button>
            )}
            {isEditing && (
              <button className="pd-btn-primary" onClick={handleSave} disabled={isSaving || !isDirty && mode !== 'edit'}>
                {isSaving ? <LogoPulse size={12} compact /> : 'Save'}
              </button>
            )}
            <button className="pd-icon-btn" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Unsaved changes banner */}
        <div className={`pd-unsaved${isDirty ? ' show' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M7 4v3.5M7 9.5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Unsaved changes
          <span className="pd-unsaved-spacer" />
          <button className="pd-btn-ghost" style={{ padding: '3px 8px', fontSize: 12 }} onClick={handleCancel}>
            Discard
          </button>
        </div>

        {/* Body */}
        <div className="pd-body">

          {/* ── 1. Identity ── */}
          <section className="pd-identity">
            <div className="pd-avatar" aria-label="Avatar">
              {initials}
              <span className="pd-avatar-ring" />
            </div>

            {!isEditing ? (
              <div className="pd-identity-info">
                {profileLoading ? (
                  <LogoPulse size={24} compact />
                ) : (
                  <>
                    <h3>{displayName}</h3>
                    <div className="pd-handle">{user?.email}</div>
                    {profile?.home_spot_name && (
                      <div className="pd-home">
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M6 1l1.5 3 3.3.5-2.4 2.3.6 3.3L6 8.5 2.9 10.1l.6-3.3L1 4.5 4.5 4z" fill="currentColor"/>
                        </svg>
                        Home break · {profile.home_spot_name}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="pd-identity-form">
                <div className="pd-field">
                  <label htmlFor="pd-name">Display name</label>
                  <input
                    id="pd-name"
                    type="text"
                    value={draft.display_name}
                    onChange={e => handleEditField('display_name', e.target.value)}
                    placeholder="e.g. George"
                    disabled={isSaving}
                  />
                </div>
                <div className="pd-field">
                  <label htmlFor="pd-email">Email</label>
                  <input
                    id="pd-email"
                    type="email"
                    value={user?.email || ''}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                </div>
                <div className="pd-field">
                  <label htmlFor="pd-home">Home break</label>
                  <input
                    id="pd-home"
                    type="text"
                    value={draft.home_spot_name}
                    onChange={e => handleEditField('home_spot_name', e.target.value)}
                    placeholder="e.g. Rincon, Trestles"
                    disabled={isSaving}
                  />
                </div>
                {saveError && (
                  <div className="pd-field-err">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.4"/>
                      <path d="M6 3.5v3.2M6 8.6v.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                    {saveError}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── 2. Skill & experience ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">Skill &amp; experience</div>
            </div>

            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="pd-field">
                  <label htmlFor="pd-skill">Skill level</label>
                  <select
                    id="pd-skill"
                    value={draft.skill_level}
                    onChange={e => handleEditField('skill_level', e.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">— not set —</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="experienced">Experienced</option>
                    <option value="expert">Expert</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div className="pd-field" style={{ flex: 1 }}>
                    <label htmlFor="pd-years">Years surfing</label>
                    <input
                      id="pd-years"
                      type="number"
                      min="0" max="80"
                      value={draft.years_surfing}
                      onChange={e => handleEditField('years_surfing', e.target.value)}
                      placeholder="e.g. 10"
                      disabled={isSaving}
                    />
                  </div>
                  <div className="pd-field" style={{ flex: 1 }}>
                    <label htmlFor="pd-stance">Stance</label>
                    <select
                      id="pd-stance"
                      value={draft.stance}
                      onChange={e => handleEditField('stance', e.target.value)}
                      disabled={isSaving}
                    >
                      <option value="">— not set —</option>
                      <option value="regular">Regular</option>
                      <option value="goofy">Goofy</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="pd-skill-grid">
                <div className="pd-skill-cell">
                  <div className="label">Skill</div>
                  <div
                    className="value"
                    style={{ color: profile?.skill_level ? SKILL_COLORS[profile.skill_level] : 'var(--muted)' }}
                  >
                    {profile?.skill_level ? SKILL_LABELS[profile.skill_level] : '—'}
                  </div>
                </div>
                <div className="pd-skill-cell">
                  <div className="label">Years surfing</div>
                  <div className="value">
                    {profile?.years_surfing != null
                      ? <>{profile.years_surfing}<span className="pd-handle" style={{ fontSize: 12, marginLeft: 2 }}>yr</span></>
                      : '—'}
                  </div>
                </div>
                <div className="pd-skill-cell">
                  <div className="label">Stance</div>
                  <div className="value">
                    {profile?.stance
                      ? profile.stance.charAt(0).toUpperCase() + profile.stance.slice(1)
                      : '—'}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── 3. Preferences ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">Preferences</div>
            </div>

            <div className="pd-pref-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Units</div>
                <div className="pd-pref-sub">Wave height, wind, temperature</div>
              </div>
              <Seg
                options={[
                  { value: 'imperial', label: 'FT · MPH · °F' },
                  { value: 'metric', label: 'M · KT · °C' },
                ]}
                value={prefs.units || 'imperial'}
                onChange={v => savePrefs({ units: v })}
              />
            </div>

            <div className="pd-pref-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Theme</div>
                <div className="pd-pref-sub">Auto follows system preference</div>
              </div>
              <Seg
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'ocean', label: 'Dark' },
                  { value: 'dawn', label: 'Dawn' },
                  { value: 'daylight', label: 'Light' },
                ]}
                value={themePref}
                onChange={setTheme}
              />
            </div>

            <div className="pd-pref-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Forecast cadence</div>
                <div className="pd-pref-sub">Default sampling for strip charts</div>
              </div>
              <Seg
                options={['1h', '3h', '6h']}
                value={prefs.cadence || '3h'}
                onChange={v => savePrefs({ cadence: v })}
              />
            </div>

            <div className="pd-pref-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Reduced motion</div>
                <div className="pd-pref-sub">Disable animated overlays and pulses</div>
              </div>
              <Switch
                on={prefs.reducedMotion || false}
                onChange={v => savePrefs({ reducedMotion: v })}
              />
            </div>
          </section>

          {/* ── 4. Notifications ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">Notifications</div>
              <Link to="/alerts" className="pd-section-link" onClick={onClose}>
                Manage alerts →
              </Link>
            </div>

            <div className="pd-pref-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Email digest</div>
                <div className="pd-pref-sub">Your favorite spots in one email</div>
              </div>
              <Seg
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'daily_am', label: 'Daily 6a' },
                  { value: 'daily_pm', label: 'Daily 7p' },
                  { value: 'weekly', label: 'Weekly' },
                ]}
                value={notifPrefs.digest || 'off'}
                onChange={v => saveNotifPrefs({ digest: v })}
              />
            </div>

            <div className="pd-pref-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Push notifications</div>
                <div className="pd-pref-sub">Real-time alerts on this device</div>
              </div>
              <Switch
                on={notifPrefs.push || false}
                onChange={v => saveNotifPrefs({ push: v })}
              />
            </div>

            <div className="pd-quiet-row">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Quiet hours</div>
                <div className="pd-pref-sub">Push muted in this window</div>
              </div>
              <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="pd-time-display">9:00 PM</span>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>to</span>
                <span className="pd-time-display">6:00 AM</span>
              </div>
            </div>
          </section>

          {/* ── 5. Connected apps (stub) ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">Connected apps</div>
            </div>
            <div className="pd-stub-card">
              <div className="pd-stub-icon">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M5.5 7v-1a3 3 0 0 1 6 0v1M3 7h12v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="pd-stub-info">
                <div className="pd-stub-title">
                  Connected apps <span className="pd-stub-soon">Coming soon</span>
                </div>
                <div className="pd-stub-desc">
                  Sync sessions from Apple Health, Strava, Surfline, Garmin, and Google Fit.
                </div>
                <button className="pd-stub-action" disabled>Notify me when ready</button>
              </div>
            </div>
          </section>

          {/* ── 6. Plan & Billing (stub) ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">Plan &amp; Billing</div>
            </div>
            <div className="pd-stub-card gradient">
              <div className="pd-stub-icon">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 2l2 5 5 .4-3.8 3.5L13.5 16 9 13.4 4.5 16l1.3-5.1L2 7.4 7 7z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="pd-stub-info">
                <div className="pd-stub-title">
                  Free <span className="pd-stub-soon">Early access</span>
                </div>
                <div className="pd-stub-plan-meta">
                  <span>Unlimited spots · Sione · 16-day forecast</span>
                  <span className="pd-stub-badge">Active</span>
                </div>
                <div className="pd-stub-desc">
                  Paid plans launch with v1. Early-access users get a discounted annual rate.
                </div>
                <button className="pd-stub-action" disabled>Manage plan</button>
              </div>
            </div>
          </section>

          {/* ── 7. Privacy & data ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">Privacy &amp; data</div>
            </div>
            <div className="pd-privacy-action">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Export data</div>
                <div className="pd-pref-sub">Sessions, alerts, spots — emailed as a .zip</div>
              </div>
              <button
                className="pd-privacy-btn"
                onClick={() => alert('Data export coming soon — you\'ll receive an email when ready.')}
              >
                Export
              </button>
            </div>
            <div className="pd-privacy-action">
              <div className="pd-pref-stack">
                <div className="pd-pref-label">Delete account</div>
                <div className="pd-pref-sub">30-day soft delete, then irrevocable</div>
              </div>
              <button
                className="pd-privacy-btn danger"
                onClick={() => alert('Account deletion coming soon. Contact support@mysurflife.com to request deletion.')}
              >
                Delete
              </button>
            </div>
          </section>

          {/* ── Admin section ── */}
          {isAdmin && (
            <section className="pd-admin-section">
              <div className="pd-section-head" style={{ marginBottom: 8 }}>
                <div className="pd-section-title">Admin</div>
              </div>
              <div className="pd-admin-links">
                <button className="pd-admin-link" onClick={() => handleAdminNav('/admin/users')}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="5" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    <path d="M10 7v4M8 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Manage Users
                </button>
                <button className="pd-admin-link" onClick={() => handleAdminNav('/admin/personas')}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M7 1v2M7 11v2M1 7h2M11 7h2M3.2 3.2l1.4 1.4M9.4 9.4l1.4 1.4M3.2 10.8l1.4-1.4M9.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Manage AI Personas
                </button>
                <button className="pd-admin-link" onClick={() => handleAdminNav('/admin/storms')}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 10c0-1 .5-2 1.3-2.6A4 4 0 0 1 7 3a4 4 0 0 1 3.8 2.7C12 5.9 13 7 13 8.5c0 .8-.7 1.5-1.5 1.5H2.5C1.7 10 1 9.3 1 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    <path d="M7 10v3M5 12h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                  Storm Filters
                </button>
              </div>
            </section>
          )}

          {/* ── 8. About ── */}
          <section className="pd-section">
            <div className="pd-section-head">
              <div className="pd-section-title">About</div>
            </div>
            <div className="pd-about-row">
              <span className="pd-about-label">Version</span>
              <span className="pd-about-val">0.4 · mysurflife</span>
            </div>
            <div className="pd-about-links">
              <a href="#">Terms</a>
              <a href="#">Privacy</a>
              <a href="#">Help</a>
              <a href="mailto:support@mysurflife.com">Contact support</a>
            </div>
          </section>

        </div>

        {/* Footer */}
        <footer className="pd-foot">
          <div className="pd-foot-email">
            Signed in as <span>{user?.email}</span>
          </div>
          <button className="pd-btn-ghost" onClick={() => setShowSignOut(true)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ verticalAlign: -2, marginRight: 4 }}>
              <path d="M5 2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2M7 3l3 3-3 3M4 6h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sign out
          </button>
        </footer>
      </aside>

      {/* Sign-out confirm modal */}
      <div className={`pd-confirm-wrap${showSignOut ? ' show' : ''}`}>
        <div className="pd-confirm-card">
          <h3>Sign out of mysurflife?</h3>
          <p>Your logged sessions and preferences stay synced when you return.</p>
          <div className="pd-confirm-actions">
            <button className="pd-btn-ghost" onClick={() => setShowSignOut(false)}>
              Stay signed in
            </button>
            <button className={`pd-btn-primary pd-btn-danger`} onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Save toast */}
      <div className={`pd-toast${toast ? ' show' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7.5l3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Profile saved.
      </div>
    </>
  );
}
