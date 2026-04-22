// MapBackground.jsx — proper-looking world map with recognizable continents

// Simplified equirectangular continent polygons (lon,lat -> viewBox coords).
// These are hand-simplified outlines accurate enough to read as a world map.
// viewBox is 1600x900, using equirectangular (lon -180..180 -> 0..1600, lat 90..-90 -> 0..900)
function ll(lon, lat) {
  const x = ((lon + 180) / 360) * 1600;
  const y = ((90 - lat) / 180) * 900;
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}
function poly(pts) { return pts.map(p => ll(p[0], p[1])).join(' '); }

// Continent outlines — simplified but geographically faithful
const NORTH_AMERICA = [
  [-168,66],[-156,71],[-140,70],[-128,70],[-115,73],[-100,72],[-85,70],[-75,78],[-65,83],[-55,83],[-52,75],
  [-60,66],[-62,60],[-68,58],[-65,52],[-55,50],[-52,47],[-62,44],[-68,44],[-75,38],[-76,35],[-81,28],[-82,25],
  [-84,30],[-88,30],[-94,29],[-97,26],[-102,23],[-110,23],[-115,30],[-118,33],[-123,38],[-125,43],[-125,49],
  [-130,55],[-138,58],[-145,60],[-155,58],[-160,56],[-167,54],[-170,62],[-168,66]
];

const SOUTH_AMERICA = [
  [-81,12],[-75,11],[-70,12],[-60,10],[-52,5],[-50,0],[-48,-3],[-40,-5],[-35,-8],[-37,-15],[-42,-22],[-48,-28],
  [-54,-34],[-58,-38],[-62,-41],[-66,-45],[-70,-52],[-72,-55],[-70,-50],[-73,-45],[-74,-40],[-72,-35],[-72,-30],
  [-70,-22],[-71,-18],[-76,-14],[-80,-6],[-80,-3],[-78,1],[-77,6],[-81,8],[-81,12]
];

const EUROPE_WEST = [
  [-10,38],[-9,42],[-2,43],[0,44],[3,43],[6,43],[8,44],[13,45],[18,45],[20,42],[24,40],[27,38],[23,37],[15,38],
  [12,37],[8,39],[1,36],[-6,36],[-10,38]
];
const EUROPE_NORTH = [
  [-5,50],[2,51],[7,53],[10,54],[13,54],[14,56],[12,58],[8,58],[5,60],[7,63],[12,65],[15,68],[20,70],[25,71],
  [30,69],[40,68],[50,66],[55,70],[67,73],[70,68],[60,62],[55,58],[45,54],[40,50],[32,48],[28,47],[20,50],[15,52],
  [10,52],[5,52],[0,52],[-5,54],[-8,55],[-5,50]
];
const UK_IRELAND = [
  [-5,54],[-4,56],[-2,58],[0,58],[2,57],[1,54],[0,51],[-4,50],[-6,52],[-5,54]
];

const AFRICA = [
  [-16,14],[-10,12],[-5,6],[5,5],[10,4],[14,6],[20,10],[25,15],[30,20],[33,27],[32,30],[33,32],[34,32],[43,12],
  [51,12],[43,4],[42,-4],[40,-12],[38,-20],[33,-26],[28,-32],[20,-35],[15,-34],[14,-28],[13,-20],[10,-12],[8,-4],
  [4,0],[0,5],[-10,8],[-15,12],[-16,14]
];

const ASIA = [
  [30,35],[40,40],[45,42],[55,42],[60,45],[65,55],[75,60],[85,65],[95,70],[105,72],[115,74],[130,72],[140,70],
  [150,68],[160,65],[170,65],[175,65],[180,67],[180,62],[160,58],[148,58],[142,55],[140,50],[135,45],[130,42],
  [125,40],[125,35],[130,33],[128,35],[123,38],[120,37],[119,32],[118,25],[112,21],[109,12],[106,10],[100,13],
  [95,17],[92,22],[88,22],[82,20],[75,22],[67,25],[58,25],[50,28],[43,12],[51,12],[43,4]
];
const INDIA = [
  [70,24],[72,20],[75,8],[78,9],[80,13],[82,18],[85,20],[88,21],[92,22],[88,25],[82,26],[78,28],[74,26],[70,24]
];

