// ─────────────────────────────────────────────────────────────────────────────
//  mysurflife — Map View
//  Real pan/zoom map (Leaflet) with CartoDB Dark Matter tiles and custom
//  HTML markers for surf spots, NOAA buoys, and active storm systems.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. DATA ──────────────────────────────────────────────────────────────────
const SPOTS = [
  // North America — Pacific
  { id: 'pipe',      name: 'Pipeline',          region: 'Oahu, HI',           lat: 21.664,  lon: -158.052, rating: 4.8, swell: 8.2, period: 14, wind: 9,  water: 76, fav: true  },
  { id: 'waimea',    name: 'Waimea Bay',        region: 'Oahu, HI',           lat: 21.640,  lon: -158.066, rating: 4.2, swell: 12,  period: 16, wind: 12, water: 76 },
  { id: 'sunset',    name: 'Sunset Beach',      region: 'Oahu, HI',           lat: 21.675,  lon: -158.041, rating: 3.8, swell: 7.4, period: 13, wind: 10, water: 76 },
  { id: 'honolua',   name: 'Honolua Bay',       region: 'Maui, HI',           lat: 21.012,  lon: -156.638, rating: 4.1, swell: 6.2, period: 14, wind: 8,  water: 77 },
  { id: 'jaws',      name: 'Peʻahi (Jaws)',     region: 'Maui, HI',           lat: 20.944,  lon: -156.297, rating: 3.5, swell: 14,  period: 18, wind: 16, water: 77 },

  { id: 'maverick',  name: 'Mavericks',         region: 'Half Moon Bay, CA',  lat: 37.494,  lon: -122.501, rating: 4.6, swell: 11,  period: 17, wind: 7,  water: 54, fav: true },
  { id: 'ocean',     name: 'Ocean Beach',       region: 'San Francisco, CA',  lat: 37.758,  lon: -122.511, rating: 3.3, swell: 6.8, period: 12, wind: 14, water: 55 },
  { id: 'steamer',   name: 'Steamer Lane',      region: 'Santa Cruz, CA',     lat: 36.951,  lon: -122.025, rating: 3.9, swell: 5.8, period: 13, wind: 8,  water: 58 },
  { id: 'pleasure',  name: 'Pleasure Point',    region: 'Santa Cruz, CA',     lat: 36.958,  lon: -121.971, rating: 3.2, swell: 4.6, period: 12, wind: 6,  water: 58 },
  { id: 'rincon',    name: 'Rincon',            region: 'Carpinteria, CA',    lat: 34.374,  lon: -119.479, rating: 4.3, swell: 6.4, period: 15, wind: 5,  water: 60, fav: true },
  { id: 'malibu',    name: 'Malibu 1st Point',  region: 'Malibu, CA',         lat: 34.037,  lon: -118.679, rating: 3.0, swell: 3.8, period: 11, wind: 6,  water: 62 },
  { id: 'trestles',  name: 'Lower Trestles',    region: 'San Clemente, CA',   lat: 33.383,  lon: -117.590, rating: 3.7, swell: 4.2, period: 13, wind: 5,  water: 64, fav: true },
  { id: 'blacks',    name: 'Blacks Beach',      region: 'La Jolla, CA',       lat: 32.879,  lon: -117.253, rating: 3.6, swell: 5.0, period: 14, wind: 7,  water: 65 },
  { id: 'swamis',    name: 'Swamis',            region: 'Encinitas, CA',      lat: 33.034,  lon: -117.292, rating: 2.8, swell: 3.4, period: 12, wind: 6,  water: 64 },

  { id: 'cannon',    name: 'Cannon Beach',      region: 'Oregon',             lat: 45.892,  lon: -123.961, rating: 2.5, swell: 6.2, period: 12, wind: 16, water: 52 },
  { id: 'westport',  name: 'Westport',          region: 'Washington',         lat: 46.888,  lon: -124.108, rating: 2.7, swell: 7.0, period: 13, wind: 14, water: 51 },
  { id: 'tofino',    name: 'Cox Bay',           region: 'Tofino, BC',         lat: 49.113,  lon: -125.889, rating: 3.1, swell: 6.8, period: 13, wind: 11, water: 50 },

  // Mexico & Central America
  { id: 'scorps',    name: 'Scorpion Bay',      region: 'Baja California Sur',lat: 26.730,  lon: -113.537, rating: 3.4, swell: 5.4, period: 15, wind: 8,  water: 72 },
  { id: 'puerto',    name: 'Puerto Escondido',  region: 'Oaxaca, MX',         lat: 15.863,  lon: -97.068,  rating: 4.4, swell: 9.8, period: 16, wind: 7,  water: 80 },
  { id: 'pascuales', name: 'Pascuales',         region: 'Colima, MX',         lat: 18.759,  lon: -104.085, rating: 3.9, swell: 7.2, period: 14, wind: 6,  water: 82 },
  { id: 'popoyo',    name: 'Popoyo',            region: 'Nicaragua',          lat: 11.454,  lon: -86.062,  rating: 4.0, swell: 6.8, period: 14, wind: 9,  water: 81 },
  { id: 'playa-neg', name: 'Playa Negra',       region: 'Costa Rica',         lat: 10.257,  lon: -85.832,  rating: 3.3, swell: 5.4, period: 13, wind: 10, water: 82 },
  { id: 'pavones',   name: 'Pavones',           region: 'Costa Rica',         lat: 8.387,   lon: -83.135,  rating: 3.8, swell: 6.0, period: 15, wind: 8,  water: 84 },

  // South America
  { id: 'chicama',   name: 'Chicama',           region: 'Peru',               lat: -7.779,  lon: -79.412,  rating: 4.2, swell: 5.8, period: 16, wind: 6,  water: 66 },
  { id: 'lobitos',   name: 'Lobitos',           region: 'Peru',               lat: -4.450,  lon: -81.287,  rating: 3.5, swell: 4.8, period: 14, wind: 8,  water: 72 },
  { id: 'monta',     name: 'Montañita',         region: 'Ecuador',            lat: -1.823,  lon: -80.753,  rating: 2.9, swell: 3.6, period: 12, wind: 10, water: 74 },
  { id: 'fernando',  name: 'Fernando de Noronha', region: 'Brazil',           lat: -3.854,  lon: -32.424,  rating: 3.4, swell: 4.4, period: 12, wind: 11, water: 81 },

  // Europe
  { id: 'nazare',    name: 'Nazaré',            region: 'Portugal',           lat: 39.607,  lon: -9.077,   rating: 4.5, swell: 18,  period: 18, wind: 12, water: 59, fav: true },
  { id: 'ericeira',  name: 'Ribeira d\'Ilhas',  region: 'Portugal',           lat: 38.982,  lon: -9.424,   rating: 3.7, swell: 6.4, period: 14, wind: 9,  water: 60 },
  { id: 'mundaka',   name: 'Mundaka',           region: 'Basque Country',     lat: 43.407,  lon: -2.697,   rating: 4.1, swell: 7.2, period: 15, wind: 8,  water: 58 },
  { id: 'hossegor',  name: 'La Gravière',       region: 'Hossegor, France',   lat: 43.678,  lon: -1.446,   rating: 3.8, swell: 6.8, period: 14, wind: 9,  water: 60 },
  { id: 'thurso',    name: 'Thurso East',       region: 'Scotland',           lat: 58.598,  lon: -3.515,   rating: 3.4, swell: 8.0, period: 13, wind: 15, water: 47 },

  // South Africa
  { id: 'jbay',      name: 'Jeffreys Bay',      region: 'South Africa',       lat: -34.050, lon: 24.922,   rating: 4.3, swell: 6.6, period: 14, wind: 8,  water: 64, fav: true },
  { id: 'dungeons',  name: 'Dungeons',          region: 'Cape Town, SA',      lat: -34.058, lon: 18.331,   rating: 3.6, swell: 12,  period: 16, wind: 14, water: 58 },

  // Indonesia
  { id: 'uluwatu',   name: 'Uluwatu',           region: 'Bali, Indonesia',    lat: -8.829,  lon: 115.088,  rating: 4.2, swell: 6.8, period: 14, wind: 8,  water: 83 },
  { id: 'padang',    name: 'Padang Padang',     region: 'Bali, Indonesia',    lat: -8.812,  lon: 115.101,  rating: 3.9, swell: 6.2, period: 14, wind: 8,  water: 83 },
  { id: 'desert',    name: 'Desert Point',      region: 'Lombok, Indonesia',  lat: -8.741,  lon: 115.847,  rating: 4.0, swell: 5.8, period: 15, wind: 7,  water: 83 },
  { id: 'lances',    name: 'Lance\'s Right',    region: 'Mentawai, Indonesia',lat: -1.594,  lon: 99.255,   rating: 4.4, swell: 6.8, period: 15, wind: 6,  water: 84 },

  // Australia
  { id: 'snapper',   name: 'Snapper Rocks',     region: 'Gold Coast, AUS',    lat: -28.163, lon: 153.551,  rating: 4.0, swell: 5.6, period: 13, wind: 7,  water: 74, fav: true },
  { id: 'kirra',     name: 'Kirra',             region: 'Gold Coast, AUS',    lat: -28.174, lon: 153.535,  rating: 3.8, swell: 5.2, period: 13, wind: 7,  water: 74 },
  { id: 'bells',     name: 'Bells Beach',       region: 'Victoria, AUS',      lat: -38.372, lon: 144.278,  rating: 3.5, swell: 6.4, period: 14, wind: 11, water: 62 },
  { id: 'margaret',  name: 'Margaret River',    region: 'Western AUS',        lat: -33.980, lon: 114.985,  rating: 3.9, swell: 7.0, period: 14, wind: 10, water: 66 },

  // Atlantic — Caribbean / East Coast USA
  { id: 'rodanthe',  name: 'Rodanthe',          region: 'Outer Banks, NC',    lat: 35.594,  lon: -75.466,  rating: 3.0, swell: 4.4, period: 11, wind: 12, water: 66 },
  { id: 'sebastian', name: 'Sebastian Inlet',   region: 'Florida',            lat: 27.862,  lon: -80.447,  rating: 2.6, swell: 3.2, period: 10, wind: 9,  water: 74 },
  { id: 'montauk',   name: 'Ditch Plains',      region: 'Montauk, NY',        lat: 41.036,  lon: -71.919,  rating: 2.4, swell: 3.0, period: 10, wind: 11, water: 62 },
  { id: 'rincon-pr', name: 'Tres Palmas',       region: 'Rincón, PR',         lat: 18.348,  lon: -67.261,  rating: 3.6, swell: 5.2, period: 13, wind: 10, water: 80 },
];

