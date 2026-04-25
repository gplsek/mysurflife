import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { getAuthHeaders } from '../supabaseClient';
import LogoPulse from '../design/LogoPulse';

const SUGGESTED_PROMPTS = [
  "Should I surf Cardiff or Del Mar this afternoon?",
  "What's firing in San Diego right now?",
  "Compare Blacks Beach and Swamis",
  "When's the best window to surf this week?",
  "Is the swell building or dropping?",
];

const FAVORITE_SPOTS = [
  { id: 'cardiff-reef',  name: 'Cardiff Reef', live: true  },
  { id: 'blacks-beach',  name: 'Blacks Beach',  live: false },
  { id: 'del-mar',       name: 'Del Mar',        live: false },
  { id: 'swamis',        name: "Swami's",        live: false },
];

const PLACEHOLDER_PREFS = [
  { w: '0.82', t: 'Clean over big — onshore wind weighs more than size bonus.' },
  { w: '0.71', t: 'Mid-to-dropping tide preference at reef breaks.' },
  { w: '0.64', t: 'Fish range (3–5ft, 11–14s) rated higher than average.' },
  { w: '0.58', t: 'Low crowd bonus — morning sessions rated higher vs model.' },
];

// ── SVG helpers ───────────────────────────────────────────────────────────────

function D1Mark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64"
      style={{ color: 'var(--fire)', '--dot': 'var(--accent)' }}>
      <g transform="translate(32 40)" stroke="currentColor" fill="none" strokeLinecap="round">
        <path d="M-14 0 A14 14 0 0 1 14 0" strokeWidth="2"/>
        <path d="M-21 0 A21 21 0 0 1 21 0" strokeWidth="1.6" opacity="0.5"/>
        <path d="M-28 0 A28 28 0 0 1 28 0" strokeWidth="1.2" opacity="0.25"/>
      </g>
      <circle cx="32" cy="40" r="4" fill="var(--dot, currentColor)"/>
    </svg>
  );
}

function WindDir({ deg }) {
  if (deg == null) return <span className="cop-muted">—</span>;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return <span>{dirs[Math.round(deg / 22.5) % 16]}</span>;
}

function renderBold(text) {
  return (text || '').split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <b key={i}>{part.slice(2, -2)}</b>
      : part
  );
}