const SE_ASIA = [
  [95,5],[100,5],[105,2],[110,-2],[115,-3],[118,-5],[122,-8],[127,-8],[132,-4],[140,-3],[145,-6],[146,-8],[140,-10],
  [130,-9],[120,-9],[115,-8],[110,-7],[105,-5],[100,-2],[97,2],[95,5]
];

const AUSTRALIA = [
  [114,-22],[115,-28],[118,-35],[125,-33],[130,-32],[135,-35],[140,-38],[145,-38],[150,-37],[153,-35],[153,-28],
  [150,-22],[145,-15],[140,-12],[135,-12],[132,-14],[125,-15],[120,-17],[115,-20],[114,-22]
];
const NZ_N = [[172,-35],[175,-37],[177,-39],[175,-41],[172,-40],[172,-35]];
const NZ_S = [[167,-43],[172,-42],[174,-45],[170,-47],[166,-46],[167,-43]];

const GREENLAND = [
  [-52,83],[-30,83],[-20,78],[-22,70],[-35,60],[-48,60],[-53,65],[-58,70],[-52,83]
];

const JAPAN = [
  [135,34],[137,36],[140,38],[142,40],[141,42],[143,43],[141,45],[138,42],[136,38],[133,34],[131,33],[130,32],[132,34],[135,34]
];
const PHILIPPINES = [[120,18],[122,17],[124,12],[126,8],[124,6],[120,10],[120,13],[120,18]];
const MADAGASCAR = [[43,-12],[47,-15],[50,-20],[48,-25],[44,-22],[43,-18],[43,-12]];
const BRITAIN = [[-5,50],[-4,51],[-3,53],[-5,55],[-5,58],[-3,58],[-1,56],[1,54],[1,52],[-2,51],[-5,50]];
const ICELAND = [[-24,64],[-22,66],[-18,66],[-14,65],[-18,64],[-22,63],[-24,64]];