const BUOYS = [
  { id: '51001', name: 'NW Hawaii',      lat: 23.45,  lon: -162.21, wave: 9.2, period: 14 },
  { id: '51000', name: 'NE Hawaii',      lat: 23.53,  lon: -153.89, wave: 7.8, period: 12 },
  { id: '46006', name: 'SE Papa',        lat: 40.75,  lon: -137.40, wave: 12.1, period: 16 },
  { id: '46002', name: 'OR Coast',       lat: 42.60,  lon: -130.54, wave: 10.4, period: 14 },
  { id: '46089', name: 'Tillamook',      lat: 45.89,  lon: -125.77, wave: 8.6, period: 13 },
  { id: '46022', name: 'Eel River',      lat: 40.72,  lon: -124.53, wave: 7.4, period: 12 },
  { id: '46013', name: 'Bodega Bay',     lat: 38.24,  lon: -123.30, wave: 6.8, period: 12 },
  { id: '46042', name: 'Monterey',       lat: 36.75,  lon: -122.42, wave: 6.2, period: 12 },
  { id: '46218', name: 'Harvest',        lat: 34.45,  lon: -120.78, wave: 5.8, period: 13 },
  { id: '46232', name: 'Pt Loma',        lat: 32.53,  lon: -117.43, wave: 4.4, period: 12 },
  { id: '44008', name: 'Nantucket',      lat: 40.50,  lon: -69.25,  wave: 5.6, period: 10 },
  { id: '44025', name: 'Long Island',    lat: 40.25,  lon: -73.17,  wave: 4.2, period: 9 },
  { id: '44014', name: 'Virginia Beach', lat: 36.61,  lon: -74.84,  wave: 4.8, period: 10 },
  { id: '41001', name: 'East Hatteras',  lat: 34.68,  lon: -72.63,  wave: 5.4, period: 11 },
  { id: '41010', name: 'Canaveral',      lat: 28.88,  lon: -78.47,  wave: 3.6, period: 9 },
  { id: '42001', name: 'Mid Gulf',       lat: 25.89,  lon: -89.66,  wave: 3.2, period: 8 },
  { id: '41043', name: 'NE PR',          lat: 21.12,  lon: -65.00,  wave: 5.1, period: 11 },
  { id: '51002', name: 'SW Hawaii',      lat: 17.04,  lon: -157.75, wave: 3.2, period: 12 },
  { id: '51004', name: 'SE Hawaii',      lat: 17.52,  lon: -152.48, wave: 3.8, period: 13 },
  { id: '62163', name: 'K13 Platform',   lat: 53.27,  lon: 3.22,    wave: 5.4, period: 8 },
  { id: '62081', name: 'K5 Buoy',        lat: 59.12,  lon: 11.39,   wave: 7.2, period: 10 },
  { id: '64045', name: 'Portugal W',     lat: 39.55,  lon: -11.00,  wave: 12.6, period: 16 },
  { id: 'k7',    name: 'Kangaroo Is',    lat: -36.88, lon: 135.67,  wave: 8.4, period: 14 },
  { id: 'csbuoy',name: 'Cape Sorell',    lat: -42.12, lon: 144.74,  wave: 11.2, period: 15 },
  { id: 'zasa1', name: 'Cape Point',     lat: -34.58, lon: 17.97,   wave: 10.2, period: 15 },
];