// ── Score ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const pct = Math.min((score || 0) / 10, 1);
  const offset = circ * (1 - pct);
  const color = score >= 7 ? 'var(--accent)'
               : score >= 5 ? 'oklch(0.82 0.14 85)'
               : 'oklch(0.72 0.16 20)';
  return (
    <div className="cop-score-ring">
      <svg viewBox="0 0 62 62">
        <circle cx="31" cy="31" r={r} fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth="4"/>
        <circle cx="31" cy="31" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${circ}`}
          strokeDashoffset={offset}
          transform="rotate(-90 31 31)"/>
      </svg>
      <div className="cop-score-ring-num" style={{ color }}>
        {score != null ? score.toFixed(1) : '—'}
      </div>
    </div>
  );
}

// ── Tool call chip ────────────────────────────────────────────────────────────

function ToolCallChip({ name, params, done }) {
  return (
    <div className={`cop-tool-call${done ? ' done' : ''}`}>
      <svg className="cop-tc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" width="12" height="12">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
      <span className="cop-tc-name">{name}</span>
      {params && <span className="cop-tc-params">{params}</span>}
      {done
        ? <span className="cop-tc-check">✓</span>
        : <span className="cop-tc-spinner"/>}
    </div>
  );
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

function SpotCardArtifact({ data }) {
  if (!data) return null;
  const { spot_name, spot_id, score, wave_height_ft, surf_height_ft,
    period_sec, wind_speed_mph, wind_direction, tide_ft,
    distance_mi, drive_min, best_window, tag, sub,
    size_trend, period_trend, wind_trend, tide_trend } = data;

  const metrics = [
    { lbl: 'SIZE',   val: wave_height_ft, unit: 'ft', trend: size_trend },
    { lbl: 'PERIOD', val: period_sec,     unit: 's',  trend: period_trend },
    { lbl: 'WIND',   val: wind_speed_mph, unit: 'mph',trend: wind_trend,
      extra: wind_direction != null ? <WindDir deg={wind_direction}/> : null },
    { lbl: 'TIDE',   val: tide_ft,        unit: 'ft', trend: tide_trend },
  ];

  return (
    <div className="cop-spot-card">
      <div className="cop-spot-card-head">
        <ScoreRing score={score}/>
        <div className="cop-spot-card-info">
          <div className="cop-spot-name">
            {spot_name || spot_id}
            {tag && <span className="cop-spot-tag">{tag}</span>}
          </div>
          {sub && <div className="cop-spot-sub"><em>{sub}</em></div>}
          {(distance_mi != null || drive_min) && (
            <div className="cop-spot-dist">
              {distance_mi != null && `${distance_mi} mi`}{distance_mi && drive_min ? ' · ' : ''}{drive_min && `${drive_min} min drive`}
            </div>
          )}
        </div>
      </div>
      <div className="cop-spot-metrics">
        {metrics.map(m => (
          <div key={m.lbl} className="cop-metric">
            <span className="cop-metric-lbl">{m.lbl}</span>
            <span className="cop-metric-val">
              {m.val != null
                ? <>{m.val}<span className="cop-metric-unit"> {m.unit}{m.extra ? <> {m.extra}</> : null}</span></>
                : '—'}
            </span>
            {m.trend && (
              <span className={`cop-metric-trend ${m.trend.startsWith('↑') ? 'up' : m.trend.startsWith('↓') ? 'down' : ''}`}>
                {m.trend}
              </span>
            )}
          </div>
        ))}
      </div>
      {best_window && (
        <div className="cop-spot-window">
          <span className="cop-spot-window-lbl">BEST WINDOW</span>
          <span className="cop-spot-window-val">{best_window}</span>
        </div>
      )}
    </div>
  );
}

function WhyArtifact({ data }) {
  if (!data) return null;
  return (
    <div className="cop-why">
      <h4 className="cop-why-head">{data.title || 'Why this recommendation'}</h4>
      <ul className="cop-why-list">
        {(data.bullets || []).map((b, i) => (
          <li key={i} className={`cop-why-item ${b.sign === '+' ? 'plus' : b.sign === '-' ? 'minus' : ''}`}>
            {renderBold(b.text)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonArtifact({ data }) {
  if (!data) return null;
  const spots = data.ranked_spots || [];
  const bestId = data.best_spot_id || spots[0]?.spot_id;
  return (
    <div className="cop-cmp">
      <div className="cop-cmp-head">
        <span className="cop-cmp-title">{data.title || 'Spot Comparison'}</span>
        <span className="cop-eyebrow">{spots.length} SPOTS</span>
      </div>
      <table className="cop-cmp-table">
        <thead>
          <tr><th>Spot</th><th>Score</th><th>Wave</th><th>Surf</th><th>Wind</th></tr>
        </thead>
        <tbody>
          {spots.map((s, i) => {
            const isWinner = s.spot_id === bestId || (!bestId && i === 0);
            const sc = s.score;
            const pillCls = sc >= 7 ? 'good' : sc >= 5 ? 'ok' : 'poor';
            return (
              <tr key={s.spot_id || i} className={isWinner ? 'cop-cmp-winner' : ''}>
                <td className="cop-cmp-name">{s.spot_name || s.spot_id}</td>
                <td><span className={`cop-pill cop-pill-${pillCls}`}>{sc != null ? sc.toFixed(1) : '—'}</span></td>
                <td>{s.wave_height_ft != null ? `${s.wave_height_ft}ft` : '—'}</td>
                <td>{s.surf_height_ft != null ? `${s.surf_height_ft}ft` : '—'}</td>
                <td>{s.wind_speed_mph != null ? `${s.wind_speed_mph}mph` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TideTag({ hilo }) {
  if (!hilo || !hilo.length) return null;
  const next = hilo[0];
  return (
    <span className="cop-tide-tag">
      {next.type === 'H' ? '▲' : '▼'}{' '}
      {next.v != null ? `${next.v.toFixed(1)}ft` : ''}{' '}
      {next.t ? next.t.slice(-5) : ''}
    </span>
  );
}

function ConditionsTimelineArtifact({ data }) {
  if (!data) return null;
  const points = (data.points || []).slice(0, 8);
  return (
    <div className="cop-artifact cop-timeline">
      <div className="cop-artifact-head">
        <span className="cop-artifact-label">FORECAST</span>
        <span className="cop-artifact-name">{data.spot_name} · next {data.hours}h</span>
        {data.tide_hilo?.length > 0 && <TideTag hilo={data.tide_hilo}/>}
      </div>
      <div className="cop-timeline-rows">
        {points.map((pt) => (
          <div key={pt.hour} className="cop-timeline-row">
            <span className="cop-timeline-hour">+{pt.hour}h</span>
            <span className="cop-timeline-wave">
              {pt.surf_height_ft != null ? `${pt.surf_height_ft}ft`
               : pt.wave_height_ft != null ? `${pt.wave_height_ft}ft` : '—'}
            </span>
            <span className="cop-timeline-period">{pt.period_sec != null ? `${pt.period_sec}s` : ''}</span>
            <span className="cop-timeline-wind">
              {pt.wind_speed_mph != null ? `${pt.wind_speed_mph}mph` : ''}
              {pt.wind_direction != null ? <> <WindDir deg={pt.wind_direction}/></> : null}
            </span>
            {pt.tide_ft != null && (
              <span className="cop-timeline-tide">
                {pt.tide_state === 'high' || pt.tide_state === 'rising_high' ? '▲'
                 : pt.tide_state === 'low' || pt.tide_state === 'rising_low' ? '▼' : '~'}
                {' '}{pt.tide_ft}ft
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EquipmentArtifact({ data }) {
  if (!data) return null;
  const boards = data.boards || [];
  return (
    <div className="cop-eq-card">
      <div className="cop-cmp-head">
        <span className="cop-cmp-title">Equipment</span>
        <span className="cop-eyebrow">YOUR QUIVER</span>
      </div>
      {boards.map((b, i) => (
        <div key={i} className={`cop-eq-row${b.is_primary ? ' cop-eq-primary' : ''}`}>
          <svg className="cop-eq-icon" viewBox="0 0 44 32"
            stroke={b.is_primary ? 'var(--accent)' : 'var(--fg-2)'}
            fill="none" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 16 Q22 4 40 16 Q22 28 4 16 Z"/>
            <path d="M22 28 L22 31"/>
          </svg>
          <div className="cop-eq-main">
            <div className="cop-eq-tag">
              {b.is_primary
                ? `PRIMARY${b.confidence ? ` · ${b.confidence}% CONFIDENCE` : ''}`
                : `BACKUP · ${b.condition || 'IF NEEDED'}`}
            </div>
            <div className="cop-eq-name">{b.name}</div>
            {b.rationale && <div className="cop-eq-rationale">{renderBold(b.rationale)}</div>}
          </div>
        </div>
      ))}
      {data.expect_note && (
        <div className="cop-eq-expect">
          <span className="cop-eq-expect-lbl">EXPECT</span>
          <span className="cop-eq-expect-text">{data.expect_note}</span>
        </div>
      )}
    </div>
  );
}

function WindChartArtifact({ data }) {
  if (!data || !data.points || data.points.length < 2) return null;
  const pts = data.points;
  const maxWind = Math.max(...pts.map(p => p.wind_mph || 0), 1);
  const W = 700, H = 120, PAD_B = 22;
  const chartH = H - PAD_B;
  const nowIdx = data.now_index ?? 1;

  const xs = pts.map((_, i) => Math.round((i / (pts.length - 1)) * W));
  const ys = pts.map(p => Math.round(chartH * (1 - (p.wind_mph || 0) / maxWind * 0.85) + 4));
  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x} ${ys[i]}`).join(' ');
  const fillPath = `${linePath} L${W} ${chartH} L0 ${chartH} Z`;
  const nowX = xs[nowIdx] || 100;

  return (
    <div className="cop-chart-block">
      <h4 className="cop-chart-title">
        {data.spot_name ? `Wind · ${data.spot_name}` : 'Wind Timeline'}
      </h4>
      {data.best_window && (
        <div className="cop-chart-sub">Best window: {data.best_window} — shaded = onshore</div>
      )}
      <svg className="cop-chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {pts.map((p, i) => p.is_onshore ? (
          <rect key={i}
            x={i > 0 ? Math.round((xs[i - 1] + xs[i]) / 2) : 0}
            y="0"
            width={Math.round(((i < pts.length - 1 ? (xs[i] + xs[i + 1]) / 2 : W)) - (i > 0 ? (xs[i - 1] + xs[i]) / 2 : 0))}
            height={chartH}
            fill="oklch(0.72 0.16 20 / 0.1)"/>
        ) : null)}
        <g stroke="oklch(1 0 0 / 0.05)" strokeWidth="1">
          <line x1="0" y1={chartH * 0.35} x2={W} y2={chartH * 0.35}/>
          <line x1="0" y1={chartH * 0.70} x2={W} y2={chartH * 0.70}/>
        </g>
        <path d={fillPath} fill="oklch(0.75 0.19 45 / 0.08)"/>
        <path d={linePath} stroke="var(--fire)" strokeWidth="2" fill="none"/>
        {pts.map((p, i) => (
          <circle key={i} cx={xs[i]} cy={ys[i]} r="3"
            fill={i >= nowIdx && i <= nowIdx + 2 ? 'var(--accent)' : 'var(--fire)'}/>
        ))}
        <line x1={nowX} y1="0" x2={nowX} y2={chartH}
          stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3"/>
        <text x={nowX + 5} y="13" fill="var(--accent)"
          fontFamily="Geist Mono" fontSize="10" fontWeight="600">NOW</text>
        <g fill="var(--fg-2)" fontFamily="Geist Mono" fontSize="9" textAnchor="middle">
          {pts.map((p, i) => p.hour_label
            ? <text key={i} x={xs[i]} y={H - 4}>{p.hour_label}</text>
            : null)}
        </g>
        <text x="8" y="20" fill="var(--muted)"
          fontFamily="Geist Mono" fontSize="9" letterSpacing="1">MPH</text>
      </svg>
      <div className="cop-chart-legend">
        <span><span className="cop-legend-dot" style={{ background: 'var(--accent)' }}/> GLASSY</span>
        <span><span className="cop-legend-dot" style={{ background: 'var(--fire)' }}/> WIND</span>
        <span><span className="cop-legend-swatch" style={{ background: 'oklch(0.72 0.16 20 / 0.3)' }}/> ONSHORE</span>
      </div>
    </div>
  );
}