function MapBackground({ theme, showWind = true, showSwell = true, animated = true }) {
  const isDawn = theme === 'dawn';
  const isDay = theme === 'daylight';
  // Ocean: deep → shallow gradient (bathymetry illusion)
  const oceanDeep = isDay ? '#c8dce8' : isDawn ? '#0b0e14' : '#06101a';
  const oceanMid  = isDay ? '#d8e6ed' : isDawn ? '#141922' : '#0d1c2a';
  const oceanShallow = isDay ? '#e5eef2' : isDawn ? '#1a2030' : '#12263a';

  const landBase   = isDay ? '#eae3d4' : isDawn ? '#1e1912' : '#0f1a21';
  const landHi     = isDay ? '#f3ecde' : isDawn ? '#2a2218' : '#18262f';
  const landStroke = isDay ? '#b8ad95' : isDawn ? '#3a2e20' : '#22323e';
  const graticule  = isDay ? 'rgba(60,100,130,0.08)' : isDawn ? 'rgba(220,180,140,0.055)' : 'rgba(120,200,220,0.06)';
  const graticuleMajor = isDay ? 'rgba(60,100,130,0.18)' : isDawn ? 'rgba(220,180,140,0.11)' : 'rgba(120,200,220,0.12)';

  const accent = isDay ? '#1e62d6' : isDawn ? '#ff8a5b' : '#4dd9d1';
  const windStroke = isDay ? 'rgba(30,80,140,0.35)' : isDawn ? 'rgba(255,180,120,0.32)' : 'rgba(140,220,240,0.30)';

  // swell source points (lon,lat in equirect)
  const swellSources = [
    { lon: -160, lat: 40, r: 260, delay: 0 },    // N Pacific
    { lon: -30,  lat: 45, r: 210, delay: 1.2 },  // N Atlantic
    { lon: -130, lat: -45, r: 230, delay: 2.4 }, // S Pacific
    { lon: 70,   lat: -40, r: 200, delay: 0.8 }, // S Indian
  ];

  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <radialGradient id="ocean" cx="50%" cy="45%" r="80%">
          <stop offset="0%" stopColor={oceanShallow} />
          <stop offset="55%" stopColor={oceanMid} />
          <stop offset="100%" stopColor={oceanDeep} />
        </radialGradient>
        <linearGradient id="landGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={landHi} />
          <stop offset="100%" stopColor={landBase} />
        </linearGradient>
        <pattern id="graticule" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M80 0 L0 0 0 80" fill="none" stroke={graticule} strokeWidth="1" />
        </pattern>
        <filter id="landShadow" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="1.5" result="b"/>
          <feOffset dx="1" dy="2" in="b" result="o"/>
          <feComponentTransfer in="o" result="oo"><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
          <feMerge><feMergeNode in="oo"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Ocean */}
      <rect width="1600" height="900" fill="url(#ocean)" />

      {/* Bathymetry rings (subtle contours around continents) */}
      <g fill="none" stroke={isDawn ? 'rgba(220,180,140,0.03)' : 'rgba(120,200,220,0.04)'} strokeWidth="0.8">
        <circle cx="400" cy="450" r="220" />
        <circle cx="400" cy="450" r="280" />
        <circle cx="1180" cy="400" r="240" />
        <circle cx="1400" cy="650" r="180" />
      </g>

      {/* Graticule grid */}
      <rect width="1600" height="900" fill="url(#graticule)" />

      {/* Major lat/lon lines */}
      <g stroke={graticuleMajor} strokeWidth="0.8" fill="none">
        {/* Equator */}
        <line x1="0" y1="450" x2="1600" y2="450" />
        {/* Tropics */}
        <line x1="0" y1="335" x2="1600" y2="335" strokeDasharray="2 6"/>
        <line x1="0" y1="565" x2="1600" y2="565" strokeDasharray="2 6"/>
        {/* Prime meridian */}
        <line x1="800" y1="0" x2="800" y2="900" />
        <line x1="400" y1="0" x2="400" y2="900" strokeDasharray="2 6"/>
        <line x1="1200" y1="0" x2="1200" y2="900" strokeDasharray="2 6"/>
      </g>

      {/* Swell rings — on ocean, at known swell-generating regions */}
      {showSwell && (
        <g opacity="0.65">
          {swellSources.map((s, i) => {
            const [cx, cy] = ll(s.lon, s.lat).split(',').map(parseFloat);
            return <SwellRing key={i} cx={cx} cy={cy} maxR={s.r} color={accent} delay={s.delay} anim={animated} />;
          })}
        </g>
      )}

      {/* Continents */}
      <g fill="url(#landGrad)" stroke={landStroke} strokeWidth="1" strokeLinejoin="round" filter="url(#landShadow)">
        <polygon points={poly(NORTH_AMERICA)} />
        <polygon points={poly(SOUTH_AMERICA)} />
        <polygon points={poly(EUROPE_NORTH)} />
        <polygon points={poly(EUROPE_WEST)} />
        <polygon points={poly(BRITAIN)} />
        <polygon points={poly(ICELAND)} />
        <polygon points={poly(GREENLAND)} />
        <polygon points={poly(AFRICA)} />
        <polygon points={poly(ASIA)} />
        <polygon points={poly(INDIA)} />
        <polygon points={poly(SE_ASIA)} />
        <polygon points={poly(JAPAN)} />
        <polygon points={poly(PHILIPPINES)} />
        <polygon points={poly(MADAGASCAR)} />
        <polygon points={poly(AUSTRALIA)} />
        <polygon points={poly(NZ_N)} />
        <polygon points={poly(NZ_S)} />
      </g>

      {/* Coastline highlight */}
      <g fill="none" stroke={isDay ? 'rgba(30,80,140,0.25)' : isDawn ? 'rgba(255,200,150,0.18)' : 'rgba(160,220,240,0.18)'} strokeWidth="0.6">
        <polygon points={poly(NORTH_AMERICA)} />
        <polygon points={poly(SOUTH_AMERICA)} />
        <polygon points={poly(EUROPE_NORTH)} />
        <polygon points={poly(AFRICA)} />
        <polygon points={poly(ASIA)} />
        <polygon points={poly(AUSTRALIA)} />
      </g>

      {/* Wind flow field */}
      {showWind && <WindParticles color={windStroke} animated={animated} />}

      {/* Region labels — subtle typography */}
      <g fill={isDay ? 'rgba(30,80,140,0.40)' : isDawn ? 'rgba(220,180,140,0.35)' : 'rgba(160,220,240,0.30)'} fontFamily="Geist Mono, monospace" fontSize="9" letterSpacing="2">
        <text x="300" y="200" textAnchor="middle">N. PACIFIC</text>
        <text x="740" y="200" textAnchor="middle">N. ATLANTIC</text>
        <text x="1350" y="250" textAnchor="middle">W. PACIFIC</text>
        <text x="300" y="620" textAnchor="middle">S. PACIFIC</text>
        <text x="720" y="620" textAnchor="middle">S. ATLANTIC</text>
        <text x="1100" y="620" textAnchor="middle">INDIAN</text>
        <text x="1450" y="700" textAnchor="middle">TASMAN</text>
      </g>

      {/* Scale + compass bottom-right */}
      <g transform="translate(1450, 820)" fill={isDay ? 'rgba(30,80,140,0.5)' : isDawn ? 'rgba(220,180,140,0.4)' : 'rgba(160,220,240,0.4)'}
         fontFamily="Geist Mono, monospace" fontSize="9" letterSpacing="1">
        <line x1="0" y1="0" x2="120" y2="0" stroke="currentColor" strokeWidth="1"/>
        <line x1="0" y1="-4" x2="0" y2="4" stroke="currentColor" strokeWidth="1"/>
        <line x1="60" y1="-3" x2="60" y2="3" stroke="currentColor" strokeWidth="1"/>
        <line x1="120" y1="-4" x2="120" y2="4" stroke="currentColor" strokeWidth="1"/>
        <text x="60" y="16" textAnchor="middle">2000 KM</text>
      </g>
    </svg>
  );
}