const STORMS = [
  {
    id: 's1',
    name: 'North Pacific Low',
    region: 'Gulf of Alaska · 980 mb',
    lat: 48.5, lon: -160.5,
    label: '980 mb · 55 kt',
    type: 'Storm Force Low',
    pressure: 980,
    maxWinds: 55,
    maxSeas: 38,
    fetch: 'NE quadrant',
    summary: 'Broad NW swell for HI, W coast US · arrivals 48–72h',
  },
  {
    id: 's2',
    name: 'Southern Ocean Low',
    region: 'Sub-Antarctic · 972 mb',
    lat: -52.0, lon: -125.0,
    label: '972 mb · 65 kt',
    type: 'Hurricane Force Low',
    pressure: 972,
    maxWinds: 65,
    maxSeas: 44,
    fetch: 'N semicircle',
    summary: 'Long-period S swell for CA, MX, Peru · arrivals 5–7 days',
  },
  {
    id: 's3',
    name: 'North Atlantic Low',
    region: 'Mid-Atlantic · 988 mb',
    lat: 54.0, lon: -30.0,
    label: '988 mb · 45 kt',
    type: 'Gale Force Low',
    pressure: 988,
    maxWinds: 45,
    maxSeas: 28,
    fetch: 'SE quadrant',
    summary: 'W swell for Portugal, Ireland, UK · arrivals 36–60h',
  },
];

