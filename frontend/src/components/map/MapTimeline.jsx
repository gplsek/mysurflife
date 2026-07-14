import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const MAX_H = 168;
const QUICK_JUMPS = [
  { label: 'NOW', h: 0 },
  { label: '+6h', h: 6 },
  { label: '+1d', h: 24 },
  { label: '+3d', h: 72 },
  { label: '+7d', h: 168 },
];

function fmtTime(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = ((h + 11) % 12) + 1;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

function shortDay(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * Windy-style forecast scrubber: one full-width bar with a play button, the
 * selected time, and a 7-day track banded by day. Always visible — the old
 * two-state compact/expanded design (with its synthetic sparkline) is gone.
 */
export default function MapTimeline({ curH, onCurHChange }) {
  const [playing, setPlaying] = useState(false);
  const rafRef  = useRef(null);
  const lastTRef = useRef(0);
  const NOW      = useRef(new Date());

  const setCurH = useCallback((h) => {
    onCurHChange?.(Math.max(0, Math.min(MAX_H, h)));
  }, [onCurHChange]);

  // Play: advance one forecast hour every 200 ms, wrap at the end
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    lastTRef.current = 0;
    const tick = (t) => {
      if (!lastTRef.current) lastTRef.current = t;
      if (t - lastTRef.current > 200) {
        setCurH((curH + 1) % (MAX_H + 1));
        lastTRef.current = t;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, curH, setCurH]);

  // Day cells across the full track (first cell is the remainder of today)
  const dayBand = useMemo(() => {
    const start = NOW.current;
    const result = [];
    let h = 0, dayIdx = 0;
    const startHour = start.getHours() + start.getMinutes() / 60;
    while (h < MAX_H) {
      const remaining = dayIdx === 0 ? (24 - startHour) : 24;
      const slice = Math.min(remaining, MAX_H - h);
      const d = new Date(start.getTime() + h * 3600 * 1000);
      const lbl = dayIdx === 0 ? 'Today' : shortDay(d);
      result.push({ lbl, num: d.getDate(), flex: (slice / MAX_H) * 100, today: dayIdx === 0 });
      h += slice;
      dayIdx++;
    }
    return result;
  }, []);

  const curDate  = new Date(NOW.current.getTime() + curH * 3600 * 1000);
  const whenMain = curH === 0 ? 'Now'
    : `${curDate.toLocaleDateString(undefined, { weekday: 'short' })} ${fmtTime(curDate)}`;
  const whenSub  = curH === 0 ? fmtTime(curDate) : `+${curH}h`;
  const pct      = (curH / MAX_H) * 100;
  const activeJump = QUICK_JUMPS.find(q => q.h === curH);

  return (
    <div className="mv-timeline">
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

      <div className="mv-tl-when">
        <span className="mv-tl-dot" />
        <span className="mv-tl-label">{whenMain}</span>
        <span className="mv-tl-sub">{whenSub}</span>
      </div>

      <div className="mv-tl-track">
        <div className="mv-tl-days">
          {dayBand.map((d, i) => (
            <div key={i} className={`mv-tl-day${d.today ? ' today' : ''}`} style={{ flex: `0 0 ${d.flex}%` }}>
              {d.lbl}{d.flex > 8 && <span className="mv-tl-day-num">{d.num}</span>}
            </div>
          ))}
        </div>
        <div className="mv-tl-rail">
          <div className="mv-tl-fill" style={{ width: `${pct}%` }} />
          <input
            className="mv-tl-range"
            type="range"
            min="0"
            max={MAX_H}
            step="1"
            value={curH}
            onChange={e => setCurH(parseInt(e.target.value, 10))}
            aria-label="Forecast hours from now"
          />
        </div>
      </div>

      <div className="mv-tl-quick">
        {QUICK_JUMPS.map(q => (
          <button
            key={q.h}
            className={activeJump?.h === q.h ? 'on' : ''}
            onClick={() => setCurH(q.h)}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
