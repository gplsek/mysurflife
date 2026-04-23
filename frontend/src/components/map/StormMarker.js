export function stormMarkerHtml(storm) {
  const label = storm.label || storm.name || '';
  const tier = storm.warning_tier || 'none';
  return `<div class="marker-storm wt-${tier}" title="${label}">
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="core"></div>
  </div>`;
}
