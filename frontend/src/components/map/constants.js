export const CARTO_DARK   = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
export const CARTO_LABELS = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';
export const CARTO_ATTR   = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const REGIONS = [
  { id: 'all',     label: 'All',        bbox: null },
  { id: 'hawaii',  label: 'Hawaii',     bbox: [[18,-161],[23,-154]] },
  { id: 'ca',      label: 'California', bbox: [[32,-125],[42,-114]] },
  { id: 'pnw',     label: 'PNW',        bbox: [[42,-125],[50,-117]] },
  { id: 'mex',     label: 'Mexico',     bbox: [[14,-118],[32,-86]]  },
  { id: 'europe',  label: 'Europe',     bbox: [[35,-20],[70,30]]    },
  { id: 'indo',    label: 'Indo',       bbox: [[-12,95],[8,145]]    },
  { id: 'aus',     label: 'Australia',  bbox: [[-45,110],[-10,155]] },
  { id: 'sa',      label: 'S. America', bbox: [[-56,-82],[14,-34]]  },
];

// Hardcoded to match .mv-spot.{tier} CSS — legend dots must be identical to markers
export const TIER_COLORS = {
  firing: 'oklch(0.75 0.19 45)',
  solid:  'oklch(0.82 0.14 85)',
  good:   'oklch(0.80 0.15 150)',
  fair:   'oklch(0.82 0.16 195)',
  flat:   'oklch(0.58 0.014 230)',
};

export const TIER_LABELS = {
  firing: 'Firing',
  solid:  'Solid',
  good:   'Fun',
  fair:   'Fair',
  flat:   'Flat',
};

export const TIER_LEGEND = [
  { tier: 'firing', range: '≥ 4.5' },
  { tier: 'solid',  range: '3.5–4.5' },
  { tier: 'good',   range: '2.5–3.5' },
  { tier: 'fair',   range: '1.5–2.5' },
  { tier: 'flat',   range: '< 1.5' },
];
