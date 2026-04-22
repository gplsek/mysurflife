import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import Logo from '../design/Logo';
import './Home.css';

export default function Home() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef(null);

  // Subtle pointer parallax on the auth card
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !window.matchMedia('(pointer: fine)').matches) return;

    const onMove = (e) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      card.style.transform = `rotateX(${-y * 2}deg) rotateY(${x * 2}deg)`;
    };
    const onLeave = () => { card.style.transform = ''; };

    document.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      card.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // Scroll reveal
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }),
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
    );
    document.querySelectorAll('.home-reveal').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required'); return; }
    setError('');
    setSubmitting(true);
    const { error: authErr } = await signIn(email, password);
    if (authErr) {
      setError(authErr.message || 'Invalid email or password');
      setSubmitting(false);
    }
    // On success, AuthContext does window.location.href = '/'
  };

  const focusEmail = () => cardRef.current?.querySelector('input[type="email"]')?.focus();

  return (
    <div className="home">
      {/* ── Sticky nav ── */}
      <nav className="home-nav">
        <a href="/" className="home-brand">
          <Logo variant="mark" size={28} />
          mysurflife
        </a>
        <div className="home-nav-links">
          <a href="#how">How it works</a>
          <a href="#">Forecast</a>
          <a href="#">About</a>
          <span className="home-nav-sep">·</span>
          <button className="home-nav-signin" onClick={focusEmail}>Sign in</button>
        </div>
      </nav>

      <main className="home-main">
        {/* ── Animated wave lines ── */}
        <div className="home-waves-bg" aria-hidden="true">
          <svg viewBox="0 0 1200 600" preserveAspectRatio="none">
            <path className="home-wave-path" d="M0 320 Q 150 280 300 320 T 600 320 T 900 320 T 1200 320">
              <animate attributeName="d" dur="12s" repeatCount="indefinite"
                values="M0 320 Q 150 280 300 320 T 600 320 T 900 320 T 1200 320;
                        M0 320 Q 150 360 300 320 T 600 320 T 900 320 T 1200 320;
                        M0 320 Q 150 280 300 320 T 600 320 T 900 320 T 1200 320" />
            </path>
            <path className="home-wave-path p2" d="M0 380 Q 200 340 400 380 T 800 380 T 1200 380">
              <animate attributeName="d" dur="16s" repeatCount="indefinite"
                values="M0 380 Q 200 340 400 380 T 800 380 T 1200 380;
                        M0 380 Q 200 420 400 380 T 800 380 T 1200 380;
                        M0 380 Q 200 340 400 380 T 800 380 T 1200 380" />
            </path>
            <path className="home-wave-path p3" d="M0 260 Q 180 220 360 260 T 720 260 T 1200 260">
              <animate attributeName="d" dur="20s" repeatCount="indefinite"
                values="M0 260 Q 180 220 360 260 T 720 260 T 1200 260;
                        M0 260 Q 180 300 360 260 T 720 260 T 1200 260;
                        M0 260 Q 180 220 360 260 T 720 260 T 1200 260" />
            </path>
          </svg>
        </div>

        {/* ── Hero ── */}
        <section className="home-hero">
          {/* Left: pitch */}
          <div>
            <div className="home-eyebrow home-fade-up home-d1">
              <span className="home-dot" />
              Personalized surf intelligence
            </div>

            <h1 className="home-h1 home-fade-up home-d2">
              Stop reading<br />
              forecasts. <em>Ask&nbsp;your<br />surf copilot.</em>
            </h1>

            <p className="home-subhead home-fade-up home-d3">
              <b>mysurflife</b> answers the question every surfer actually has —{' '}
              <em style={{ fontFamily: "'Instrument Serif',serif", fontStyle: 'italic', color: 'var(--fg, oklch(0.96 0.008 90))' }}>
                should I go, and what should I bring?
              </em>{' '}
              — by combining live buoy, wind, and tide data with what we've learned from your sessions.
            </p>

            <div className="home-metrics home-fade-up home-d4">
              <div className="home-metric-item">
                <span className="home-metric-n">412<span className="home-metric-unit">+</span></span>
                <span className="home-metric-l">Spots covered</span>
              </div>
              <div className="home-metric-item">
                <span className="home-metric-n">0.87<span className="home-metric-unit"> avg</span></span>
                <span className="home-metric-l">Forecast confidence</span>
              </div>
              <div className="home-metric-item">
                <span className="home-metric-n">±0.8<span className="home-metric-unit"> pts</span></span>
                <span className="home-metric-l">Score accuracy</span>
              </div>
              <div className="home-metric-item">
                <span className="home-metric-n">8<span className="home-metric-unit">s</span></span>
                <span className="home-metric-l">Avg answer time</span>
              </div>
            </div>
          </div>

          {/* Right: auth card — sign in only */}
          <div className="home-auth-card home-fade-up home-d5" ref={cardRef} style={{ perspective: '800px' }}>
            <div className="home-auth-header">Sign in to your account</div>

            <form onSubmit={handleSignIn}>
              {error && <div className="home-auth-error">{error}</div>}

              <div className="home-field-group">
                <label htmlFor="home-email">Email</label>
                <input
                  id="home-email"
                  type="email"
                  placeholder="you@email.com"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="home-field-group">
                <label htmlFor="home-pw">Password</label>
                <input
                  id="home-pw"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="home-inline-row">
                <label className="home-check-label">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                  />
                  Remember me
                </label>
                <a href="#" className="home-forgot">Forgot password?</a>
              </div>

              <button type="submit" className="home-submit" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
                {!submitting && (
                  <svg className="home-arr" width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                )}
              </button>

              <div className="home-swap-line">
                Access is by invitation only.{' '}
                <a href="mailto:hello@mysurflife.com">Request access →</a>
              </div>
            </form>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="home-how home-reveal" id="how">
          <div className="home-section-head">
            <div className="home-eyebrow">
              <span className="home-dot" />
              How it works
            </div>
            <h2 className="home-h2">
              A surf-savvy assistant that <em>learns how you surf.</em>
            </h2>
            <p>
              No more tab-switching between three forecast sites. Ask a question, log your sessions,
              and mysurflife gets sharper for you every time you paddle out.
            </p>
          </div>

          <div className="home-steps">
            {/* Step 1 — Ask */}
            <div className="home-step home-reveal">
              <div className="home-step-illo">
                <div className="home-illo-copilot">
                  <div className="home-illo-q">Should I surf Cardiff at 6pm?</div>
                  <div className="home-illo-a">
                    <b>Yes — 7.4 for you.</b> Wind drops to 4mph SW, fish-range swell.
                    <span className="home-caret" />
                  </div>
                </div>
              </div>
              <span className="home-step-num">01 — ASK</span>
              <h3>Just ask, in plain English.</h3>
              <p>Compare spots, check wind, pick a board, or scan the week — in one conversation instead of ten dashboards.</p>
            </div>

            {/* Step 2 — Score */}
            <div className="home-step home-reveal">
              <div className="home-step-illo">
                <div className="home-illo-score">
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth="6" />
                    <circle
                      className="home-score-ring"
                      cx="50" cy="50" r="40"
                      fill="none" stroke="var(--accent, oklch(0.82 0.16 195))"
                      strokeWidth="6" strokeLinecap="round"
                      transform="rotate(-90 50 50)"
                    />
                    <text x="50" y="56" textAnchor="middle" fill="var(--fg, oklch(0.96 0.008 90))"
                      fontFamily="Geist" fontSize="22" fontWeight="700" letterSpacing="-1">7.4</text>
                    <text x="50" y="72" textAnchor="middle" fill="var(--muted, oklch(0.58 0.014 230))"
                      fontFamily="Geist Mono" fontSize="7" letterSpacing="2">FOR YOU</text>
                  </svg>
                </div>
              </div>
              <span className="home-step-num">02 — SCORE</span>
              <h3>Personalized — not one-size-fits-all.</h3>
              <p>Your skill, boards, tide preferences and drive radius reshape every spot's score. A 6.0 for the crowd is an 8.0 for you.</p>
            </div>

            {/* Step 3 — Log */}
            <div className="home-step home-reveal">
              <div className="home-step-illo">
                <div className="home-illo-log">
                  <div className="home-log-row"><span>SPOT</span><span>Cardiff</span></div>
                  <div className="home-log-row"><span>BOARD</span><span>5'10" Fish</span></div>
                  <div className="home-log-row"><span>WIND</span><span>4 SW</span></div>
                  <div className="home-log-row"><span>WAVES</span><span>12</span></div>
                  <div className="home-log-row home-log-row-highlight"><span>RATING</span><span>8 / 10</span></div>
                </div>
              </div>
              <span className="home-step-num">03 — LOG</span>
              <h3>Log sessions. Get sharper.</h3>
              <p>A 20-second session report closes the loop — we compare predicted vs. actual and quietly retune your model.</p>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="home-footer">
        <div className="home-foot-inner">
          <div className="home-foot-brand">
            <Logo variant="mark" size={20} />
            mysurflife
          </div>
          <div className="home-foot-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Contact</a>
            <a href="#">Status</a>
          </div>
          <div className="home-foot-right">© 2026 · MADE ON THE COAST</div>
        </div>
      </footer>
    </div>
  );
}
