import React from 'react';

/**
 * Animated D1 loading indicator.
 *
 * Three pulse-rings expand outward from the origin dot, staggered 800 ms each,
 * fading from opacity 0.6 → 0 over 2.4 s. Uses SVG SMIL <animate> — no CSS
 * keyframes required, works reliably in all modern browsers including Safari.
 *
 * Colors resolve from --fire and --logo-dot CSS variables, so theme changes
 * retint the animation instantly.
 *
 * Props:
 *   size      number — rendered diameter in px (default 96)
 *   className string — extra CSS class
 *
 * Usage:
 *   <LogoPulse size={96} />            // default, map/panel loading
 *   <LogoPulse size={40} />            // inline / compact loading
 *   <LogoPulse size={24} className="spinner-inline" />
 */
export default function LogoPulse({ size = 96, className = '' }) {
  // Three rings from ramps.json brand.pulse_animation
  const rings = [
    { delay: '0s',    rEnd: 14 },
    { delay: '0.8s',  rEnd: 21 },
    { delay: '1.6s',  rEnd: 28 },
  ];

  const dur  = '2.4s';
  const ease = '0.22 1 0.36 1'; // cubic-bezier as SMIL keySplines

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
      className={className}
    >
      {rings.map((ring, i) => (
        <circle key={i} cx="32" cy="40" r="4" stroke="var(--fire)" fill="none" strokeLinecap="round">
          <animate
            attributeName="r"
            from="4"
            to={ring.rEnd}
            dur={dur}
            begin={ring.delay}
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;1"
            keySplines={ease}
          />
          <animate
            attributeName="opacity"
            from="0.6"
            to="0"
            dur={dur}
            begin={ring.delay}
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0;1"
            keySplines={ease}
          />
        </circle>
      ))}
      {/* Static origin dot — always visible */}
      <circle cx="32" cy="40" r="4" fill="var(--logo-dot)" />
    </svg>
  );
}
