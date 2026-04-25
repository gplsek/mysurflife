export function stormMarkerHtml(storm, opacity = 1) {
  const label = storm.label || storm.name || '';
  const tier = storm.warning_tier || 'none';
  const op = opacity < 1 ? ` style="opacity:${opacity.toFixed(2)}"` : '';
  return `<div class="marker-storm wt-${tier}" title="${label}"${op}>
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="core"></div>
  </div>`;
}