const REGIONS = [
  { id: 'all',     label: 'All regions',   bbox: null },
  { id: 'hawaii',  label: 'Hawaii',        bbox: [[18.5, -160.5], [22.5, -154.5]] },
  { id: 'ca',      label: 'California',    bbox: [[32.5, -124.5], [38.5, -117.0]] },
  { id: 'pnw',     label: 'PNW',           bbox: [[42.0, -126.0], [49.5, -122.0]] },
  { id: 'mex',     label: 'Mexico · CA',   bbox: [[8.0,  -115.0], [30.0, -83.0]]  },
  { id: 'europe',  label: 'Europe',        bbox: [[36.0, -12.0],  [60.0, 3.0]]    },
  { id: 'indo',    label: 'Indonesia',     bbox: [[-12.0, 97.0],  [1.0, 119.0]]   },
  { id: 'aus',     label: 'Australia',     bbox: [[-40.0, 113.0], [-26.0, 154.0]] },
  { id: 'sa',      label: 'South America', bbox: [[-10.0, -82.0], [2.0, -70.0]]   },
];

// ── 2. HELPERS ───────────────────────────────────────────────────────────────
function ratingClass(r) {
  if (r >= 4.5) return 'firing';
  if (r >= 3.5) return 'solid';
  if (r >= 2.5) return 'good';
  if (r >= 1.5) return 'fair';
  return 'flat';
}
function ratingLabel(r) {
  if (r >= 4.5) return 'FIRING';
  if (r >= 3.5) return 'SOLID';
  if (r >= 2.5) return 'FUN';
  if (r >= 1.5) return 'FAIR';
  return 'FLAT';
}
function ratingColor(r) {
  if (r >= 4.5) return 'oklch(0.72 0.16 20)';
  if (r >= 3.5) return 'oklch(0.82 0.14 85)';
  if (r >= 2.5) return 'oklch(0.80 0.16 150)';
  if (r >= 1.5) return 'oklch(0.82 0.16 195)';
  return 'oklch(0.58 0.014 230)';
}
function inBbox(lat, lon, bbox) {
  if (!bbox) return true;
  const [[s, w], [n, e]] = bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

// ── 3. INIT MAP ──────────────────────────────────────────────────────────────
const map = L.map('map', {
  center: [25, -50],
  zoom: 2,
  minZoom: 2,
  maxZoom: 15,
  zoomControl: false,
  worldCopyJump: true,
  preferCanvas: false,
  attributionControl: true,
});

// CARTO Dark Matter — raster tiles, no API key, no WebGL
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 19,
  opacity: 0.6,
  pane: 'overlayPane',
}).addTo(map);

