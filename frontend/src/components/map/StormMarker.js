export function stormMarkerHtml(storm, opacity = 1) {
  const label = storm.label || storm.name || '';
  const tier  = storm.warning_tier || 'none';
  // Model-derived storms render with dashed rings to signal unconfirmed provenance
  const isModel = storm.source === 'model';
  const op = opacity < 1 ? ` style="opacity:${opacity.toFixed(2)}"` : '';
  return `<div class="marker-storm wt-${tier}${isModel ? ' source-model' : ''}" title="${label}"${op}>
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="ring"></div>
    <div class="core"></div>
  </div>`;
}
