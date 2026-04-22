// Canonical D1 mark as an SVG <symbol> string for server-side rendering or
// inline-sprite patterns. The React component (Logo.jsx) renders the equivalent
// JSX directly — this export is for non-React contexts only.
export const markD1Symbol =
  '<symbol id="mark-d1" viewBox="0 0 64 64">' +
  '<g transform="translate(32 40)" stroke="currentColor" fill="none" stroke-linecap="round">' +
  '<path d="M-14 0 A14 14 0 0 1 14 0" stroke-width="2"/>' +
  '<path d="M-21 0 A21 21 0 0 1 21 0" stroke-width="1.6" opacity="0.5"/>' +
  '<path d="M-28 0 A28 28 0 0 1 28 0" stroke-width="1.2" opacity="0.25"/>' +
  '</g>' +
  '<circle cx="32" cy="40" r="4" fill="var(--logo-dot, currentColor)"/>' +
  '</symbol>';