// ── 4. STATE ─────────────────────────────────────────────────────────────────
const state = {
  region: 'all',
  showSpots: true,
  showBuoys: true,
  showStorms: true,
  favsOnly: false,
  query: '',
  spotMarkers: new Map(),
  buoyMarkers: new Map(),
  stormMarkers: new Map(),
  clusterMarkers: [],
};

// ── 5. REGION CHIPS ──────────────────────────────────────────────────────────
const regionBar = document.getElementById('regionBar');
REGIONS.forEach((r) => {
  const count = r.id === 'all'
    ? SPOTS.length
    : SPOTS.filter((s) => inBbox(s.lat, s.lon, r.bbox)).length;
  const btn = document.createElement('button');
  btn.className = 'region-chip' + (r.id === 'all' ? ' on' : '');
  btn.dataset.id = r.id;
  btn.innerHTML = `${r.label} <span class="ct">${count}</span>`;
  btn.addEventListener('click', () => selectRegion(r.id));
  regionBar.appendChild(btn);
});

function selectRegion(id) {
  state.region = id;
  document.querySelectorAll('.region-chip').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
  const r = REGIONS.find((x) => x.id === id);
  if (r && r.bbox) {
    map.fitBounds(r.bbox, { padding: [80, 80], maxZoom: 8, animate: true });
  } else {
    map.flyTo([20, -50], 2, { duration: 1 });
  }
}

