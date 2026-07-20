import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import Logo from '../design/Logo';
import './Home.css';

const CARET_HTML = '<span class="home-demo-caret"></span>';

const DEMO_CONVERSATION = [
  { type: 'type', text: "Anything coming for next weekend?" },
  { type: 'send' },
  {
    type: 'bot',
    tools: ['track_storms', 'swell_arrival'],
    html: `<p><b>Yes — Saturday AM.</b> A storm at <b>42°N 155°W</b> is generating 45kt NW winds over 900nm of fetch. I ran the arrival calc:</p>
<div class="home-mini-chart" style="margin-top:10px">
  <div class="home-mini-chart-cap"><span>SWELL ARRIVAL · BLACKS</span><span>15S NW</span></div>
  <svg viewBox="0 0 300 58" preserveAspectRatio="none">
    <path d="M0 48 L60 46 L120 38 L180 20 L240 12 L300 16" stroke="oklch(0.82 0.16 195)" stroke-width="2" fill="none"/>
    <path d="M0 48 L60 46 L120 38 L180 20 L240 12 L300 16 L300 58 L0 58 Z" fill="oklch(0.82 0.16 195 / 0.15)"/>
    <line x1="180" y1="4" x2="180" y2="56" stroke="oklch(0.82 0.14 85)" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="184" y="12" fill="oklch(0.82 0.14 85)" font-family="Geist Mono" font-size="8" letter-spacing="1">SAT 6AM · PEAK</text>
    <g fill="oklch(0.58 0.014 230)" font-family="Geist Mono" font-size="7" letter-spacing="1">
      <text x="0" y="56">THU</text><text x="70" y="56">FRI</text><text x="150" y="56">SAT</text><text x="230" y="56">SUN</text><text x="280" y="56">MON</text>
    </g>
  </svg>
</div>
<p style="margin:10px 0 0">Leading edge hits SD Sat 6am, peaks 7.8ft @ 15s by noon. Winds stay light E <em>until about 10am</em>.</p>`
  },
  { type: 'type', text: "Perfect. How does Blacks vs. Cardiff look Sat morning?" },
  { type: 'send' },
  {
    type: 'bot',
    tools: ['compare_spots'],
    html: `<p><b>Blacks wins for you</b> — canyon amplifies this NW by ~30%, overhead sets. Cardiff softens it, chest-high and fun.</p>
<div class="home-mini-card">
  <div class="home-mini-score">
    <svg viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="21" fill="none" stroke="oklch(1 0 0 / 0.08)" stroke-width="4"/>
      <circle cx="26" cy="26" r="21" fill="none" stroke="oklch(0.82 0.16 195)" stroke-width="4" stroke-linecap="round" stroke-dasharray="132" stroke-dashoffset="20" transform="rotate(-90 26 26)"/>
    </svg>
    <div class="home-mini-score-num">8.4</div>
  </div>
  <div>
    <div class="home-mini-name">Blacks · SAT 6–10 AM</div>
    <div class="home-mini-sub">Overhead, light E offshore, low tide rising</div>
    <div class="home-mini-metrics">
      <div class="home-mini-m">SIZE<b>7.8ft</b></div>
      <div class="home-mini-m">PERIOD<b>15s</b></div>
      <div class="home-mini-m">WIND<b>4E</b></div>
      <div class="home-mini-m">TIDE<b>1.8↑</b></div>
    </div>
  </div>
</div>`
  },
  { type: 'type', text: "What board should I bring?" },
  { type: 'send' },
  {
    type: 'bot',
    tools: ['recommend_equipment'],
    html: `<p>Your <b>6'4" step-up</b>. That 15s period will have real push — the 5'10" fish you usually ride will feel underpowered on set waves. Book the dawn patrol, winds turn onshore <em>by 11am</em>.</p>`
  },
];

