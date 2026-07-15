export function stormMarkerHtml(storm, opacity = 1) {
  const label = storm.label || storm.name || '';
  const tier  = storm.warning_tier || 'none';
  // Model-derived storms render dashed/damped to signal unconfirmed provenance
  const isModel = storm.source === 'model';
  const op = opacity < 1 ? ` style="opacity:${opacity.toFixed(2)}"` : '';
  // Cyclone glyph (🌀 shape): two comma-shaped arms + core, colored by tier
  // via the .wt-* --sc custom property. The svg carries class "core" so the
  // existing click binding (querySelector('.core')) keeps working.
  return `<div class="marker-storm wt-${tier}${isModel ? ' source-model' : ''}" title="${label}"${op}>
    <svg class="core cyclone" viewBox="0 0 40 40" aria-hidden="true">
      <path class="arm" d="M22 2.5 C12 2.5 5.5 10 5.5 18.5 c0 2.4 .5 4.6 1.4 6.6 C7.5 15.6 14 9.5 22 9.5 Z"/>
      <path class="arm" d="M22 2.5 C12 2.5 5.5 10 5.5 18.5 c0 2.4 .5 4.6 1.4 6.6 C7.5 15.6 14 9.5 22 9.5 Z" transform="rotate(180 20 20)"/>
      <circle class="eye" cx="20" cy="20" r="6.2"/>
    </svg>
  </div>`;
}
