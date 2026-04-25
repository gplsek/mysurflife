import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const HOURS = 169;
const QUICK_JUMPS = [
  { label: 'NOW', h: 0 },
  { label: '+6h', h: 6 },
  { label: '+1d', h: 24 },
  { label: '+3d', h: 72 },
  { label: '+7d', h: 168 },
];

// Synthetic forecast data (same formulas as prototype) — swap in real API data when available
function buildData() {
  const arr = [];
  for (let h = 0; h < HOURS; h++) {
    const phase1 = Math.exp(-Math.pow((h - 36) / 22, 2)) * 4.2;
    const phase2 = Math.exp(-Math.pow((h - 132) / 28, 2)) * 3.0;
    const swell = +(3.6 + phase1 + phase2 + Math.sin(h * 0.7) * 0.15 + Math.sin(h * 0.21) * 0.25).toFixed(1);
    const period = +(11 + (phase1 + phase2) * 0.9 + Math.sin(h * 0.18) * 0.4).toFixed(0);
    const dayH = (h + 14) % 24;
    const wind = +(4 + Math.sin(h * 0.05) * 3 + Math.max(0, Math.sin((dayH - 6) * Math.PI / 12)) * 12 + (h > 60 && h < 90 ? 6 : 0)).toFixed(0);
    const tide = +(2.5 + Math.sin(h * (2 * Math.PI / 12.4)) * 1.8).toFixed(1);
    arr.push({ swell, period, wind, tide });
  }
  return arr;
}

const DATA = buildData();

function rateAt(h) {
  const d = DATA[Math.max(0, Math.min(HOURS - 1, h))];
  return +Math.max(1.5, Math.min(5, d.swell * 0.45 + (d.period - 10) * 0.18 - d.wind * 0.05)).toFixed(1);
}

