export function ratingTier(r) {
  if (!r || r < 1.5) return 'flat';
  if (r < 2.5) return 'fair';
  if (r < 3.5) return 'good';
  if (r < 4.5) return 'solid';
  return 'firing';
}

export function ratingColor(r) {
  const tier = ratingTier(r);
  const map = {
    firing: 'oklch(0.75 0.19 45)',
    solid:  'oklch(0.82 0.14 85)',
    good:   'oklch(0.80 0.15 150)',
    fair:   'oklch(0.82 0.16 195)',
    flat:   'oklch(0.58 0.014 230)',
  };
  return map[tier];
}

export function spotMarkerHtml(spot) {
  // bundle path: spot.rating is 0-5
  // legacy path: spot.current_conditions.overall_score is 0-10 → halve it
  const raw   = spot.current_conditions?.overall_score;
  const score = spot.rating ?? (raw != null ? raw / 2 : null);
  const tier  = ratingTier(score);
  const rating = score != null ? score.toFixed(1) : '';

  const surferSvg = `<svg class="mv-surfer" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="4" r="2.2" stroke="currentColor" stroke-width="1.4"/>
    <path d="M6 9.5c.8-1.2 2-1.8 3-1.8s2.2.6 3 1.8L13.5 13H4.5L6 9.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M4 13c1.5 1 3.5 1.5 5 1.5s3.5-.5 5-1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;

  return `<div class="mv-spot ${tier}">
    <div class="mv-halo"></div>
    <div class="mv-inner">${surferSvg}</div>
    ${rating ? `<div class="mv-badge" data-rating="${rating}"></div>` : ''}
  </div>`;
}

export function buoyMarkerHtml() {
  return `<div class="mv-buoy">
    <div class="mv-buoy-ring"></div>
    <div class="mv-buoy-dot"></div>
  </div>`;
}

export function clusterMarkerHtml(count, avgRating) {
  const color = ratingColor(avgRating);
  return `<div class="mv-cluster" style="--tier-color: ${color}">
    <span class="mv-cl-count">${count}</span>
    <span class="mv-cl-label">spots</span>
  </div>`;
}