// ── 6. MARKERS ───────────────────────────────────────────────────────────────
function makeSpotIcon(spot) {
  const cls = ratingClass(spot.rating);
  return L.divIcon({
    className: '',
    html: `
      <div class="marker marker-spot ${cls}" style="width:38px;height:38px;position:relative;">
        <div class="halo"></div>
        <div class="inner">
          <svg width="16" height="16" viewBox="0 0 24 24"><use href="#surfer"/></svg>
        </div>
        <div class="rating-num" data-rating="${spot.rating.toFixed(1)}"></div>
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function makeBuoyIcon(buoy) {
  return L.divIcon({
    className: '',
    html: `
      <div class="marker marker-buoy" style="width:22px;height:22px;position:relative;" title="Buoy ${buoy.id} · ${buoy.name} · ${buoy.wave.toFixed(1)}ft @ ${buoy.period}s">
        <div class="ring"></div>
        <div class="dot"></div>
      </div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function makeStormIcon(storm) {
  return L.divIcon({
    className: '',
    html: `
      <div class="marker marker-storm" style="width:120px;height:120px;position:relative;" title="${storm.name} · ${storm.label}">
        <div class="ring"></div>
        <div class="ring"></div>
        <div class="ring"></div>
        <div class="core"></div>
      </div>
    `,
    iconSize: [120, 120],
    iconAnchor: [60, 60],
  });
}

function makeClusterIcon(count, avgRating) {
  const color = ratingColor(avgRating);
  return L.divIcon({
    className: '',
    html: `
      <div class="marker marker-cluster" style="width:44px;height:44px;border-color:${color};box-shadow:0 4px 14px oklch(0 0 0 / 0.5), 0 0 0 4px ${color.replace(')', ' / 0.14)')};">
        <div>${count}</div>
        <div class="sub">spots</div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

// ── 7. CLUSTERING & RENDER ───────────────────────────────────────────────────
const CLUSTER_GRID_PX = 55;

function clearMarkers() {
  state.spotMarkers.forEach((m) => map.removeLayer(m));
  state.buoyMarkers.forEach((m) => map.removeLayer(m));
  state.stormMarkers.forEach((m) => map.removeLayer(m));
  state.clusterMarkers.forEach((m) => map.removeLayer(m));
  state.spotMarkers.clear();
  state.buoyMarkers.clear();
  state.stormMarkers.clear();
  state.clusterMarkers = [];
}

function render() {
  clearMarkers();
  const zoom = map.getZoom();
  const bounds = map.getBounds();

  // Storms (always visible when toggled on)
  if (state.showStorms) {
    STORMS.forEach((storm) => {
      const m = L.marker([storm.lat, storm.lon], {
        icon: makeStormIcon(storm),
        interactive: true,
        keyboard: false,
        riseOnHover: true,
        bubblingMouseEvents: false,
      }).addTo(map);
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showStormPreview(storm);
      });
      state.stormMarkers.set(storm.id, m);
    });
  }

  // Buoys (only above zoom 3)
  if (state.showBuoys && zoom >= 2) {
    BUOYS.forEach((buoy) => {
      if (!bounds.contains([buoy.lat, buoy.lon])) return;
      const m = L.marker([buoy.lat, buoy.lon], { icon: makeBuoyIcon(buoy) }).addTo(map);
      state.buoyMarkers.set(buoy.id, m);
    });
  }

  // Spots (with clustering below zoom 5)
  if (state.showSpots) {
    const visibleSpots = SPOTS.filter((s) => {
      if (state.favsOnly && !s.fav) return false;
      if (state.query) {
        const q = state.query.toLowerCase();
        if (!s.name.toLowerCase().includes(q) && !s.region.toLowerCase().includes(q)) return false;
      }
      if (state.region !== 'all') {
        const reg = REGIONS.find((r) => r.id === state.region);
        if (reg && !inBbox(s.lat, s.lon, reg.bbox)) return false;
      }
      return bounds.contains([s.lat, s.lon]);
    });

    if (zoom < 5) {
      const cells = new Map();
      visibleSpots.forEach((spot) => {
        const p = map.latLngToContainerPoint([spot.lat, spot.lon]);
        const key = `${Math.floor(p.x / CLUSTER_GRID_PX)},${Math.floor(p.y / CLUSTER_GRID_PX)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(spot);
      });
      cells.forEach((spots) => {
        if (spots.length === 1) {
          addSpotMarker(spots[0]);
        } else {
          const clat = spots.reduce((a, s) => a + s.lat, 0) / spots.length;
          const clon = spots.reduce((a, s) => a + s.lon, 0) / spots.length;
          const avgR = spots.reduce((a, s) => a + s.rating, 0) / spots.length;
          const marker = L.marker([clat, clon], { icon: makeClusterIcon(spots.length, avgR) })
            .addTo(map)
            .on('click', () => map.flyTo([clat, clon], Math.min(zoom + 2.5, 7), { duration: 0.6 }));
          state.clusterMarkers.push(marker);
        }
      });
    } else {
      visibleSpots.forEach(addSpotMarker);
    }
  }

  updateLegendCounts();
  updateStatusCounts();
}

function addSpotMarker(spot) {
  const m = L.marker([spot.lat, spot.lon], { icon: makeSpotIcon(spot) })
    .addTo(map)
    .on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      showPreview(spot);
    });
  state.spotMarkers.set(spot.id, m);
}

// ── 8. PREVIEW CARD ──────────────────────────────────────────────────────────
const previewCard = document.getElementById('previewCard');
function showPreview(spot) {
  document.getElementById('pvName').textContent = spot.name;
  document.getElementById('pvRegion').textContent = spot.region;
  const pill = document.getElementById('pvPill');
  pill.textContent = ratingLabel(spot.rating);
  pill.style.background = ratingColor(spot.rating);
  document.getElementById('pvTag').textContent = `${spot.rating.toFixed(1)} / 5.0 · ${spot.swell.toFixed(1)}ft primary swell`;
  document.getElementById('pvSwell').textContent = spot.swell.toFixed(1);
  document.getElementById('pvPer').textContent = spot.period;
  document.getElementById('pvWind').textContent = spot.wind;
  document.getElementById('pvTemp').textContent = spot.water;
  previewCard.classList.add('show');
  map.flyTo([spot.lat, spot.lon], Math.max(map.getZoom(), 7), { duration: 0.6 });
}