function fmtTime(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = ((h + 11) % 12) + 1;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

function shortDay(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
}

function getDelta(cur, base) {
  const diff = +(cur - base).toFixed(1);
  if (Math.abs(diff) < 0.05) return { txt: '', cls: '' };
  const sign = diff > 0 ? '+' : '';
  return { txt: `${sign}${diff}`, cls: diff > 0 ? 'up' : 'dn' };
}

export default function MapTimeline({ curH, onCurHChange, onExpandChange }) {
  const [expanded, setExpanded] = useState(false);
  const [spanH, setSpanH]       = useState(48);
  const [playing, setPlaying]   = useState(false);
  const rafRef                  = useRef(null);
  const lastTRef                = useRef(0);
  const NOW                     = useRef(new Date());

  const setCurH = useCallback((h) => {
    onCurHChange?.(Math.max(0, Math.min(168, h)));
  }, [onCurHChange]);

  // Play animation
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    lastTRef.current = 0;
    const tick = (t) => {
      if (!lastTRef.current) lastTRef.current = t;
      if (t - lastTRef.current > 250) {
        setCurH((curH + 1) % (spanH + 1));
        lastTRef.current = t;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, curH, spanH, setCurH]);

  // Stop playing when collapsed; notify parent of expand state
  useEffect(() => {
    if (!expanded) setPlaying(false);
    onExpandChange?.(expanded);
  }, [expanded, onExpandChange]);

  // ── Sparkline paths ──
  const { lineD, areaD, windD, nowX } = useMemo(() => {
    const W = 1000, swMin = 1, swMax = 16, wnMax = 30;
    const xAt = (h) => (h / spanH) * W;
    const yAt = (s) => 62 - ((Math.min(swMax, Math.max(swMin, s)) - swMin) / (swMax - swMin)) * 44;
    const wyAt = (w) => 62 - Math.min(1, w / wnMax) * 44;
    const linePts = [], windPts = [];
    const last = Math.min(spanH, DATA.length - 1);
    for (let h = 0; h <= last; h++) {
      linePts.push(`${xAt(h).toFixed(1)} ${yAt(DATA[h].swell).toFixed(1)}`);
      windPts.push(`${xAt(h).toFixed(1)} ${wyAt(DATA[h].wind).toFixed(1)}`);
    }
    const lineD = 'M ' + linePts.join(' L ');
    return {
      lineD,
      areaD: lineD + ` L ${W} 62 L 0 62 Z`,
      windD: 'M ' + windPts.join(' L '),
      nowX: xAt(0),
    };
  }, [spanH]);

  // ── Cursor position ──
  const selX    = (curH / spanH) * 1000;
  const halfBand = (1000 / spanH) * 0.6;

  // ── Day band ──
  const dayBand = useMemo(() => {
    const start  = NOW.current;
    const result = [];
    let h = 0, dayIdx = 0;
    const startHour = start.getHours() + start.getMinutes() / 60;
    while (h < spanH) {
      const remaining = dayIdx === 0 ? (24 - startHour) : 24;
      const slice = Math.min(remaining, spanH - h);
      const d = new Date(start.getTime() + h * 3600 * 1000);
      const lbl = dayIdx === 0 ? 'Today' : dayIdx === 1 ? 'Tmrw' : shortDay(d);
      result.push({ lbl, num: d.getDate(), flex: (slice / spanH) * 100, today: dayIdx === 0 });
      h += slice;
      dayIdx++;
    }
    return result;
  }, [spanH]);

  // ── Readout at curH ──
  const d   = DATA[Math.min(curH, HOURS - 1)];
  const d0  = DATA[0];
  const ds  = getDelta(d.swell, d0.swell);
  const dp  = getDelta(d.period, d0.period);
  const dw  = getDelta(d.wind, d0.wind);
  const dt  = getDelta(d.tide, d0.tide);
  const r   = rateAt(curH);
  const dr  = getDelta(r, rateAt(0));

  // ── Compact pill label ──
  const curDate   = new Date(NOW.current.getTime() + curH * 3600 * 1000);
  const compLabel = curH === 0 ? 'Now' : curH < 24 ? `+${curH}h` : `+${(curH / 24).toFixed(1).replace(/\.0$/, '')}d`;
  const compSub   = `${curDate.toLocaleDateString(undefined, { weekday: 'short' })} · ${fmtTime(curDate)}`;
  const activeJump = QUICK_JUMPS.find(q => q.h === curH);

  // ── Expanded pill header ──
  const nowDate = NOW.current;
  const dayDiff = (d) => {
    const bd = new Date(d); bd.setHours(0,0,0,0);
    const bn = new Date(nowDate); bn.setHours(0,0,0,0);
    return Math.round((bd - bn) / 86400000);
  };
  const dd = dayDiff(curDate);
  const dayLbl = curH === 0 ? 'Today' : dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow'
    : curDate.toLocaleDateString(undefined, { weekday: 'long' });
  const deltaLbl = curH === 0 ? '· now' : `· +${curH}h`;

  // ── Span switch ──
  const switchSpan = (s) => {
    setSpanH(s);
    if (curH > s) setCurH(s);
  };

  return (
    <div className={`mv-timeline${expanded ? ' open' : ''}`}>

      {/* ── Compact pill ── */}
      <div className="mv-tl-compact">
        <span className="mv-tl-when">
          <span className="mv-tl-dot" />
          <span className="mv-tl-label">{compLabel}</span>
          <span className="mv-tl-sub">{compSub}</span>
        </span>
        <div className="mv-tl-quick">
          {QUICK_JUMPS.map(q => (
            <button
              key={q.h}
              className={activeJump?.h === q.h ? 'on' : ''}
              onClick={() => {
                const want = q.h <= 48 ? 48 : q.h <= 72 ? 72 : 168;
                setSpanH(want);
                setCurH(q.h);
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
        <button className="mv-tl-expand" onClick={() => setExpanded(true)} title="Expand timeline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 14 12 9 17 14"/>
          </svg>
        </button>
      </div>

      {/* ── Expanded panel ── */}
      <div className="mv-tl-expanded">
        <div className="mv-tl-head">
          <button
            className="mv-tl-play"
            title={playing ? 'Pause' : 'Play forecast'}
            onClick={() => setPlaying(p => !p)}
          >
            {playing
              ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
              : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            }
          </button>
          <div className="mv-tl-now-pill">
            <span className="mv-tl-dot" />
            <span className="mv-tl-np-day">{dayLbl}</span>
            <span className="mv-tl-np-time">{fmtTime(curDate)}</span>
            <span className="mv-tl-np-delta">{deltaLbl}</span>
          </div>
          <div className="mv-tl-seg">
            {[48, 72, 168].map(s => (
              <button key={s} className={spanH === s ? 'on' : ''} onClick={() => switchSpan(s)}>
                {s === 48 ? '48h' : s === 72 ? '3d' : '7d'}
              </button>
            ))}
          </div>
          <button className="mv-tl-collapse" onClick={() => setExpanded(false)} title="Collapse">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 10 12 15 17 10"/>
            </svg>
          </button>
        </div>

        {/* Sparkline + slider */}
        <div className="mv-tl-track-wrap">
          {/* Day band */}
          <div className="mv-tl-days">
            {dayBand.map((d, i) => (
              <div key={i} className={`mv-tl-day${d.today ? ' today' : ''}`} style={{ flex: `0 0 ${d.flex}%` }}>
                {d.lbl} <span className="mv-tl-day-num">{d.num}</span>
              </div>
            ))}
          </div>

          {/* SVG sparkline */}
          <svg className="mv-tl-spark" viewBox="0 0 1000 70" preserveAspectRatio="none">
            <path className="mv-tl-spark-area" d={areaD} />
            <path className="mv-tl-spark-line" d={lineD} />
            <path className="mv-tl-spark-wind" d={windD} />
            <line className="mv-tl-now-cursor" x1={nowX} y1="16" x2={nowX} y2="62" />
            <rect className="mv-tl-sel-glow" x={Math.max(0, selX - halfBand)} y="16" width={halfBand * 2} height="46" />
            <line className="mv-tl-sel-cursor" x1={selX} y1="16" x2={selX} y2="62" />
          </svg>

          {/* Range slider */}
          <input
            className="mv-tl-range"
            type="range"
            min="0"
            max={spanH}
            step="1"
            value={curH}
            onChange={e => setCurH(parseInt(e.target.value, 10))}
            aria-label="Forecast hours from now"
          />
        </div>

        {/* Readout */}
        <div className="mv-tl-readout">
          <div className="mv-tl-cell">
            <span className="mv-tl-k">Swell</span>
            <span className="mv-tl-v">{d.swell.toFixed(1)}<span className="mv-tl-u">ft</span></span>
            {ds.txt && <span className={`mv-tl-delta ${ds.cls}`}>{ds.txt}</span>}
          </div>
          <div className="mv-tl-cell">
            <span className="mv-tl-k">Period</span>
            <span className="mv-tl-v">{d.period}<span className="mv-tl-u">s</span></span>
            {dp.txt && <span className={`mv-tl-delta ${dp.cls}`}>{dp.txt}</span>}
          </div>
          <div className="mv-tl-cell">
            <span className="mv-tl-k">Wind</span>
            <span className="mv-tl-v">{d.wind}<span className="mv-tl-u">mph</span></span>
            {dw.txt && <span className={`mv-tl-delta ${dw.cls === 'up' ? 'dn' : dw.cls === 'dn' ? 'up' : ''}`}>{dw.txt}</span>}
          </div>
          <div className="mv-tl-cell">
            <span className="mv-tl-k">Tide</span>
            <span className="mv-tl-v">{d.tide.toFixed(1)}<span className="mv-tl-u">ft</span></span>
            {dt.txt && <span className={`mv-tl-delta ${dt.cls}`}>{dt.txt}</span>}
          </div>
          <div className="mv-tl-cell">
            <span className="mv-tl-k">Avg rating</span>
            <span className="mv-tl-v">{r.toFixed(1)} / 5</span>
            {dr.txt && <span className={`mv-tl-delta ${dr.cls}`}>{dr.txt}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