function SwellRing({ cx, cy, maxR, color, delay, anim }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={maxR * 0.35} fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1">
        {anim && <animate attributeName="r" from={maxR * 0.15} to={maxR * 0.95} dur="7s" begin={`${delay}s`} repeatCount="indefinite" />}
        {anim && <animate attributeName="stroke-opacity" from="0.45" to="0" dur="7s" begin={`${delay}s`} repeatCount="indefinite" />}
      </circle>
      <circle cx={cx} cy={cy} r={maxR * 0.55} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1">
        {anim && <animate attributeName="r" from={maxR * 0.15} to={maxR * 1.25} dur="7s" begin={`${delay + 2.3}s`} repeatCount="indefinite" />}
        {anim && <animate attributeName="stroke-opacity" from="0.35" to="0" dur="7s" begin={`${delay + 2.3}s`} repeatCount="indefinite" />}
      </circle>
      <circle cx={cx} cy={cy} r="2.5" fill={color} opacity="0.8" />
    </g>
  );
}

function WindParticles({ color, animated }) {
  const lines = [];
  const rows = 14, cols = 24;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c * 2) % 4 === 0) continue;
      const x = 30 + c * 66 + (r % 2) * 33;
      const y = 40 + r * 60;
      // Trade winds pattern: westerlies at mid lat, easterlies at tropics
      const lat = 90 - (y / 900) * 180;
      let angle;
      if (Math.abs(lat) < 30) angle = 180 + Math.sin(x / 300) * 15; // easterlies (toward west)
      else angle = Math.sin(x / 250) * 20; // westerlies (toward east)
      const rad = (angle * Math.PI) / 180;
      const len = 14;
      const x2 = x + Math.cos(rad) * len;
      const y2 = y + Math.sin(rad) * len;
      lines.push(
        <g key={`${r}-${c}`} opacity={0.5}>
          <line x1={x} y1={y} x2={x2} y2={y2} stroke={color} strokeWidth="1" strokeLinecap="round">
            {animated && <animate attributeName="opacity" values="0.1;0.5;0.1" dur={`${3 + (r + c) % 4}s`} begin={`${((r * 3 + c) % 9) * 0.25}s`} repeatCount="indefinite" />}
          </line>
          <circle cx={x2} cy={y2} r="1.1" fill={color} />
        </g>
      );
    }
  }
  return <g>{lines}</g>;
}

Object.assign(window, { MapBackground });