document.getElementById('pvClose').addEventListener('click', () => previewCard.classList.remove('show'));
map.on('click', () => {
  previewCard.classList.remove('show');
  stormPreviewCard.classList.remove('show');
});

// ── 8b. STORM PREVIEW CARD ───────────────────────────────────────────────────
const stormPreviewCard = document.getElementById('stormPreviewCard');
function showStormPreview(storm) {
  previewCard.classList.remove('show');
  document.getElementById('spName').textContent = storm.name;
  document.getElementById('spRegion').textContent = storm.region;
  document.getElementById('spPill').textContent = storm.type.toUpperCase();
  document.getElementById('spTag').textContent = storm.summary;
  document.getElementById('spPres').textContent = storm.pressure;
  document.getElementById('spWind').textContent = storm.maxWinds;
  document.getElementById('spSeas').textContent = storm.maxSeas;
  document.getElementById('spFetch').textContent = storm.fetch;
  document.getElementById('spOpen').href = `mysurflife-storm-card.html?storm=${storm.id}`;
  stormPreviewCard.classList.add('show');
  map.flyTo([storm.lat, storm.lon], Math.max(map.getZoom(), 4), { duration: 0.6 });
}
document.getElementById('spClose').addEventListener('click', () => stormPreviewCard.classList.remove('show'));

// ── 9. COUNTS ────────────────────────────────────────────────────────────────
function updateLegendCounts() {
  const buckets = { firing: 0, solid: 0, good: 0, fair: 0, flat: 0 };
  SPOTS.forEach((s) => buckets[ratingClass(s.rating)]++);
  document.getElementById('ctFiring').textContent = buckets.firing;
  document.getElementById('ctSolid').textContent = buckets.solid;
  document.getElementById('ctGood').textContent = buckets.good;
  document.getElementById('ctFair').textContent = buckets.fair;
  document.getElementById('ctFlat').textContent = buckets.flat;
}

function updateStatusCounts() {
  const bounds = map.getBounds();
  const inView = SPOTS.filter((s) => bounds.contains([s.lat, s.lon])).length;
  document.getElementById('inViewCount').textContent = inView;
  document.getElementById('totalCount').textContent = SPOTS.length;
}

// ── 10. TOGGLES ──────────────────────────────────────────────────────────────
function bindToggle(id, key) {
  const el = document.getElementById(id);
  el.addEventListener('click', () => {
    state[key] = !state[key];
    el.classList.toggle('on', state[key]);
    render();
  });
}
bindToggle('togSpots', 'showSpots');
bindToggle('togBuoys', 'showBuoys');
bindToggle('togStorms', 'showStorms');
bindToggle('togFavs', 'favsOnly');

// ── 11. ZOOM CONTROLS ────────────────────────────────────────────────────────
document.getElementById('zoomIn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoomOut').addEventListener('click', () => map.zoomOut());
document.getElementById('locateMe').addEventListener('click', () => map.flyTo([35.5, -120.5], 6, { duration: 0.9 }));

// ── 12. SEARCH ───────────────────────────────────────────────────────────────
const searchInput = document.getElementById('searchInput');
let searchTimer;
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    if (state.query) {
      const q = state.query.toLowerCase();
      const match = SPOTS.find((s) => s.name.toLowerCase().includes(q) || s.region.toLowerCase().includes(q));
      if (match) map.flyTo([match.lat, match.lon], 8, { duration: 0.9 });
    }
    render();
  }, 250);
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (e.key === 'Escape') {
    previewCard.classList.remove('show');
    stormPreviewCard.classList.remove('show');
    if (document.activeElement === searchInput) searchInput.blur();
  }
});

// ── 13. RE-RENDER ON MOVE ────────────────────────────────────────────────────
let renderTimer;
function queueRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 80);
}
map.on('moveend', queueRender);
map.on('zoomend', queueRender);

// Initial render once map is ready
map.whenReady(() => {
  render();
  setTimeout(() => map.invalidateSize(), 150);
});
