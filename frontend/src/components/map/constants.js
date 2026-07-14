export const CARTO_DARK         = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
export const CARTO_LABELS       = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';
export const CARTO_LIGHT        = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
export const CARTO_LIGHT_LABELS = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';
export const CARTO_ATTR         = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

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
  firing: 'oklch(0.72 0.16 20)',
  solid:  'oklch(0.82 0.14 85)',
  good:   'oklch(0.80 0.15 150)',
  fair:   'oklch(0.82 0.16 195)',
  flat:   'oklch(0.58 0.014 230)',
};

// Numbers-only display — no adjective labels per design call. Tier names
// remain for color tiering only; the UI never shows them as text.
export const TIER_LABELS = {
  firing: '',
  solid:  '',
  good:   '',
  fair:   '',
  flat:   '',
};

export const TIER_LEGEND = [
  { tier: 'firing', range: '≥ 8.5' },
  { tier: 'solid',  range: '7.0–8.5' },
  { tier: 'good',   range: '5.0–7.0' },
  { tier: 'fair',   range: '3.0–5.0' },
  { tier: 'flat',   range: '< 3.0' },
];
