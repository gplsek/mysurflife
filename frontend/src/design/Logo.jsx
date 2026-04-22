import React from 'react';

// Ring geometry — all values in the 64×64 canonical viewBox.
// Below 24px rendered height, outer two rings are dropped (degraded mode).
const INNER  = { d: 'M-14 0 A14 14 0 0 1 14 0', sw: 2,   op: 1.00 };
const MIDDLE = { d: 'M-21 0 A21 21 0 0 1 21 0', sw: 1.6, op: 0.50 };
const OUTER  = { d: 'M-28 0 A28 28 0 0 1 28 0', sw: 1.2, op: 0.25 };

function Rings({ cx, cy, full }) {
  return (
    <g transform={`translate(${cx} ${cy})`} stroke="var(--fire)" fill="none" strokeLinecap="round">
      <path d={INNER.d} strokeWidth={INNER.sw} />
      {full && <path d={MIDDLE.d} strokeWidth={MIDDLE.sw} opacity={MIDDLE.op} />}
      {full && <path d={OUTER.d}  strokeWidth={OUTER.sw}  opacity={OUTER.op}  />}
    </g>
  );
}

/**
 * D1 logo mark and lockup variants.
 *
 * Props:
 *   variant  "mark" | "horizontal" | "horizontal-tagline" | "horizontal-mono"
 *            | "stacked" | "app-icon"
 *   size     Rendered height in px (width is auto from aspect ratio).
 *            For "mark", "stacked", "app-icon": square (width === size).
 *   title    Accessible label string. Omit for decorative use.
 *   className  Extra CSS class.
 *
 * Colors resolve from CSS custom properties (--fire, --logo-dot) so a theme
 * swap retints the mark with zero JS — no re-render required.
 */
export default function Logo({ variant = 'mark', size = 32, title, className = '' }) {
  const full = size >= 24;
  const a11y = title
    ? { role: 'img', 'aria-label': title }
    : { 'aria-hidden': 'true' };

  // ── Mark only ─────────────────────────────────────────────────────────────
  if (variant === 'mark') {
    return (
      <svg
        width={size} height={size}
        viewBox="0 0 64 64"
        style={{ display: 'block' }}
        className={className}
        {...a11y}
      >
        {title && <title>{title}</title>}
        <Rings cx={32} cy={40} full={full} />
        <circle cx={32} cy={40} r={4} fill="var(--logo-dot)" />
      </svg>
    );
  }

  // ── Horizontal lockup ─────────────────────────────────────────────────────
  if (variant === 'horizontal' || variant === 'horizontal-tagline') {
    const hasTagline = variant === 'horizontal-tagline';
    const vbH = hasTagline ? 100 : 80;
    const w   = Math.round(size * 340 / vbH);
    const oy  = hasTagline ? 38 : 32;
    const ty  = hasTagline ? 42 : 42;
    return (
      <svg
        width={w} height={size}
        viewBox={`0 0 340 ${vbH}`}
        style={{ display: 'block' }}
        className={className}
        {...a11y}
      >
        {title && <title>{title}</title>}
        <Rings cx={8} cy={oy} full={full} />
        <circle cx={8} cy={oy} r={4.2} fill="var(--logo-dot)" />
        <text
          x={58} y={ty}
          fontFamily="Geist, ui-sans-serif, sans-serif"
          fontWeight={hasTagline ? 700 : 800}
          fontSize={hasTagline ? 28 : 34}
          letterSpacing="-0.04em"
          fill="var(--fg)"
        >
          mysurflife
        </text>
        {hasTagline && (
          <text
            x={58} y={62}
            fontFamily="Geist Mono, ui-monospace, monospace"
            fontSize={10}
            letterSpacing="0.24em"
            fill="var(--muted)"
          >
            AI SURF FORECAST
          </text>
        )}
      </svg>
    );
  }

  // ── Mono horizontal lockup (print / single-color) ─────────────────────────
  if (variant === 'horizontal-mono') {
    const w = Math.round(size * 340 / 80);
    return (
      <svg
        width={w} height={size}
        viewBox="0 0 340 80"
        style={{ display: 'block', color: 'currentColor' }}
        className={className}
        {...a11y}
      >
        {title && <title>{title}</title>}
        <g transform="translate(8 32)" stroke="currentColor" fill="none" strokeLinecap="round">
          <path d={INNER.d}  strokeWidth={INNER.sw} />
          {full && <path d={MIDDLE.d} strokeWidth={MIDDLE.sw} opacity={MIDDLE.op} />}
          {full && <path d={OUTER.d}  strokeWidth={OUTER.sw}  opacity={OUTER.op}  />}
        </g>
        <circle cx={8} cy={32} r={4.2} fill="currentColor" />
        <text
          x={58} y={42}
          fontFamily="Geist, ui-sans-serif, sans-serif"
          fontWeight={800}
          fontSize={34}
          letterSpacing="-0.04em"
          fill="currentColor"
        >
          mysurflife
        </text>
      </svg>
    );
  }

  // ── Stacked lockup ────────────────────────────────────────────────────────
  if (variant === 'stacked') {
    return (
      <svg
        width={size} height={size}
        viewBox="0 0 160 160"
        style={{ display: 'block' }}
        className={className}
        {...a11y}
      >
        {title && <title>{title}</title>}
        <g transform="translate(80 70)" stroke="var(--fire)" fill="none" strokeLinecap="round">
          <path d="M-20 0 A20 20 0 0 1 20 0" strokeWidth={2.4} />
          {full && <path d="M-30 0 A30 30 0 0 1 30 0" strokeWidth={1.8} opacity={0.5} />}
          {full && <path d="M-40 0 A40 40 0 0 1 40 0" strokeWidth={1.4} opacity={0.25} />}
        </g>
        <circle cx={80} cy={70} r={6} fill="var(--logo-dot)" />
        <text
          x={80} y={124}
          textAnchor="middle"
          fontFamily="Geist, ui-sans-serif, sans-serif"
          fontWeight={700}
          fontSize={20}
          letterSpacing="-0.02em"
          fill="var(--fg)"
        >
          mysurflife
        </text>
      </svg>
    );
  }

  // ── App icon (rounded rect container) ────────────────────────────────────
  if (variant === 'app-icon') {
    return (
      <svg
        width={size} height={size}
        viewBox="0 0 160 160"
        style={{ display: 'block' }}
        className={className}
        {...a11y}
      >
        {title && <title>{title}</title>}
        <rect width={160} height={160} rx={36} fill="var(--bg-3, #0a1218)" />
        <g transform="translate(80 92)" stroke="var(--fire)" fill="none" strokeLinecap="round">
          <path d="M-26 0 A26 26 0 0 1 26 0" strokeWidth={3} />
          {full && <path d="M-40 0 A40 40 0 0 1 40 0" strokeWidth={2.4} opacity={0.5} />}
          {full && <path d="M-54 0 A54 54 0 0 1 54 0" strokeWidth={1.8} opacity={0.25} />}
        </g>
        <circle cx={80} cy={92} r={8} fill="var(--logo-dot)" />
      </svg>
    );
  }

  return null;
}