function SioneDemo() {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const inputEl = inputRef.current;
    if (!viewport || !track || !inputEl) return;

    let cancelled = false;
    let currentTimeout = null;

    function sleep(ms) {
      return new Promise(r => { currentTimeout = setTimeout(() => { currentTimeout = null; r(); }, ms); });
    }

    function settleScroll() {
      const overflow = track.scrollHeight - viewport.clientHeight;
      track.style.transform = overflow > 0 ? `translateY(${-overflow}px)` : 'translateY(0)';
    }

    async function typeInto(el, text) {
      el.innerHTML = '';
      for (let i = 0; i < text.length; i++) {
        if (cancelled) return;
        el.innerHTML = text.slice(0, i + 1) + CARET_HTML;
        await sleep(42);
      }
    }

    function appendBubble(html, cls) {
      const b = document.createElement('div');
      b.className = 'home-bubble ' + cls;
      b.innerHTML = html;
      track.appendChild(b);
      requestAnimationFrame(settleScroll);
      return b;
    }

    async function playConversation() {
      if (cancelled) return;
      for (const step of DEMO_CONVERSATION) {
        if (cancelled) return;
        if (step.type === 'type') {
          await typeInto(inputEl, step.text);
        } else if (step.type === 'send') {
          const text = inputEl.textContent.trim();
          inputEl.innerHTML = CARET_HTML;
          appendBubble(`<div class="home-bubble-b">${text}</div>`, 'home-bubble-user');
          await sleep(500);
        } else if (step.type === 'bot') {
          const thinking = appendBubble(
            `<div class="home-bubble-who">Sione</div>
             <div class="home-bubble-b"><span class="home-typing"><span></span><span></span><span></span></span></div>`,
            'home-bubble-bot'
          );
          await sleep(500);
          if (cancelled) return;
          const chips = (step.tools || [])
            .map(t => `<span class="home-tool-chip"><span class="home-tool-spin"></span>${t}</span>`)
            .join(' ');
          thinking.querySelector('.home-bubble-b').innerHTML =
            chips + '<div style="height:4px"></div><span class="home-typing"><span></span><span></span><span></span></span>';
          requestAnimationFrame(settleScroll);
          await sleep(700);
          if (cancelled) return;
          thinking.querySelectorAll('.home-tool-chip').forEach(c => c.classList.add('done'));
          const bEl = thinking.querySelector('.home-bubble-b');
          const doneChips = Array.from(bEl.querySelectorAll('.home-tool-chip')).map(c => c.outerHTML).join(' ');
          bEl.innerHTML = doneChips + '<div style="height:6px"></div>' + step.html;
          requestAnimationFrame(settleScroll);
          await sleep(2200);
        }
      }
      if (cancelled) return;
      await sleep(2500);
      if (cancelled) return;
      track.innerHTML = '';
      track.style.transform = 'translateY(0)';
      inputEl.innerHTML = CARET_HTML;
      await sleep(800);
      if (!cancelled) playConversation();
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { io.disconnect(); playConversation(); } });
    }, { threshold: 0.2 });
    io.observe(viewport);

    return () => {
      cancelled = true;
      if (currentTimeout) clearTimeout(currentTimeout);
      io.disconnect();
    };
  }, []);

  return (
    <div className="home-demo" aria-label="Animated Sione demo">
      <div className="home-demo-head">
        <div className="home-demo-dots">
          <span /><span /><span />
        </div>
        <span className="home-demo-title">mysurflife / sione</span>
        <span className="home-demo-pill">LIVE</span>
      </div>
      <div className="home-demo-scroll" ref={viewportRef}>
        <div className="home-demo-track" ref={trackRef} />
      </div>
      <div className="home-demo-input">
        <div className="home-demo-inp" ref={inputRef}>
          <span className="home-demo-caret" />
        </div>
        <button className="home-demo-send" aria-label="Send">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const CAT_CHIPS = [
  { n: 0,  bg: 'oklch(0.25 0.02 230)',  color: 'oklch(0.78 0.012 90)' },
  { n: 1,  bg: 'oklch(0.42 0.09 230)',  color: 'oklch(0.12 0.02 230)' },
  { n: 2,  bg: 'oklch(0.55 0.13 215)',  color: 'oklch(0.12 0.02 230)' },
  { n: 3,  bg: 'oklch(0.68 0.15 200)',  color: 'oklch(0.12 0.02 230)' },
  { n: 4,  bg: 'oklch(0.82 0.16 195)',  color: 'oklch(0.12 0.02 230)' },
  { n: 5,  bg: 'oklch(0.82 0.14 140)',  color: 'oklch(0.12 0.02 230)' },
  { n: 6,  bg: 'oklch(0.82 0.15 105)',  color: 'oklch(0.12 0.02 230)' },
  { n: 7,  bg: 'oklch(0.82 0.14 85)',   color: 'oklch(0.12 0.02 230)' },
  { n: 8,  bg: 'oklch(0.78 0.18 55)',   color: 'oklch(0.12 0.02 230)' },
  { n: 9,  bg: 'oklch(0.72 0.19 35)',   color: 'oklch(0.12 0.02 230)' },
  { n: 10, bg: 'oklch(0.60 0.22 25)',   color: '#fff' },
];

export default function Home() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const ctaEmailRef = useRef(null);

  // Request-access form (signin | request | requested)
  const [ctaMode, setCtaMode] = useState('signin');
  const [reqName, setReqName] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState('');

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }),
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
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
  };

  const handleRequestAccess = async (e) => {
    e.preventDefault();
    if (!reqEmail) { setReqError('Email is required'); return; }
    setReqError('');
    setReqSubmitting(true);
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: reqEmail, name: reqName, note: reqNote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Something went wrong — please try again.');
      }
      setCtaMode('requested');
    } catch (err) {
      setReqError(err.message);
    } finally {
      setReqSubmitting(false);
    }
  };

  const scrollToCTA = () => {
    ctaEmailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => ctaEmailRef.current?.focus(), 400);
  };

  return (
    <div className="home">

      {/* ── NAV ── */}
      <nav className="home-nav">
        <a href="/" className="home-brand">
          <Logo variant="mark" size={28} />
          mysurflife
        </a>
        <div className="home-nav-links">
          <a href="#how">How it works</a>
          <a href="#sione">Sione</a>
          <a href="#forecast">Forecast</a>
          <a href="#journal">Journal</a>
          <a href="#spots">Spots</a>
          <span className="home-nav-sep">·</span>
          <button className="home-nav-signin" onClick={scrollToCTA}>Sign in</button>
        </div>
      </nav>

      <main className="home-main">

        {/* ── HERO ── */}
        <section className="home-hero">
          <div>
            <div className="home-eyebrow">
              <span className="home-dot" />
              Personal surf intelligence · Beta
            </div>
            <h1 className="home-h1">
              The surf forecast that<br />
              <em>learns how you surf.</em>
            </h1>
            <p className="home-subhead">
              Real-time buoys. <b>16-day</b> wave models. Sione, our AI that synthesizes it all
              and tells you when <em style={{ color: 'oklch(0.96 0.008 90)' }}>your</em> conditions
              are aligning — and gets sharper every time you paddle out.
            </p>
            <div className="home-cta-row">
              <button className="home-btn home-btn-primary" onClick={scrollToCTA}>
                Sign in to your account
                <svg className="home-btn-arr" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
              <button className="home-btn" onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
                How it works
              </button>
            </div>
            <div className="home-trust-row">
              <div className="home-trust-item">
                <span className="home-trust-n">9,500<span className="home-trust-u">+</span></span>
                <span className="home-trust-l">Spots worldwide</span>
              </div>
              <div className="home-trust-item">
                <span className="home-trust-n">16<span className="home-trust-u"> day</span></span>
                <span className="home-trust-l">Forecast horizon</span>
              </div>
              <div className="home-trust-item">
                <span className="home-trust-n">NOAA</span>
                <span className="home-trust-l">Buoys + WW3 + tides</span>
              </div>
              <div className="home-trust-item">
                <span className="home-trust-n">±0.8<span className="home-trust-u"> pts</span></span>
                <span className="home-trust-l">Personal accuracy</span>
              </div>
            </div>
          </div>
          <SioneDemo />
        </section>

        {/* ── STATS BAND ── */}
        <div className="home-stats-band home-reveal">
          <div className="home-stats-item">
            <div className="home-stats-v"><em>NOAA</em> buoys</div>
            <div className="home-stats-k">Live observations</div>
          </div>
          <div className="home-stats-item">
            <div className="home-stats-v"><em>WW3</em> + GFS</div>
            <div className="home-stats-k">Global wave models</div>
          </div>
          <div className="home-stats-item">
            <div className="home-stats-v"><em>CO-OPS</em> tides</div>
            <div className="home-stats-k">Station-accurate</div>
          </div>
          <div className="home-stats-item">
            <div className="home-stats-v"><em>mysurflife</em> physics</div>
            <div className="home-stats-k">Validated decay + arrival</div>
          </div>
        </div>

        {/* ── THE PROBLEM ── */}
        <section className="home-section">
          <div className="home-section-head home-reveal">
            <div className="home-eyebrow">
              <span className="home-dot" />
              The problem
            </div>
            <h2>
              You already do the synthesis.{' '}
              <em>In your head. Every swell.</em>
            </h2>
            <p>
              Before any good day, the best surfers are tracking storms on satellite wind maps, reading buoys,
              cross-referencing tides, and pulling up a second forecast to sanity-check the first. That calculation
              — <em>will this swell actually work at my spot on my schedule</em> — lives entirely in their head.
              No app helps. No app learns from it.
            </p>
          </div>
          <div className="home-pullquote home-reveal">
            Experienced surfers don't use one source. They use five, then make a decision their app could've made for them.
            <small>— the reason mysurflife exists</small>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how" className="home-section">
          <div className="home-section-head home-reveal">
            <div className="home-eyebrow">
              <span className="home-dot" />
              How it works
            </div>
            <h2>From zero to <em>predicted sessions</em> in four steps.</h2>
          </div>
          <div className="home-steps">
            <div className="home-step home-reveal">
              <span className="home-step-num">01 — ADD</span>
              <h3>Add your spots</h3>
              <p>We map the nearest buoys, pre-load the bathymetry, and analyze the swell windows and blockers for each. Not a generic regional forecast — yours.</p>
            </div>
            <div className="home-step home-reveal">
              <span className="home-step-num">02 — ASK</span>
              <h3>Ask Sione anything</h3>
              <p>"How does Wednesday morning look at Blacks?" Pulls live buoys, model forecasts, and tides — explains the answer in plain language, backed by physics.</p>
            </div>
            <div className="home-step home-reveal">
              <span className="home-step-num">03 — LOG</span>
              <h3>Log sessions in 30 seconds</h3>
              <p>Tap your spot, rate it 1–10. We auto-populate the actual buoy, tide, and wind readings for that window so the log is complete without you typing numbers.</p>
            </div>
            <div className="home-step home-reveal">
              <span className="home-step-num">04 — LEARN</span>
              <h3>Watch it get smarter</h3>
              <p>After a handful of sessions, mysurflife knows your sweet spot. Predictions use <em>your</em> history, not generic scores. Your 8/10 is calibrated to you.</p>
            </div>
          </div>
        </section>

        {/* ── FORECAST / TIMELINE ── */}
        <section id="forecast" className="home-section">
          <div className="home-section-head home-reveal">
            <div className="home-eyebrow">
              <span className="home-dot" />
              The forecast that explains itself
            </div>
            <h2>Wave, wind, tide — <em>one timeline, one explanation.</em></h2>
            <p>Most apps show you charts and expect you to interpret them. We explain what the charts mean for your session — in Sione, in the answer, and on the chart itself.</p>
          </div>
          <div className="home-timeline-wrap home-reveal">
            <div className="home-timeline-copy">
              <h3>The 16-day timeline, <em>unified</em>.</h3>
              <p>Every spot gets wave height + period, wind speed + direction, and tide state on the same axis. Filter windows by your preference profile. Pull it up in Sione with a single question.</p>
              <ul className="home-bullet-list">
                <li><b>Swell arrival tracking.</b> Storm distance + period + decay tells you when the leading edge hits — to the hour.</li>
                <li><b>Category scale.</b> 6ft @ 14s is a Cat 3 (shoulder-to-head). 6ft @ 7s is Cat 1 (closed out). <em>Period matters.</em></li>
                <li><b>Spot-specific adjustments.</b> Blacks amplifies canyon swell 30–40%. Del Mar doesn't. The forecast knows.</li>
              </ul>
            </div>
            <div className="home-timeline-view">
              <div className="home-timeline-tabs">
                <span className="home-tl-tab on">Wave</span>
                <span className="home-tl-tab">Wind</span>
                <span className="home-tl-tab">Tide</span>
                <span className="home-tl-tab">All</span>
                <span style={{ marginLeft: 'auto', fontFamily: "'Geist Mono',monospace", fontSize: '10px', color: 'oklch(0.58 0.014 230)', letterSpacing: '0.1em', display: 'flex', alignItems: 'center' }}>
                  BLACKS · 16D
                </span>
              </div>
              <div className="home-tl-chart">
                <svg viewBox="0 0 600 180" preserveAspectRatio="none">
                  <g stroke="oklch(1 0 0 / 0.05)" strokeWidth="1">
                    <line x1="0" y1="45" x2="600" y2="45" />
                    <line x1="0" y1="90" x2="600" y2="90" />
                    <line x1="0" y1="135" x2="600" y2="135" />
                  </g>
                  {/* Tide curve */}
                  <path d="M0 110 Q 75 70 150 110 T 300 110 T 450 110 T 600 110" stroke="oklch(0.82 0.16 195)" strokeWidth="1.2" fill="none" opacity="0.4" />
                  {/* Wave height area */}
                  <path d="M0 120 L40 115 L80 100 L120 85 L160 65 L200 50 L240 40 L280 55 L320 75 L360 70 L400 90 L440 100 L480 95 L520 105 L560 115 L600 120 L600 180 L0 180 Z" fill="oklch(0.82 0.16 195 / 0.14)" />
                  <path d="M0 120 L40 115 L80 100 L120 85 L160 65 L200 50 L240 40 L280 55 L320 75 L360 70 L400 90 L440 100 L480 95 L520 105 L560 115 L600 120" stroke="oklch(0.82 0.16 195)" strokeWidth="2" fill="none" />
                  {/* Wind bars */}
                  <g fill="oklch(0.75 0.19 45)" opacity="0.65">
                    <rect x="20"  y="140" width="4" height="18" /><rect x="60"  y="144" width="4" height="14" />
                    <rect x="100" y="148" width="4" height="10" /><rect x="140" y="150" width="4" height="8"  />
                    <rect x="180" y="152" width="4" height="6"  /><rect x="220" y="150" width="4" height="8"  />
                    <rect x="260" y="142" width="4" height="16" /><rect x="300" y="138" width="4" height="20" />
                    <rect x="340" y="140" width="4" height="18" /><rect x="380" y="146" width="4" height="12" />
                    <rect x="420" y="148" width="4" height="10" /><rect x="460" y="146" width="4" height="12" />
                    <rect x="500" y="142" width="4" height="16" /><rect x="540" y="138" width="4" height="20" />
                    <rect x="580" y="136" width="4" height="22" />
                  </g>
                  {/* Swell arrival marker */}
                  <line x1="200" y1="10" x2="200" y2="170" stroke="oklch(0.82 0.14 85)" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="206" y="20" fill="oklch(0.82 0.14 85)" fontFamily="Geist Mono" fontSize="9" letterSpacing="1">NW ARRIVAL · SAT 6AM</text>
                  <circle cx="240" cy="40" r="4" fill="oklch(0.82 0.16 195)" />
                  <text x="250" y="36" fill="oklch(0.96 0.008 90)" fontFamily="Geist Mono" fontSize="10" fontWeight="600">7.8FT · 15S · CAT 4</text>
                  {/* Day labels */}
                  <g fill="oklch(0.58 0.014 230)" fontFamily="Geist Mono" fontSize="8" letterSpacing="1">
                    <text x="0"   y="178">SUN</text>
                    <text x="90"  y="178">MON</text>
                    <text x="180" y="178">TUE</text>
                    <text x="270" y="178">WED</text>
                    <text x="360" y="178">THU</text>
                    <text x="450" y="178">FRI</text>
                    <text x="540" y="178">SAT</text>
                  </g>
                </svg>
              </div>
              {/* Stormsurf category scale */}
              <div style={{ marginTop: '14px' }}>
                <div style={{ fontFamily: "'Geist Mono',monospace", fontSize: '10px', letterSpacing: '0.14em', color: 'oklch(0.58 0.014 230)', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Wave Category Scale
                </div>
                <div className="home-cat-scale">
                  {CAT_CHIPS.map(c => (
                    <div key={c.n} className="home-cat-chip" style={{ background: c.bg, color: c.color }}>{c.n}</div>
                  ))}
                </div>
                <div style={{ fontFamily: "'Geist Mono',monospace", fontSize: '9px', color: 'oklch(0.58 0.014 230)', display: 'flex', justifyContent: 'space-between', letterSpacing: '0.1em' }}>
                  <span>FLAT</span><span>WAIST</span><span>HEAD+</span><span>DOUBLE</span><span>MACKING</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SIONE ── */}
        <section id="sione" className="home-section">
          <div className="home-section-head home-reveal">
            <div className="home-eyebrow">
              <span className="home-dot" />
              Sione
            </div>
            <h2>Not a chatbot. <em>A surf-specific AI with access to everything.</em></h2>
            <p>Sione is the interface between you and everything we know about the ocean — live data, real physics, your personal history. Every answer comes with the reasoning, so you're not just getting predictions, you're learning to read the ocean.</p>
          </div>
          <div className="home-feats">
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">01 · RECOMMEND</span>
              <h3>"Should I surf Blacks tomorrow morning?"</h3>
              <p>A personalized yes or no with the reasoning — the specific swell direction hitting the window, the tide dropping through your ideal range, the offshore holding until 10am.</p>
            </div>
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">02 · ARRIVAL</span>
              <h3>"There's a storm at 42°N 155°W. When does it hit?"</h3>
              <p>Runs the actual great-circle calculation: storm distance, swell period, travel speed, decay. Tells you Saturday 6am with 15-second NW energy — not "surf's up soon."</p>
            </div>
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">03 · COMPARE</span>
              <h3>"Compare Cardiff and Swami's Thursday afternoon."</h3>
              <p>Pulls both forecasts, scores each to your preferences, flags the tradeoffs (bigger vs cleaner, crowd vs drive), and names the winner with confidence.</p>
            </div>
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">04 · EXPLAIN</span>
              <h3>"Will this south swell reach Malibu, or will Point Dume block it?"</h3>
              <p>Checks the spot's swell window, the incoming direction, the blocker geometry — and gives you a real answer backed by the bathymetry, not a hunch.</p>
            </div>
          </div>
        </section>

        {/* ── SESSION JOURNAL ── */}
        <section id="journal" className="home-section">
          <div className="home-section-head home-reveal">
            <div className="home-eyebrow">
              <span className="home-dot" />
              Session journal
            </div>
            <h2>The log that <em>makes you a better forecaster</em>.</h2>
            <p>Every session you log teaches mysurflife something about how you surf. Over time, your session history becomes a personal calibration dataset — connecting what was in the water to what you actually rated highly.</p>
          </div>
          <div className="home-feats home-feats-3">
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">AUTO-FILL</span>
              <h3>Log in 30 seconds.</h3>
              <p>You log spot, time, duration, rating. We pull the actual buoy, tide, and wind readings for that exact window — so your log is always complete, even if you write it three days later.</p>
            </div>
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">PROFILE</span>
              <h3>Build your preference profile.</h3>
              <p>After a handful of sessions at a spot, we know your sweet spot — the size, period, tide, and wind you rate highest. Private, yours, more accurate over time.</p>
            </div>
            <div className="home-feat home-reveal">
              <span className="home-feat-tag">CALIBRATE</span>
              <h3>Your personal calibration factor.</h3>
              <p>Some surfers consistently perceive waves bigger than buoys report. Some smaller. Your factor gets baked into every prediction Sione makes for you.</p>
            </div>
          </div>
        </section>

        {/* ── SPOTS ── */}
        <section id="spots" className="home-section">
          <div className="home-section-head home-reveal">
            <div className="home-eyebrow">
              <span className="home-dot" />
              Spot intelligence
            </div>
            <h2>9,500+ spots. <em>Intelligently understood.</em></h2>
            <p>Every spot is enriched beyond a name and a GPS pin. From Malibu to Margaret River, Lowers to Uluwatu — we know the buoys, the swell windows, the blockers, and the bathymetry that makes each break what it is.</p>
          </div>
          <div className="home-sources home-reveal">
            <span className="home-src-chip"><b>Buoys</b> · NOAA NDBC network</span>
            <span className="home-src-chip"><b>Swell window</b> · unobstructed fetch analysis</span>
            <span className="home-src-chip"><b>Blockers</b> · headlands, islands, reefs</span>
            <span className="home-src-chip"><b>Bathymetry</b> · canyon + shelf focusing</span>
            <span className="home-src-chip"><b>Break type</b> · reef, point, beach, river mouth</span>
            <span className="home-src-chip"><b>Tide sensitivity</b> · low / mid / high windows</span>
            <span className="home-src-chip"><b>Hazards</b> · rocks, crowds, currents</span>
            <span className="home-src-chip"><b>Wannasurf</b> · 9,500 global break DB</span>
          </div>
        </section>

        {/* ── CTA / SIGN IN ── */}
        <section className="home-section">
          <div className="home-cta-block home-reveal">
            <div>
              <div className="home-eyebrow" style={{ marginBottom: '16px' }}>
                <span className="home-dot" />
                Access by invitation
              </div>
              <h2>Sign in to <em>your</em> sessions.</h2>
              <p>Your data, your predictions, forever yours. Private by default — no ads, no selling, no ranking against other users. Just better sessions, fewer blown drives.</p>
              <div className="home-sources" style={{ marginTop: '8px' }}>
                <span className="home-src-chip">✓ Sessions are private</span>
                <span className="home-src-chip">✓ Global coverage</span>
                <span className="home-src-chip">✓ Works offline after load</span>
              </div>
            </div>
            <div className="home-inline-form">
              {ctaMode === 'requested' ? (
                <div className="home-request-done">
                  <h4>Request received. 🤙</h4>
                  <p>We'll review it and send an invite to <b>{reqEmail}</b> when a spot opens up.</p>
                </div>
              ) : ctaMode === 'request' ? (
                <>
                  {reqError && <div className="home-inline-error">{reqError}</div>}
                  <form onSubmit={handleRequestAccess}>
                    <label htmlFor="req-name">Name</label>
                    <input
                      id="req-name"
                      type="text"
                      placeholder="Your name"
                      autoComplete="name"
                      value={reqName}
                      onChange={e => setReqName(e.target.value)}
                      disabled={reqSubmitting}
                    />
                    <label htmlFor="req-email">Email</label>
                    <input
                      id="req-email"
                      type="email"
                      placeholder="you@email.com"
                      autoComplete="email"
                      value={reqEmail}
                      onChange={e => setReqEmail(e.target.value)}
                      disabled={reqSubmitting}
                    />
                    <label htmlFor="req-note">Where do you surf? <span style={{ opacity: 0.5 }}>(optional)</span></label>
                    <textarea
                      id="req-note"
                      rows={2}
                      placeholder="Home break, how you found us…"
                      value={reqNote}
                      onChange={e => setReqNote(e.target.value)}
                      disabled={reqSubmitting}
                    />
                    <button type="submit" className="home-go" disabled={reqSubmitting}>
                      {reqSubmitting ? 'Sending…' : 'Request access →'}
                    </button>
                    <div className="home-go-note">
                      Already have an account?{' '}
                      <button type="button" className="home-mode-link" onClick={() => setCtaMode('signin')}>
                        Sign in →
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  {error && <div className="home-inline-error">{error}</div>}
                  <form onSubmit={handleSignIn}>
                    <label htmlFor="cta-email">Email</label>
                    <input
                      id="cta-email"
                      type="email"
                      placeholder="you@email.com"
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={submitting}
                      ref={ctaEmailRef}
                    />
                    <label htmlFor="cta-pw">Password</label>
                    <input
                      id="cta-pw"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <button type="submit" className="home-go" disabled={submitting}>
                      {submitting ? 'Signing in…' : 'Sign in →'}
                    </button>
                    <div className="home-go-note">
                      Access is by invitation only.{' '}
                      <button type="button" className="home-mode-link" onClick={() => { setReqEmail(email); setCtaMode('request'); }}>
                        Request access →
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="home-footer">
        <div className="home-foot-inner">
          <div className="home-foot-brand-block">
            <div className="home-foot-brand">
              <Logo variant="mark" size={22} />
              mysurflife
            </div>
            <p>A personal surf intelligence platform. Real-time buoys, 16-day forecasts, and Sione — our AI that learns how you surf.</p>
          </div>
          <div className="home-foot-col">
            <h5>Product</h5>
            <ul>
              <li><a href="#forecast">Forecast</a></li>
              <li><a href="#sione">Sione</a></li>
              <li><a href="#journal">Journal</a></li>
              <li><a href="#spots">Spots</a></li>
            </ul>
          </div>
          <div className="home-foot-col">
            <h5>Data</h5>
            <ul>
              <li><a href="#">NOAA NDBC buoys</a></li>
              <li><a href="#">WaveWatch III</a></li>
              <li><a href="#">CO-OPS tides</a></li>
              <li><a href="#">Swell physics</a></li>
              <li><a href="#">Wannasurf DB</a></li>
            </ul>
          </div>
          <div className="home-foot-col">
            <h5>Company</h5>
            <ul>
              <li><a href="#">About</a></li>
              <li><a href="#">Privacy</a></li>
              <li><a href="#">Terms</a></li>
              <li><a href="#">Status</a></li>
              <li><a href="mailto:hello@mysurflife.com">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="home-foot-base">
          <span>© 2026 mysurflife · Made on the coast</span>
          <span>V0.4 BETA · SURFNET PHYSICS</span>
        </div>
      </footer>
    </div>
  );
}