function SessionLogArtifact({ data }) {
  if (!data) return null;
  const { spot_name, date, duration_str, board, rating,
    wind_quality, wave_size, shape, crowd, fun_factor, saved, compare } = data;
  const fields = [
    ['WIND',       wind_quality],
    ['WAVE SIZE',  wave_size],
    ['SHAPE',      shape],
    ['CROWD',      crowd],
    ['FUN FACTOR', fun_factor],
  ].filter(([, v]) => v);

  return (
    <div className="cop-sess-form">
      <div className="cop-sess-title-row">
        <h4 className="cop-sess-title">Session · {spot_name}</h4>
        {saved && (
          <span className="cop-sess-saved">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            saved
          </span>
        )}
      </div>
      <div className="cop-sess-sub">
        {[date, duration_str, board].filter(Boolean).join(' · ')}
      </div>
      {rating != null && (
        <div className="cop-sess-field">
          <label className="cop-sess-label">OVERALL RATING</label>
          <div className="cop-sess-rating-row">
            {Array.from({ length: 10 }, (_, i) => {
              const n = i + 1;
              const filled = n < Math.round(rating);
              const sel    = n === Math.round(rating);
              return (
                <div key={i} className={`cop-sess-dot${filled ? ' on' : ''}${sel ? ' sel' : ''}`}>{n}</div>
              );
            })}
          </div>
        </div>
      )}
      {fields.length > 0 && (
        <div className="cop-sess-grid">
          {fields.map(([k, v]) => (
            <div key={k} className="cop-sess-field">
              <label className="cop-sess-label">{k}</label>
              <div className="cop-sess-val">{v}</div>
            </div>
          ))}
        </div>
      )}
      {compare && (
        <div className="cop-sess-compare">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
            strokeWidth="1.6" strokeLinecap="round" width="14" height="14" style={{ flexShrink: 0 }}>
            <path d="M12 2v20M2 12h20"/>
          </svg>
          <div>
            <b style={{ color: 'var(--accent)' }}>Prediction held up.</b>
            {' '}Model said {compare.predicted}, you rated {compare.actual}.
            {compare.note ? ` ${compare.note}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function SwellArrivalArtifact({ data }) {
  if (!data || !data.arrivals?.length) return null;

  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="cop-artifact">
      <div className="cop-artifact-head">
        <span className="cop-artifact-label">SWELL ARRIVAL</span>
        <span className="cop-artifact-name">{data.spot_name}</span>
      </div>
      {data.narrative && (
        <div style={{ padding: '10px 14px 4px', fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.55 }}>
          {data.narrative.split('\n').map((line, i) => <div key={i}>{line || ' '}</div>)}
        </div>
      )}
      <div className="cop-timeline-rows">
        {data.arrivals.map((arr, ai) => (
          <React.Fragment key={ai}>
            {arr.peak_arrival && (
              <div className="cop-timeline-row" style={{ background: 'oklch(0.82 0.16 195 / 0.04)' }}>
                <span className="cop-timeline-hour" style={{ color: 'var(--accent)' }}>
                  {arr.storm_label || `Storm ${ai + 1}`}
                </span>
                <span className="cop-timeline-wave">
                  {arr.peak_arrival.swell_height_ft != null
                    ? `${arr.peak_arrival.swell_height_ft.toFixed(1)}ft`
                    : '—'}
                </span>
                <span className="cop-timeline-period">
                  {arr.peak_arrival.period_s}s
                </span>
                <span className="cop-timeline-wind" style={{ color: 'var(--fg-2)', fontSize: 11 }}>
                  Peak · {fmtTime(arr.peak_arrival.arrival_utc)}
                </span>
              </div>
            )}
            {arr.first_arrival && arr.first_arrival.period_s !== arr.peak_arrival?.period_s && (
              <div className="cop-timeline-row">
                <span className="cop-timeline-hour">first</span>
                <span className="cop-timeline-wave">
                  {arr.first_arrival.swell_height_ft != null
                    ? `${arr.first_arrival.swell_height_ft.toFixed(1)}ft`
                    : '—'}
                </span>
                <span className="cop-timeline-period">{arr.first_arrival.period_s}s</span>
                <span className="cop-timeline-wind" style={{ color: 'var(--fg-2)', fontSize: 11 }}>
                  {fmtTime(arr.first_arrival.arrival_utc)}
                </span>
              </div>
            )}
            {(arr.distance_nm || arr.bearing_from_spot) && (
              <div style={{ padding: '4px 14px 8px', fontSize: 11,
                fontFamily: 'var(--font-mono)', color: 'var(--muted)', letterSpacing: '0.06em' }}>
                {arr.distance_nm != null ? `${Math.round(arr.distance_nm)} nm` : ''}
                {arr.distance_nm && arr.bearing_from_spot != null ? ' · ' : ''}
                {arr.bearing_from_spot != null ? `${Math.round(arr.bearing_from_spot)}° bearing` : ''}
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function Artifact({ type, data, title }) {
  if (type === 'spot_summary')        return <SpotCardArtifact data={data}/>;
  if (type === 'spot_comparison')     return <ComparisonArtifact data={data}/>;
  if (type === 'conditions_timeline') return <ConditionsTimelineArtifact data={data}/>;
  if (type === 'why')                 return <WhyArtifact data={data}/>;
  if (type === 'equipment')           return <EquipmentArtifact data={data}/>;
  if (type === 'wind_chart')          return <WindChartArtifact data={data}/>;
  if (type === 'session_log')         return <SessionLogArtifact data={data}/>;
  if (type === 'swell_arrival')       return <SwellArrivalArtifact data={data}/>;
  return null;
}

// ── Message components ────────────────────────────────────────────────────────

function UserMessage({ content, time }) {
  return (
    <div className="cop-msg cop-msg-user">
      <div className="cop-msg-avatar cop-avatar-user">YOU</div>
      <div className="cop-msg-body">
        <div className="cop-msg-meta"><b>You</b>{time && <span>{time}</span>}</div>
        <div className="cop-msg-content">{content}</div>
      </div>
    </div>
  );
}

function AssistantMessage({ content, artifacts, tools_called, time }) {
  return (
    <div className="cop-msg cop-msg-bot">
      <div className="cop-msg-avatar cop-avatar-bot"><D1Mark size={18}/></div>
      <div className="cop-msg-body">
        <div className="cop-msg-meta">
          <b>Copilot</b>
          {time && <span>{time}</span>}
          {tools_called?.length > 0 && (
            <><span>·</span><span>{tools_called.length} tool{tools_called.length !== 1 ? 's' : ''}</span></>
          )}
        </div>
        <div className="cop-tool-calls">
          {tools_called?.map((tc, i) => (
            <ToolCallChip key={i} name={tc.name} params={tc.params_summary} done/>
          ))}
        </div>
        {content && <div className="cop-msg-content">{content}</div>}
        {artifacts?.map((a, i) => (
          <Artifact key={i} type={a.type} data={a.data} title={a.title}/>
        ))}
      </div>
    </div>
  );
}

function ThinkingMessage() {
  return (
    <div className="cop-msg cop-msg-bot">
      <div className="cop-msg-avatar cop-avatar-bot"><D1Mark size={18}/></div>
      <div className="cop-msg-body">
        <div className="cop-typing"><span/><span/><span/></div>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function Copilot({ context }) {
  const { user } = useAuth();
  const [messages, setMessages]           = useState([]);
  const [input, setInput]                 = useState('');
  const [loading, setLoading]             = useState(false);
  const [allToolsCalled, setAllToolsCalled] = useState([]);
  const [profile, setProfile]             = useState({});
  const threadRef = useRef(null);
  const inputRef  = useRef(null);

  const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : 'JP';

  useEffect(() => {
    if (!user) return;
    getAuthHeaders().then(headers =>
      fetch('/api/user/profile', { headers })
        .then(r => r.ok ? r.json() : { profile: {} })
        .then(data => setProfile(data.profile || {}))
        .catch(() => {})
    );
  }, [user]);

  const scrollToBottom = useCallback(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, []);
  useEffect(scrollToBottom, [messages, loading, scrollToBottom]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setAllToolsCalled([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const userMsg = { role: 'user', content: trimmed, time: t };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const apiMsgs = next.map(m => ({ role: m.role, content: m.content }));
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMsgs, context: context || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.tools_called?.length) {
        setAllToolsCalled(prev => [...prev, ...data.tools_called]);
      }
      const replyTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content:      data.message || '',
        artifacts:    data.artifacts || [],
        follow_ups:   data.follow_ups || [],
        tools_called: data.tools_called || [],
        time:         replyTime,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        artifacts: [], follow_ups: [], tools_called: [],
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, loading, context]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastFollowUps = lastMsg?.follow_ups?.length ? lastMsg.follow_ups : [];
  const isEmpty = messages.length === 0;

  return (
    <div className="cop-screen">

      {/* ── Left rail ── */}
      <aside className="cop-rail">
        <button className="cop-new-chat" onClick={clearMessages}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" width="14" height="14">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New conversation
        </button>

        <div className="cop-rail-section">
          <div className="cop-rail-head">Favorites</div>
          {FAVORITE_SPOTS.map(s => (
            <div key={s.id} className="cop-rail-item"
              onClick={() => sendMessage(`What are conditions like at ${s.name} right now?`)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" className="cop-rail-ic">
                <path d="M12 2l2.5 7h7.5l-6 4.5 2.5 7.5L12 16.5 5.5 21l2.5-7.5-6-4.5h7.5z"/>
              </svg>
              <span className="cop-rail-name">{s.name}</span>
              {s.live && <span className="cop-rail-live"/>}
            </div>
          ))}
        </div>

        {messages.length > 0 && (
          <div className="cop-rail-section">
            <div className="cop-rail-head">Today</div>
            <div className="cop-rail-item cop-rail-item-active">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" className="cop-rail-ic">
                <path d="M21 12c0 5-4 9-9 9-1.5 0-3-.4-4.3-1L3 21l1-4.7C3.4 15 3 13.5 3 12c0-5 4-9 9-9s9 4 9 9z"/>
              </svg>
              <span className="cop-rail-name">
                {messages[0]?.content?.slice(0, 26) || 'This conversation'}
                {messages[0]?.content?.length > 26 ? '…' : ''}
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Center conversation ── */}
      <main className="cop-conv">

        {user && (
          <div className="cop-ctx-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
              strokeWidth="1.5" strokeLinecap="round" width="13" height="13">
              <circle cx="12" cy="10" r="3"/>
              <path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/>
            </svg>
            <b>{profile.display_name || user.email?.split('@')[0] || initials}</b>
            {(profile.skill_level || profile.home_spot_name) && (
              <>
                <span className="cop-banner-sep">·</span>
                <span>
                  {[profile.skill_level, profile.home_spot_name].filter(Boolean).join(' · ')}
                </span>
              </>
            )}
            <span className="cop-banner-time">
              {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toUpperCase()}
            </span>
          </div>
        )}

        {isEmpty && (
          <div className="cop-empty">
            <LogoPulse size={48}/>
            <h2 className="cop-empty-title">What do you want to know?</h2>
            <p className="cop-empty-sub">Ask about conditions, compare spots, or plan your session.</p>
            <div className="cop-chips">
              {SUGGESTED_PROMPTS.map(p => (
                <button key={p} className="cop-chip" onClick={() => sendMessage(p)}>{p}</button>
              ))}
            </div>
          </div>
        )}

        {!isEmpty && (
          <div className="cop-thread" ref={threadRef}>
            {messages.map((m, i) => (
              m.role === 'user'
                ? <UserMessage key={i} content={m.content} time={m.time}/>
                : <AssistantMessage key={i} content={m.content} artifacts={m.artifacts}
                    tools_called={m.tools_called} time={m.time}/>
            ))}
            {loading && <ThinkingMessage/>}
          </div>
        )}

        <div className="cop-input-area">
          {lastFollowUps.length > 0 && !loading && (
            <div className="cop-chips cop-chips-followup">
              {lastFollowUps.map(p => (
                <button key={p} className="cop-chip" onClick={() => sendMessage(p)}>{p}</button>
              ))}
            </div>
          )}
          <div className="cop-composer">
            <textarea
              ref={inputRef}
              className="cop-composer-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about conditions, compare spots, log a session…"
              rows={1}
              disabled={loading}
            />
            <div className="cop-composer-actions">
              <button className="cop-comp-btn" title="Attach" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" width="16" height="16">
                  <path d="M21 12l-8.5 8.5a5.5 5.5 0 1 1-7.8-7.8l8.5-8.5a4 4 0 1 1 5.6 5.6l-8.5 8.5a2.5 2.5 0 1 1-3.5-3.5l7.8-7.8"/>
                </svg>
              </button>
              <button className="cop-comp-btn" title="Voice" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" width="16" height="16">
                  <rect x="9" y="2" width="6" height="12" rx="3"/>
                  <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v4"/>
                </svg>
              </button>
              <button className="cop-comp-btn cop-comp-send"
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                aria-label="Send">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="cop-hints">
            <div className="cop-hints-cmds">
              <button className="cop-hint-btn" onClick={() => setInput('@spot ')}>@spot</button>
              <button className="cop-hint-btn" onClick={() => setInput('/compare ')}>/ compare</button>
              <button className="cop-hint-btn" onClick={() => setInput('/log ')}>/ log</button>
            </div>
            <span className="cop-hints-key">⌘↩ SEND · ⇧↩ NEW LINE</span>
          </div>
        </div>
      </main>

      {/* ── Right context pane ── */}
      <aside className="cop-ctx-pane">

        <div className="cop-ctx-sec">
          <h5 className="cop-ctx-head">Active context</h5>
          {user ? (
            <>
              <div className="cop-ctx-row"><span className="cop-ctx-k">Account</span><span className="cop-ctx-v">{profile.display_name || user.email?.split('@')[0]}</span></div>
              <div className="cop-ctx-row"><span className="cop-ctx-k">Skill</span><span className="cop-ctx-v">{profile.skill_level || '—'}</span></div>
              <div className="cop-ctx-row"><span className="cop-ctx-k">Home break</span><span className="cop-ctx-v">{profile.home_spot_name || '—'}</span></div>
            </>
          ) : (
            <div className="cop-ctx-row"><span className="cop-ctx-k">Status</span><span className="cop-ctx-v">Guest</span></div>
          )}
        </div>

        <div className="cop-ctx-sec">
          <h5 className="cop-ctx-head">Learned preferences</h5>
          <div className="cop-ctx-signals">
            {PLACEHOLDER_PREFS.map((p, i) => (
              <div key={i} className="cop-signal">
                <span className="cop-signal-w">{p.w}</span>
                <span className="cop-signal-t">{p.t}</span>
              </div>
            ))}
          </div>
        </div>

        {allToolsCalled.length > 0 && (
          <div className="cop-ctx-sec">
            <h5 className="cop-ctx-head">Tools this session</h5>
            {allToolsCalled.map((tc, i) => (
              <div key={i} className="cop-ctx-tool">
                <span className="cop-ctx-tool-name">{tc.name}</span>
                {tc.ms != null && <span className="cop-ctx-tool-ms">{tc.ms}ms</span>}
              </div>
            ))}
          </div>
        )}

        <div className="cop-ctx-sec">
          <h5 className="cop-ctx-head">Data sources</h5>
          <div className="cop-ctx-row"><span className="cop-ctx-k">Buoys</span><span className="cop-ctx-v">NDBC · 18 CA</span></div>
          <div className="cop-ctx-row"><span className="cop-ctx-k">Wind</span><span className="cop-ctx-v">HRRR · GFS · NAM</span></div>
          <div className="cop-ctx-row"><span className="cop-ctx-k">Wave</span><span className="cop-ctx-v">WW3 · CDIP</span></div>
          <div className="cop-ctx-row"><span className="cop-ctx-k">Tide</span><span className="cop-ctx-v">NOAA CO-OPS</span></div>
        </div>

      </aside>
    </div>
  );
}
