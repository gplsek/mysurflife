import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl, useMap, Pane, useMapEvents } from 'react-leaflet';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import WindGrid from './WindGrid';
import WindCanvasLayer from './WindCanvasLayer';
import WindParticlesLayer from './WindParticlesLayer';
import WindSpeedLegend from './WindSpeedLegend';
import WindField from './WindField';
import WaveCanvasLayer from './WaveCanvasLayer';
import WaveParticlesLayer from './WaveParticlesLayer';
import WaveHeightLegend from './WaveHeightLegend';
import WaveField from './WaveField';

const { BaseLayer } = LayersControl;

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import markerRetina from 'leaflet/dist/images/marker-icon-2x.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerRetina,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const getIcon = (score) => {
  const color = {
    3: 'green',
    2: 'orange',
    1: 'red',
    0: 'grey',
  }[score] || 'grey';

  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
};

// Surf spot icon (different from buoy markers)
const getSurfSpotIcon = (score) => {
  // Color-code by surf score (0-10 scale)
  let color, emoji;
  if (score >= 8.5) {
    color = '#ef4444'; // Red for Epic (fire)
    emoji = '🔥';
  } else if (score >= 7.0) {
    color = '#22c55e'; // Green for Good
    emoji = '🟢';
  } else if (score >= 5.0) {
    color = '#f59e0b'; // Orange for Fair
    emoji = '🟡';
  } else if (score >= 3.0) {
    color = '#fbbf24'; // Gold for Poor
    emoji = '🟠';
  } else {
    color = '#9ca3af'; // Grey for Flat
    emoji = '🔴';
  }

  return new L.DivIcon({
    className: 'surf-spot-marker',
    html: `
      <div style="
        background-color: ${color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
      ">
        🏄
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
};

// Conversion functions
const metersToFeet = (m) => m * 3.28084;
const celsiusToFahrenheit = (c) => (c * 9/5) + 32;
const msToMph = (ms) => ms * 2.23694;
const msToKph = (ms) => ms * 3.6;
const msToKnots = (ms) => ms * 1.94384;

// Direction Arrow Component
const DirectionArrow = ({ degrees, color = '#333', size = 20 }) => {
  if (!degrees && degrees !== 0) return null;
  
  // Add 180° because meteorological convention: degrees show where it's FROM
  // Arrow shows where it's GOING (opposite direction)
  const rotationDegrees = degrees + 180;
  
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      style={{ 
        display: 'inline-block', 
        verticalAlign: 'middle',
        marginLeft: '6px',
        transform: `rotate(${rotationDegrees}deg)`,
        transition: 'transform 0.3s ease'
      }}
    >
      <path 
        d="M12 2 L12 18 M12 2 L8 6 M12 2 L16 6" 
        stroke={color} 
        strokeWidth="2" 
        fill="none" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  );
};

// Trend Indicator Component
const TrendIndicator = ({ trend }) => {
  if (!trend) return null;
  
  const trendConfig = {
    rising: { 
      icon: '↑', 
      color: '#22c55e', 
      text: 'Rising - waves building',
      path: 'M12 19 L12 5 M12 5 L8 9 M12 5 L16 9'
    },
    holding: { 
      icon: '→', 
      color: '#3b82f6', 
      text: 'Holding - steady conditions',
      path: 'M5 12 L19 12 M19 12 L15 8 M19 12 L15 16'
    },
    falling: { 
      icon: '↓', 
      color: '#ef4444', 
      text: 'Falling - waves dropping',
      path: 'M12 5 L12 19 M12 19 L8 15 M12 19 L16 15'
    }
  };
  
  const config = trendConfig[trend] || trendConfig.holding;
  
  return (
    <span 
      title={config.text} 
      style={{ 
        cursor: 'pointer',
        display: 'inline-block',
        position: 'relative'
      }}
    >
      <svg 
        width={18} 
        height={18} 
        viewBox="0 0 24 24" 
        style={{ 
          display: 'inline-block', 
          verticalAlign: 'middle',
          marginLeft: '6px'
        }}
      >
        <path 
          d={config.path}
          stroke={config.color} 
          strokeWidth="2.5" 
          fill="none" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
};

const scoreBuoy = (b) => {
  const surfHeight = b.surf_height_m;
  const period = parseFloat(b.dominant_period_sec);
  const dir = parseFloat(b.mean_wave_dir);
  const energy = b.wave_energy;

  if (!surfHeight || isNaN(period) || isNaN(dir)) return 0;
  
  // Convert surf face height to feet for scoring
  const surfFt = metersToFeet(surfHeight);
  
  // Enhanced scoring with energy consideration
  let score = 0;
  
  // Base score on surf face height and period
  if (surfFt >= 6 && period >= 14 && dir >= 250 && dir <= 310) {
    score = 3; // Epic - Large, long period, good direction
  } else if (surfFt >= 4 && period >= 12 && dir >= 240 && dir <= 320) {
    score = 3; // Excellent - Good size, period, and direction
  } else if (surfFt >= 3 && period >= 10 && dir >= 230 && dir <= 330) {
    score = 2; // Good - Decent size and period
  } else if (surfFt >= 2 && period >= 8) {
    score = 1; // Fair - Small but rideable
  } else {
    score = 0; // Poor - Too small or short period
  }
  
  // Boost score if high energy (powerful waves)
  if (energy && energy > 100 && score > 0) {
    score = Math.min(3, score + 0.5); // Can boost by half a point
  }
  
  return Math.floor(score);
};

// Component to get map instance and expose it to parent
function MapRefExposer({ onMapReady }) {
  const map = useMap();
  
  useEffect(() => {
    if (map && onMapReady) {
      onMapReady(map);
    }
  }, [map, onMapReady]);
  
  return null;
}

export default function MapOverlay({ showBuoys: showBuoysProp, showSurfSpots: showSurfSpotsProp, overlayType: overlayTypeProp, onOverlayChange }) {
  const [buoys, setBuoys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedBuoy, setSelectedBuoy] = useState(null);
  const [showChart, setShowChart] = useState(false);
  const [historicalData, setHistoricalData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [showForecast, setShowForecast] = useState(false);
  const [forecastData, setForecastData] = useState([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  
  // Overlay states - only one overlay type at a time (wind OR swell)
  // Wind Overlay - MVP (simplified) - default OFF on page load
  const [windOverlayEnabled, setWindOverlayEnabled] = useState(false);
  const [windData, setWindData] = useState(null);
  
  // Overlay type management
  const [overlayTypeInternal, setOverlayType] = useState('none'); // 'none', 'wind', 'waves' (default to none - buoys only)
  const overlayType = overlayTypeProp !== undefined ? overlayTypeProp : overlayTypeInternal;
  const [currentZoom, setCurrentZoom] = useState(6); // Track current map zoom for UI updates
  const [selectedWindModel, setSelectedWindModel] = useState('gfs');
  const [overlayData, setOverlayData] = useState({});
  const [showWindParticles, setShowWindParticles] = useState(true); // Toggle for particle layer
  const [windProbe, setWindProbe] = useState(null); // { lat, lng } for wind probe popup
  const windFieldRef = useRef(null); // Cached WindField instance for probe
  
  // Wave overlay state
  const [waveData, setWaveData] = useState(null);
  const [showWaveParticles, setShowWaveParticles] = useState(false); // Default off
  const [waveProbe, setWaveProbe] = useState(null); // { lat, lng } for wave probe popup
  const waveFieldRef = useRef(null); // Cached WaveField instance for probe

  // Wave frames (time slider) state
  const [waveFrames, setWaveFrames] = useState(null); // {model, run, date, cycle, hours, times_utc}
  const [waveFramesLoading, setWaveFramesLoading] = useState(false);
  const [waveFramesCache, setWaveFramesCache] = useState(null); // Client-side cache: {data, cachedAt}
  const waveFramesCacheRef = useRef(null); // Ref to track cache without triggering re-renders
  const [selectedWaveFrameIndex, setSelectedWaveFrameIndex] = useState(0);
  const [isWavePlaying, setIsWavePlaying] = useState(false);
  const [hoveredWaveFrameIndex, setHoveredWaveFrameIndex] = useState(null);
  const wavePlayTimerRef = useRef(null);

  // PERFORMANCE: Render token for wave canvas stale-render prevention
  const waveRenderTokenRef = useRef(0);

  // V2: Fetch debounce timers + AbortControllers for wind and wave overlay fetches
  const windFetchDebounceRef = useRef(null);
  const waveFetchDebounceRef = useRef(null);
  const windFetchAbortRef = useRef(null);
  const waveFetchAbortRef = useRef(null);
  // V2: Idle-prefetch timers (fire ±3/±6 frame warmup after 400ms of slider inactivity)
  const windIdlePrefetchRef = useRef(null);
  const waveIdlePrefetchRef = useRef(null);
  // Refs that mirror wave state so they're accessible inside fetch-effect closures without
  // adding them to the dependency array (which would cause extra re-runs)
  const waveFramesRef = useRef(null);
  const selectedWaveFrameIndexRef = useRef(0);

  // Wind frames (time slider) state
  const [windFrames, setWindFrames] = useState(null); // {model, run, date, cycle, hours, cadence_note}
  const [windFramesLoading, setWindFramesLoading] = useState(false);
  const [windFramesCache, setWindFramesCache] = useState(null); // Client-side cache: {data, cachedAt, model}
  const windFramesCacheRef = useRef(null); // Ref to track cache without triggering re-renders
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredFrameIndex, setHoveredFrameIndex] = useState(null);
  
  // Derived: selected forecast hour and timestamp from frames
  const selectedForecastHour = windFrames?.hours?.[selectedFrameIndex];
  const selectedTimeUtc = windFrames?.times_utc?.[selectedFrameIndex] ?? null;
  
  // Format timestamps for display
  const forecastDate = selectedTimeUtc ? new Date(selectedTimeUtc) : null;
  const forecastUtcLabel = forecastDate ? forecastDate.toUTCString() : "—";
  const forecastLocalLabel = forecastDate ? forecastDate.toLocaleString() : "—";

  // Surf spots state
  const [surfSpots, setSurfSpots] = useState([]);
  const [surfSpotsLoading, setSurfSpotsLoading] = useState(false);
  const [showSurfSpotsInternal, setShowSurfSpotsInternal] = useState(() => {
    const saved = localStorage.getItem('showSurfSpots');
    return saved !== null ? saved === 'true' : true;
  });
  const showSurfSpots = typeof showSurfSpotsProp === 'boolean' ? showSurfSpotsProp : showSurfSpotsInternal;
  const setShowSurfSpots = setShowSurfSpotsInternal;

  const [showBuoysInternal, setShowBuoysInternal] = useState(() => {
    const saved = localStorage.getItem('showBuoys');
    return saved !== null ? saved === 'true' : true;
  });
  const showBuoys = typeof showBuoysProp === 'boolean' ? showBuoysProp : showBuoysInternal;
  const setShowBuoys = setShowBuoysInternal;
  const [selectedSpot, setSelectedSpot] = useState(null); // For detail panel
  
  // Compute daily tick metadata for footer timeline (Windy-style)
  const timesUtc = windFrames?.times_utc ?? [];
  let lastDay = null;
  const dailyTicks = timesUtc
    .map((t, idx) => {
      const d = new Date(t);
      const dayKey = d.toISOString().split('T')[0]; // YYYY-MM-DD
      const isNewDay = dayKey !== lastDay;
      lastDay = dayKey;
      
      return isNewDay ? {
        idx,
        label: d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' }),
        date: d
      } : null;
    })
    .filter(t => t !== null); // Only keep day boundaries

  // Derived: selected forecast hour and timestamp from wave frames
  const selectedWaveForecastHour = waveFrames?.hours?.[selectedWaveFrameIndex] ?? 0;
  const selectedWaveTimeUtc = waveFrames?.times_utc?.[selectedWaveFrameIndex] ?? null;

  // Format timestamps for display (wave)
  const waveForecastDate = selectedWaveTimeUtc ? new Date(selectedWaveTimeUtc) : null;
  const waveForecastUtcLabel = waveForecastDate ? waveForecastDate.toUTCString() : "—";
  const waveForecastLocalLabel = waveForecastDate ? waveForecastDate.toLocaleString() : "—";

  // Compute daily tick metadata for wave timeline
  const waveTimesUtc = waveFrames?.times_utc ?? [];
  let lastWaveDay = null;
  const waveDailyTicks = waveTimesUtc
    .map((t, idx) => {
      const d = new Date(t);
      const dayKey = d.toISOString().split('T')[0]; // YYYY-MM-DD
      const isNewDay = dayKey !== lastWaveDay;
      lastWaveDay = dayKey;

      return isNewDay ? {
        idx,
        label: d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' }),
        date: d
      } : null;
    })
    .filter(t => t !== null); // Only keep day boundaries

  // Timeline time formatting helpers
  const formatTimelineDayTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const day = d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' });
    if (timezone === 'utc') {
      const hh = String(d.getUTCHours()).padStart(2, '0');
      return `${day} ${hh}:00Z`;
    }
    return `${day} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  };

  const formatTimelineHourOnly = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (timezone === 'utc') {
      const hh = String(d.getUTCHours()).padStart(2, '0');
      return `${hh}:00Z`;
    }
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  
  // Map reference
  const mapRef = useRef(null);
  
  // Animation and caching refs
  const playTimerRef = useRef(null);
  const windDataCacheRef = useRef(new Map()); // key: `${model}|${bbox}|${hour}`
  const waveDataCacheRef = useRef(new Map()); // key: `${model}|${bbox}|${hour}`

  // Round bbox to 0.25° grid (matches backend rounding for cache sharing)
  // This dramatically improves cache hit rates during zoom
  const roundBbox = useCallback((bbox) => {
    const parts = bbox.split(',').map(Number);
    if (parts.length !== 4) return bbox;

    const [minLat, minLon, maxLat, maxLon] = parts;
    const gridSize = 0.25;

    const roundedMinLat = Math.floor(minLat / gridSize) * gridSize;
    const roundedMinLon = Math.floor(minLon / gridSize) * gridSize;
    const roundedMaxLat = Math.ceil(maxLat / gridSize) * gridSize;
    const roundedMaxLon = Math.ceil(maxLon / gridSize) * gridSize;

    return `${roundedMinLat},${roundedMinLon},${roundedMaxLat},${roundedMaxLon}`;
  }, []);

  // Helper to build cache keys
  const makeWindKey = useCallback(({ model, bbox, hour }) => `${model}|${bbox}|${hour}`, []);
  const makeWaveKey = useCallback(({ model, bbox, hour, source = 'global' }) => {
    const roundedBbox = roundBbox(bbox); // Round to match backend cache key
    return `${model}|${roundedBbox}|${hour}|${source}`;
  }, [roundBbox]);
  
  // Fetch wind frame with caching
  const fetchWindFrame = useCallback(async ({ model, bbox, hour, signal }) => {
    const key = makeWindKey({ model, bbox, hour });

    // Return cached data if available
    if (windDataCacheRef.current.has(key)) {
      console.log(`📦 Using cached wind data for ${model} hour ${hour}`);
      return windDataCacheRef.current.get(key);
    }

    // Fetch new data
    const url = `/api/wind-overlay?model=${model}&forecast_hour=${hour}&bounds=${bbox}&real_data=true`;
    console.log(`🌬️ Fetching wind overlay: forecast_hour=${hour}, bounds=${bbox}`);

    try {
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      // Cache the result
      windDataCacheRef.current.set(key, data);
      console.log(`✅ Cached wind overlay frame: +${hour}h, vectors: ${data.vectors?.length ?? 0}`);

      return data;
    } catch (err) {
      if (err.name !== 'AbortError') console.error(`❌ Error fetching wind frame:`, err);
      throw err;
    }
  }, [makeWindKey]);
  
  // Fetch wave data with caching and zoom-based source selection
  const fetchWaveData = useCallback(async ({ model, bbox, hour = 0, zoom = null, signal }) => {
    // Minimum zoom level check - prevent massive bbox requests at low zoom
    // At zoom < 4, the bbox becomes too large (entire Pacific) and causes:
    // 1. OPeNDAP timeouts or very slow responses
    // 2. Too much data to render (tens of thousands of vectors)
    // 3. Poor user experience (nothing renders for many seconds)
    const MIN_ZOOM = 4;
    if (zoom !== null && zoom < MIN_ZOOM) {
      console.warn(`⚠️ Wave overlay requires zoom ≥ ${MIN_ZOOM} (current: ${zoom}). Zoom in to see wave data.`);
      return { vectors: [], debug: { message: `Zoom in to see wave data (minimum zoom: ${MIN_ZOOM})` } };
    }

    // Determine source based on zoom level (like Windy.com)
    // Zoom ≤ 6: global (WW3/GFSWave for offshore context)
    // Zoom 7-9: regional (future: higher-res regional model)
    // Zoom ≥ 10: nearshore (future: coastal detail model)
    let source = 'global';
    if (zoom !== null) {
      if (zoom >= 10) {
        source = 'nearshore';
      } else if (zoom >= 7) {
        source = 'regional';
      } else {
        source = 'global';
      }
    }
    
    const key = makeWaveKey({ model, bbox, hour, source });
    
    // Return cached data if available
    if (waveDataCacheRef.current.has(key)) {
      console.log(`📦 Using cached wave data for ${model} hour ${hour} source ${source}`);
      return waveDataCacheRef.current.get(key);
    }
    
    // Fetch new data with source parameter
    const url = `/api/waves-overlay?model=${model}&forecast_hour=${hour}&bounds=${bbox}&source=${source}`;
    console.log(`🌊 Fetching wave overlay: forecast_hour=${hour}, bounds=${bbox}, source=${source} (zoom=${zoom})`);
    
    try {
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const rawData = await res.json();

      // Normalize and validate vectors (Task S2)
      if (rawData.vectors && Array.isArray(rawData.vectors)) {
        const normalizedVectors = rawData.vectors.map(v => {
          // Normalize property names
          const normalized = {
            lat: v.lat ?? v.latitude,
            lon: v.lon ?? v.lng ?? v.longitude,
            hs: v.hs ?? v.wave_height_m ?? v.height_m ?? v.height,
            dir_deg: v.dir_deg ?? v.dir ?? v.direction_deg ?? v.direction
          };
          
          // Validate lat/lon ranges
          if (normalized.lat < -90 || normalized.lat > 90) {
            console.warn(`Invalid lat: ${normalized.lat}`, v);
          }
          if (normalized.lon < -180 || normalized.lon > 180) {
            console.warn(`Invalid lon: ${normalized.lon}`, v);
          }
          
          return normalized;
        }).filter(v => 
          v.lat != null && v.lon != null && 
          v.hs != null && v.dir_deg != null &&
          v.lat >= -90 && v.lat <= 90 &&
          v.lon >= -180 && v.lon <= 180
        );
        
        // Log debug info (Task S2)
        console.log('🌊 Wave data received:', {
          rawCount: rawData.vectors.length,
          normalizedCount: normalizedVectors.length,
          debug: rawData.debug,
          first3: normalizedVectors.slice(0, 3)
        });
        
        // Replace vectors with normalized ones
        rawData.vectors = normalizedVectors;
      }
      
      // Cache the result
      waveDataCacheRef.current.set(key, rawData);
      console.log(`✅ Cached wave overlay frame: +${hour}h, vectors: ${rawData.vectors?.length ?? 0}`);
      
      return rawData;
    } catch (err) {
      if (err.name !== 'AbortError') console.error(`❌ Error fetching wave data:`, err);
      throw err;
    }
  }, [makeWaveKey]);
  
  // Mobile view state
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  
  // Load preferences from localStorage or use defaults
  const [units, setUnits] = useState(() => localStorage.getItem('units') || 'imperial');
  const [timezone, setTimezone] = useState(() => localStorage.getItem('timezone') || 'local');

  // Save preferences to localStorage when they change
  useEffect(() => {
    localStorage.setItem('units', units);
  }, [units]);

  useEffect(() => {
    localStorage.setItem('timezone', timezone);
  }, [timezone]);

  useEffect(() => {
    localStorage.setItem('showBuoys', showBuoysInternal.toString());
  }, [showBuoysInternal]);

  useEffect(() => {
    localStorage.setItem('showSurfSpots', showSurfSpotsInternal.toString());
  }, [showSurfSpotsInternal]);

  // Sync overlayType prop from App.js into internal state so useEffects fire correctly
  useEffect(() => {
    if (overlayTypeProp !== undefined && overlayTypeProp !== overlayTypeInternal) {
      setOverlayType(overlayTypeProp);
      if (overlayTypeProp === 'wind') {
        fetchWindOverlay(selectedWindModel);
      }
    }
  // eslint-disable-line
  }, [overlayTypeProp]);

  // Track map zoom level for UI updates (warning messages, etc.)
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Set initial zoom
    setCurrentZoom(map.getZoom());

    // Update zoom on change
    const handleZoomChange = () => {
      setCurrentZoom(map.getZoom());
    };

    map.on('zoomend', handleZoomChange);

    return () => {
      map.off('zoomend', handleZoomChange);
    };
  }, [mapRef.current]);

  const fetchBuoyData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/buoy-status/all');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBuoys(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching buoy data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSurfSpots = async () => {
    try {
      setSurfSpotsLoading(true);
      // Fetch with scores for real-time conditions
      const res = await fetch('/api/surf-spots?with_scores=true');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSurfSpots(data.spots || []);
      console.log(`✅ Loaded ${data.count} surf spots with current conditions`);
    } catch (err) {
      console.error('❌ Error fetching surf spots:', err);
      setSurfSpots([]);
    } finally {
      setSurfSpotsLoading(false);
    }
  };

  // Fetch wind overlay data (MVP)
  const fetchWindData = async () => {
    try {
      console.log('🌬️ Fetching wind overlay data...');
      const res = await fetch('/api/wind-overlay?model=gfs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(`✅ Wind data received: ${data.vectors?.length || 0} vectors`);
      setWindData(data);
    } catch (err) {
      console.error('❌ Error fetching wind data:', err);
      setWindData(null);
    }
  };

  const fetchHistoricalData = async (stationId, hours = 48) => {
    try {
      setChartLoading(true);
      setChartError(null);
      const res = await fetch(`/api/buoy-history/${stationId}?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      
      if (result.error) {
        setChartError(result.error);
        setHistoricalData([]);
        return;
      }
      
      // Transform data for Recharts
      const chartData = result.data.map(point => ({
        time: new Date(point.timestamp).toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit'
        }),
        waveHeight: units === 'imperial' ? point.wvht_ft : point.wvht_m,
        period: point.dpd_sec,
        surfHeight: units === 'imperial' ? 
          (point.surf_height_m ? point.surf_height_m * 3.28084 : null) : 
          point.surf_height_m,
        energy: point.wave_energy
      }));
      
      setHistoricalData(chartData);
    } catch (err) {
      console.error('Error fetching historical data:', err);
      setChartError(err.message);
      setHistoricalData([]);
    } finally {
      setChartLoading(false);
    }
  };

  const fetchForecastData = async (stationId, hours = 120) => {
    try {
      setForecastLoading(true);
      const res = await fetch(`/api/buoy-forecast/${stationId}?hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      
      if (result.error) {
        console.warn('Forecast error:', result.error);
        setForecastData([]);
        return;
      }
      
      // Transform forecast data for Recharts
      const chartData = result.data.map(point => ({
        time: new Date(point.timestamp).toLocaleString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit'
        }),
        waveHeight: units === 'imperial' ? point.wvht_ft : point.wvht_m,
        period: point.dpd_sec,
        surfHeight: units === 'imperial' ? 
          (point.surf_height_m ? point.surf_height_m * 3.28084 : null) : 
          point.surf_height_m,
        energy: point.wave_energy,
        isForecast: true
      }));
      
      setForecastData(chartData);
    } catch (err) {
      console.error('Error fetching forecast data:', err);
      setForecastData([]);
    } finally {
      setForecastLoading(false);
    }
  };

  const fetchWindOverlay = async (model) => {
    try {
      console.log(`Fetching wind overlay for model: ${model}`);
      const res = await fetch(`/api/wind-overlay?model=${model}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(`Wind overlay data received for ${model}:`, data);
      setOverlayData(prev => {
        const newData = { ...prev, wind: { ...(prev.wind || {}), [model]: data } };
        console.log('Updated overlayData:', newData);
        return newData;
      });
    } catch (err) {
      console.error(`Error fetching ${model} wind overlay:`, err);
    }
  };

  const fetchSwellOverlay = async () => {
    try {
      console.log('Fetching swell overlay (WW3)');
      const res = await fetch('/api/swell-overlay?model=ww3');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log('Swell overlay data received:', data);
      setOverlayData(prev => {
        const newData = { ...prev, swell: data };
        console.log('Updated overlayData with swell:', newData);
        return newData;
      });
    } catch (err) {
      console.error('Error fetching swell overlay:', err);
    }
  };

  // Handle overlay type toggle (Wind or Swell)
  const handleOverlayTypeToggle = (type) => {
    const nextType = overlayType === type ? 'none' : type;
    setOverlayType(nextType);
    onOverlayChange?.(nextType);
    if (nextType === 'wind') {
      fetchWindOverlay(selectedWindModel);
    }
    // 'waves' data is fetched via useEffect when overlayType changes
  };

  // Handle wind model selection (only when wind overlay is active)
  const handleWindModelChange = (model) => {
    setSelectedWindModel(model);
    if (overlayType === 'wind') {
      fetchWindOverlay(model);
    }
  };

  // Time slider handlers
  const handlePrevFrame = () => {
    if (windFrames && windFrames.hours && selectedFrameIndex > 0) {
      setSelectedFrameIndex(prev => prev - 1);
      setIsPlaying(false); // Stop playing when manually stepping
    }
  };

  const handleNextFrame = () => {
    if (windFrames && windFrames.hours && selectedFrameIndex < windFrames.hours.length - 1) {
      setSelectedFrameIndex(prev => prev + 1);
      setIsPlaying(false); // Stop playing when manually stepping
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(prev => !prev);
  };

  const handleWavePlayPause = () => {
    setIsWavePlaying(prev => !prev);
  };

  const handleSliderChange = (e) => {
    const newIndex = parseInt(e.target.value, 10);
    setSelectedFrameIndex(newIndex);
    // Don't stop playing when scrubbing - allow user to scrub while playing
  };

  // Refresh wind frames (clears cache and fetches fresh data)
  const handleRefreshWindFrames = async () => {
    if (overlayType !== 'wind' || !selectedWindModel) return;
    
    console.log(`🔄 Refreshing wind frames for ${selectedWindModel}`);
    
    // Clear cache to force refresh
    setWindFramesCache(null);
    
    try {
      setWindFramesLoading(true);
      const res = await fetch(`/api/wind/frames?model=${selectedWindModel}`);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }
      const data = await res.json();
      
      if (data.error) {
        console.error(`❌ API returned error: ${data.error}`);
        setWindFrames(null);
        return;
      }
      
      if (!data.hours || !Array.isArray(data.hours) || data.hours.length === 0) {
        console.error(`❌ No forecast hours available`);
        setWindFrames(null);
        return;
      }
      
      console.log(`✅ Wind frames refreshed: ${data.hours.length} hours available`);
      
      // Update cache with fresh data (both state and ref)
      const cacheEntry = {
        data: data,
        cachedAt: Date.now(),
        model: selectedWindModel
      };
      setWindFramesCache(cacheEntry);
      windFramesCacheRef.current = cacheEntry;
      
      setWindFrames(data);
      setSelectedFrameIndex(0);
    } catch (err) {
      console.error(`❌ Error refreshing wind frames:`, err);
      setWindFrames(null);
    } finally {
      setWindFramesLoading(false);
    }
  };

  // Reset chart state when buoy changes
  useEffect(() => {
    setShowChart(false);
    setHistoricalData([]);
    setChartError(null);
    setShowForecast(false);
    setForecastData([]);
  }, [selectedBuoy?.station]);

  useEffect(() => {
    fetchBuoyData();

    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchBuoyData, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Fetch surf spots on mount
  useEffect(() => {
    fetchSurfSpots();

    // Auto-refresh every 10 minutes (same as buoys)
    const interval = setInterval(fetchSurfSpots, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Fetch wind data when overlay is enabled
  useEffect(() => {
    if (windOverlayEnabled) {
      fetchWindData();
      // Refresh wind data every 10 minutes
      const interval = setInterval(fetchWindData, 10 * 60 * 1000);
      return () => clearInterval(interval);
    } else {
      setWindData(null);
    }
  }, [windOverlayEnabled]);

  // Fetch wind frames when wind overlay is enabled (with client-side caching)
  useEffect(() => {
    if (overlayType !== 'wind') {
      // When wind mode is disabled, keep cache but clear current frames
      setWindFrames(null);
      setSelectedFrameIndex(0);
      setIsPlaying(false);
      return;
    }

    // Check if we have cached frames for this model that are still valid
    // Use ref to check cache without including it in dependencies
    const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    const cache = windFramesCacheRef.current || windFramesCache;
    
    if (cache && 
        cache.model === selectedWindModel &&
        cache.cachedAt &&
        (now - cache.cachedAt) < CACHE_DURATION_MS &&
        cache.data) {
      console.log(`📦 Using cached wind frames for ${selectedWindModel}`);
      setWindFrames(cache.data);
      return; // Use cached data, don't fetch
    }
    
    // Fetch frames if we don't have valid cached data
    let cancelled = false;
    const fetchFrames = async (model) => {
      try {
        setWindFramesLoading(true);
        console.log(`🕐 Fetching wind frames for model: ${model}`);
        const res = await fetch(`/api/wind/frames?model=${model}`);
        if (cancelled) return;
        
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        const data = await res.json();
        
        if (cancelled) return;
        
        // Check if response has an error field
        if (data.error) {
          console.error(`❌ API returned error: ${data.error}`);
          setWindFrames(null);
          return;
        }
        
        // Check if hours array exists and has data
        if (!data.hours || !Array.isArray(data.hours) || data.hours.length === 0) {
          console.error(`❌ No forecast hours available`);
          setWindFrames(null);
          return;
        }
        
        console.log(`✅ Wind frames received: ${data.hours.length} hours available`);
        
        // Update cache (both state and ref)
        const cacheEntry = {
          data: data,
          cachedAt: Date.now(),
          model: model
        };
        setWindFramesCache(cacheEntry);
        windFramesCacheRef.current = cacheEntry;
        
        setWindFrames(data);
        setSelectedFrameIndex(0);
      } catch (err) {
        if (!cancelled) {
          console.error(`❌ Error fetching wind frames:`, err);
          setWindFrames(null);
        }
      } finally {
        if (!cancelled) {
          setWindFramesLoading(false);
        }
      }
    };
    
    fetchFrames(selectedWindModel);
    
    return () => {
      cancelled = true;
    };
  }, [overlayType, selectedWindModel]);

  // Fetch wave frames (forecast hours) when wave overlay is active
  useEffect(() => {
    if (overlayType !== 'waves') return;

    // Check if we have cached frames that are still valid
    const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    const cache = waveFramesCacheRef.current || waveFramesCache;

    if (cache &&
        cache.cachedAt &&
        (now - cache.cachedAt) < CACHE_DURATION_MS &&
        cache.data) {
      console.log(`📦 Using cached wave frames`);
      setWaveFrames(cache.data);
      return; // Use cached data, don't fetch
    }

    // Fetch frames if we don't have valid cached data
    let cancelled = false;
    const fetchFrames = async () => {
      try {
        setWaveFramesLoading(true);
        console.log(`🌊 Fetching wave frames (forecast hours)...`);
        const res = await fetch(`/api/waves/run-availability`);
        if (cancelled) return;

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        const data = await res.json();

        if (cancelled) return;

        // Check if response has an error field
        if (data.error) {
          console.error(`❌ API returned error: ${data.error}`);
          setWaveFrames(null);
          return;
        }

        // Check if hours array exists and has data
        if (!data.hours || !Array.isArray(data.hours) || data.hours.length === 0) {
          console.error(`❌ No wave forecast hours available`);
          setWaveFrames(null);
          return;
        }

        console.log(`✅ Wave frames received: ${data.hours.length} hours available (0-${data.hours[data.hours.length - 1]}h)`);

        // Update cache (both state and ref)
        const cacheEntry = {
          data: data,
          cachedAt: Date.now()
        };
        setWaveFramesCache(cacheEntry);
        waveFramesCacheRef.current = cacheEntry;

        setWaveFrames(data);
        setSelectedWaveFrameIndex(0);
      } catch (err) {
        if (!cancelled) {
          console.error(`❌ Error fetching wave frames:`, err);
          setWaveFrames(null);
        }
      } finally {
        if (!cancelled) {
          setWaveFramesLoading(false);
        }
      }
    };

    fetchFrames();

    return () => {
      cancelled = true;
    };
  }, [overlayType]);

  // Handle wave play/pause animation
  useEffect(() => {
    if (!isWavePlaying) {
      // Clear timer if not playing
      if (wavePlayTimerRef.current) {
        clearInterval(wavePlayTimerRef.current);
        wavePlayTimerRef.current = null;
      }
      return;
    }

    if (overlayType !== 'waves') {
      return;
    }

    if (!waveFrames?.hours?.length) {
      return;
    }

    // Start animation loop
    wavePlayTimerRef.current = setInterval(() => {
      setSelectedWaveFrameIndex(prev => {
        const next = prev + 1;
        if (next >= waveFrames.hours.length) {
          setIsWavePlaying(false); // Stop at end
          return prev;
        }
        return next;
      });
    }, 500); // 500ms per frame (2 frames/sec, similar to wind)

    return () => {
      if (wavePlayTimerRef.current) {
        clearInterval(wavePlayTimerRef.current);
        wavePlayTimerRef.current = null;
      }
    };
  }, [isWavePlaying, overlayType, waveFrames]);

  // Wave frame handler: update state immediately (slider thumb moves), increment token to
  // cancel any in-progress canvas render. The fetch useEffect debounces the actual HTTP call.
  const handleWaveFrameChange = useCallback((newIndex) => {
    setSelectedWaveFrameIndex(newIndex);
    selectedWaveFrameIndexRef.current = newIndex;
    waveRenderTokenRef.current++;
  }, []);

  // Keep waveFramesRef in sync so the wave fetch effect can access it without adding waveFrames
  // to the dependency array (which would cause unnecessary re-fetches).
  useEffect(() => { waveFramesRef.current = waveFrames; }, [waveFrames]);

  // Handle wind play/pause animation
  useEffect(() => {
    if (!isPlaying) {
      // Clear timer if not playing
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }
    
    if (overlayType !== 'wind') {
      return;
    }
    
    if (!windFrames?.hours?.length) {
      return;
    }
    
    // Start animation loop
    playTimerRef.current = setInterval(() => {
      setSelectedFrameIndex(prev => {
        const last = windFrames.hours.length - 1;
        // Wrap to beginning when reaching the end
        return prev >= last ? 0 : prev + 1;
      });
    }, 700); // 700ms per frame (tunable)
    
    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, overlayType, windFrames]);

  // Fetch wind overlay data when forecast hour or map bounds change (with caching and prefetching)
  useEffect(() => {
    if (overlayType !== 'wind') {
      setWindData(null);
      return;
    }
    
    if (selectedForecastHour == null) {
      setWindData(null);
      return;
    }
    
    if (!mapRef.current) {
      return;
    }
    
    // Get map bounds
    const bounds = mapRef.current.getBounds();
    const bbox = [
      bounds.getSouth(),
      bounds.getWest(),
      bounds.getNorth(),
      bounds.getEast()
    ].join(',');
    
    // Abort any previous in-flight fetch and start a fresh controller
    if (windFetchAbortRef.current) windFetchAbortRef.current.abort();
    const controller = new AbortController();
    windFetchAbortRef.current = controller;

    // 120ms debounce: if the slider moves again before the timer fires, the cleanup
    // above will abort() before the fetch even starts.
    clearTimeout(windFetchDebounceRef.current);
    windFetchDebounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchWindFrame({
          model: selectedWindModel,
          bbox,
          hour: selectedForecastHour,
          signal: controller.signal,
        });

        if (!controller.signal.aborted) {
          setWindData(data);
        }

        if (controller.signal.aborted || !windFrames?.hours) return;
        const hours = windFrames.hours;

        // Immediate +1 warmup
        const nextIdx = Math.min(selectedFrameIndex + 1, hours.length - 1);
        const nextHour = hours[nextIdx];
        if (nextHour != null && nextHour !== selectedForecastHour) {
          fetchWindFrame({ model: selectedWindModel, bbox, hour: nextHour }).catch(() => {});
        }

        // Idle: after 400ms of no slider activity, warm ±3 and ±6 adjacent frames
        clearTimeout(windIdlePrefetchRef.current);
        windIdlePrefetchRef.current = setTimeout(() => {
          if (controller.signal.aborted) return;
          const warmed = new Set([selectedForecastHour, nextHour].filter(h => h != null));
          for (const offset of [-6, -3, 3, 6]) {
            const idx = Math.max(0, Math.min(hours.length - 1, selectedFrameIndex + offset));
            const h = hours[idx];
            if (h != null && !warmed.has(h)) {
              warmed.add(h);
              fetchWindFrame({ model: selectedWindModel, bbox, hour: h }).catch(() => {});
            }
          }
          console.log(`🌬️ Wind idle prefetch: warmed ±3/±6 adjacent frames`);
        }, 400);
      } catch (err) {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          console.error(`❌ Error fetching wind overlay:`, err);
          setWindData(null);
        }
      }
    }, 120);

    // Also listen for map move/zoom events to refetch with new bounds
    let mapChangeTimeout = null;
    const map = mapRef.current;
    const handleMapChange = () => {
      if (mapChangeTimeout) clearTimeout(mapChangeTimeout);

      mapChangeTimeout = setTimeout(() => {
        if (overlayType === 'wind' && selectedForecastHour != null && mapRef.current && !controller.signal.aborted) {
          const newBounds = mapRef.current.getBounds();
          const newBbox = [
            newBounds.getSouth(),
            newBounds.getWest(),
            newBounds.getNorth(),
            newBounds.getEast()
          ].join(',');

          fetchWindFrame({
            model: selectedWindModel,
            bbox: newBbox,
            hour: selectedForecastHour,
            signal: controller.signal,
          }).then(data => {
            if (!controller.signal.aborted) {
              console.log(`✅ Wind overlay updated (map moved): +${selectedForecastHour}h, vectors: ${data.vectors?.length ?? 0}`);
              setWindData(data);
            }
          }).catch(err => {
            if (err.name !== 'AbortError' && !controller.signal.aborted) {
              console.error(`❌ Error updating wind overlay:`, err);
            }
          });
        }
      }, 300);
    };

    map.on('moveend', handleMapChange);
    map.on('zoomend', handleMapChange);

    return () => {
      controller.abort();
      clearTimeout(windFetchDebounceRef.current);
      clearTimeout(windIdlePrefetchRef.current);
      if (mapChangeTimeout) clearTimeout(mapChangeTimeout);
      map.off('moveend', handleMapChange);
      map.off('zoomend', handleMapChange);
    };
  }, [overlayType, selectedForecastHour, selectedWindModel, selectedFrameIndex, windFrames, fetchWindFrame]);

  // Rebuild WindField when windData changes (for probe)
  useEffect(() => {
    if (overlayType === 'wind' && windData?.vectors?.length) {
      const wf = new WindField(windData.vectors);
      windFieldRef.current = wf?.valid ? wf : null;
    } else {
      windFieldRef.current = null;
    }
  }, [overlayType, windData]);
  
  // Rebuild WaveField when waveData changes (for probe)
  useEffect(() => {
    if (overlayType === 'waves' && waveData?.vectors?.length) {
      const wf = new WaveField(waveData.vectors);
      waveFieldRef.current = wf?.valid ? wf : null;
    } else {
      waveFieldRef.current = null;
    }
  }, [overlayType, waveData]);
  
  // Fetch wave data: handles initial load, slider scrub, and map pan/zoom in one effect.
  // AbortController cancels in-flight fetches when the hour changes or the effect re-runs.
  // 120ms debounce prevents rapid slider scrubs from firing multiple concurrent requests.
  useEffect(() => {
    if (overlayType !== 'waves') {
      setWaveData(null);
      return;
    }

    if (waveFetchAbortRef.current) waveFetchAbortRef.current.abort();
    const controller = new AbortController();
    waveFetchAbortRef.current = controller;

    let mapChangeTimeout = null;
    let retryTimeout = null;

    const fetchForBounds = async (retryCount = 0) => {
      if (controller.signal.aborted) return;
      if (retryCount > 50) {
        console.warn('🌊 Wave data fetch: Max retries reached, map may not be ready');
        return;
      }
      if (!mapRef.current) {
        retryTimeout = setTimeout(() => fetchForBounds(retryCount + 1), 100);
        return;
      }
      const map = mapRef.current;
      let bounds;
      try {
        bounds = map.getBounds();
      } catch (e) {
        retryTimeout = setTimeout(() => fetchForBounds(retryCount + 1), 100);
        return;
      }
      if (!bounds || !bounds.isValid()) {
        if (!map.loaded) {
          map.once('load', () => { if (!controller.signal.aborted) fetchForBounds(retryCount); });
        } else {
          retryTimeout = setTimeout(() => fetchForBounds(retryCount + 1), 100);
        }
        return;
      }
      try {
        const bbox = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].join(',');
        const zoom = map.getZoom();
        console.log('🌊 Wave data fetch: Map ready, fetching data...');
        const data = await fetchWaveData({ model: 'ww3', bbox, hour: selectedWaveForecastHour, zoom, signal: controller.signal });
        if (!controller.signal.aborted) {
          setWaveData(data);

          // Idle: after 400ms of no slider activity, warm ±3 and ±6 adjacent wave frames
          clearTimeout(waveIdlePrefetchRef.current);
          waveIdlePrefetchRef.current = setTimeout(() => {
            if (controller.signal.aborted || !waveFramesRef.current?.hours) return;
            const hours = waveFramesRef.current.hours;
            const currentIdx = selectedWaveFrameIndexRef.current;
            const warmed = new Set([selectedWaveForecastHour]);
            for (const offset of [-6, -3, 3, 6]) {
              const idx = Math.max(0, Math.min(hours.length - 1, currentIdx + offset));
              const h = hours[idx];
              if (h != null && !warmed.has(h)) {
                warmed.add(h);
                fetchWaveData({ model: 'ww3', bbox, hour: h, zoom }).catch(() => {});
              }
            }
            console.log(`🌊 Wave idle prefetch: warmed ±3/±6 adjacent frames`);
          }, 400);
        }
      } catch (err) {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          console.error('❌ Error fetching wave data:', err);
        }
      }
    };

    // Debounce the initial fetch so rapid slider scrubs don't stack requests
    clearTimeout(waveFetchDebounceRef.current);
    waveFetchDebounceRef.current = setTimeout(() => fetchForBounds(), 120);

    // Map pan handler (100ms debounce)
    const map = mapRef.current;
    const handleMapChange = () => {
      if (mapChangeTimeout) clearTimeout(mapChangeTimeout);
      mapChangeTimeout = setTimeout(() => {
        if (!mapRef.current || controller.signal.aborted) return;
        requestAnimationFrame(() => {
          const newBounds = mapRef.current.getBounds();
          if (!newBounds || !newBounds.isValid()) return;
          const newBbox = [newBounds.getSouth(), newBounds.getWest(), newBounds.getNorth(), newBounds.getEast()].join(',');
          const currentZoom = mapRef.current.getZoom();
          console.log(`🌊 Map moved, fetching wave data (zoom=${currentZoom})...`);
          fetchWaveData({ model: 'ww3', bbox: newBbox, hour: selectedWaveForecastHour, zoom: currentZoom, signal: controller.signal })
            .then(data => { if (!controller.signal.aborted) { console.log(`✅ Wave overlay updated (map moved): vectors: ${data.vectors?.length ?? 0}`); setWaveData(data); } })
            .catch(err => { if (err.name !== 'AbortError' && !controller.signal.aborted) console.error(`❌ Error updating wave overlay:`, err); });
        });
      }, 100);
    };

    // Zoom-end handler: bounds fully updated by now, fetch immediately
    const handleZoomEnd = () => {
      if (mapChangeTimeout) { clearTimeout(mapChangeTimeout); mapChangeTimeout = null; }
      if (!mapRef.current || controller.signal.aborted) return;
      const newBounds = mapRef.current.getBounds();
      if (!newBounds || !newBounds.isValid()) return;
      const newBbox = [newBounds.getSouth(), newBounds.getWest(), newBounds.getNorth(), newBounds.getEast()].join(',');
      const currentZoom = mapRef.current.getZoom();
      console.log(`🌊 Zoom ended, fetching wave data for expanded bounds (zoom=${currentZoom})...`);
      fetchWaveData({ model: 'ww3', bbox: newBbox, hour: selectedWaveForecastHour, zoom: currentZoom, signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) { console.log(`✅ Wave overlay updated (zoom ended): vectors: ${data.vectors?.length ?? 0}`); setWaveData(data); } })
        .catch(err => { if (err.name !== 'AbortError' && !controller.signal.aborted) console.error(`❌ Error updating wave overlay:`, err); });
    };

    if (map) {
      map.on('moveend', handleMapChange);
      map.on('zoomend', handleZoomEnd);
    }

    return () => {
      controller.abort();
      clearTimeout(waveFetchDebounceRef.current);
      clearTimeout(waveIdlePrefetchRef.current);
      if (mapChangeTimeout) clearTimeout(mapChangeTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
      if (map) {
        map.off('moveend', handleMapChange);
        map.off('zoomend', handleZoomEnd);
      }
    };
  }, [overlayType, fetchWaveData, selectedWaveForecastHour]);

  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      // If switching to desktop, ensure detail view is hidden
      if (!mobile) {
        setShowMobileDetail(false);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle buoy selection on mobile
  const handleBuoyClick = (buoy) => {
    setSelectedBuoy(buoy);
    if (isMobile) {
      setShowMobileDetail(true);
    }
  };

  // Handle surf spot selection
  const handleSpotClick = (spot) => {
    setSelectedSpot(spot);
    setSelectedBuoy(null); // Clear buoy selection
    setShowChart(false);
    setShowForecast(false);
    if (isMobile) {
      setShowMobileDetail(true);
    }
  };

  // Handle closing mobile detail view
  const handleCloseMobileDetail = () => {
    setShowMobileDetail(false);
    // Don't clear selectedBuoy/selectedSpot, just hide the detail view
  };

  const mapCenter = [33.0, -118.0];

  // Format functions
  const formatWaveHeight = (waveM) => {
    if (!waveM) return 'N/A';
    if (units === 'imperial') {
      return `${metersToFeet(waveM).toFixed(1)} ft`;
    }
    return `${waveM.toFixed(2)} m`;
  };

  const formatSurfSize = (surfM) => {
    if (!surfM) return 'N/A';
    if (units === 'imperial') {
      return `${metersToFeet(surfM).toFixed(1)} ft`;
    }
    return `${surfM.toFixed(2)} m`;
  };

  const getEnergyLevel = (energy) => {
    if (!energy) return { label: 'N/A', color: '#999', width: 0 };
    
    if (energy < 50) {
      return { label: 'Small', color: '#94a3b8', width: (energy / 500) * 100 };
    } else if (energy < 150) {
      return { label: 'Moderate', color: '#fbbf24', width: (energy / 500) * 100 };
    } else if (energy < 300) {
      return { label: 'Powerful', color: '#fb923c', width: (energy / 500) * 100 };
    } else if (energy < 500) {
      return { label: 'Very Powerful', color: '#f87171', width: (energy / 500) * 100 };
    } else {
      return { label: 'Extreme', color: '#dc2626', width: Math.min((energy / 500) * 100, 100) };
    }
  };

  const formatTemp = (tempC) => {
    if (!tempC) return 'N/A';
    if (units === 'imperial') {
      return `${celsiusToFahrenheit(tempC).toFixed(1)}°F`;
    }
    return `${tempC.toFixed(1)}°C`;
  };

  const formatTime = (timestampUtc) => {
    if (!timestampUtc) return 'N/A';
    const date = new Date(timestampUtc);
    if (timezone === 'utc') {
      return date.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    }
    return date.toLocaleString();
  };

  const formatWindSpeed = (windMs) => {
    if (!windMs) return 'N/A';
    if (units === 'imperial') {
      return `${msToMph(windMs).toFixed(1)} mph`;
    }
    return `${msToKph(windMs).toFixed(1)} km/h`;
  };

  const getWindDirection = (degrees) => {
    if (!degrees) return 'N/A';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(degrees / 22.5) % 16;
    return `${directions[index]} (${Math.round(degrees)}°)`;
  };

  // Helper for compass direction (16-point)
  const degToCompass16 = (deg) => {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  };

  // Wind Probe Click Handler Component
  function WindProbeClickHandler({ enabled, onPick }) {
    useMapEvents({
      click(e) {
        if (!enabled) return;
        
        const target = e.originalEvent?.target;
        if (!target) {
          onPick(e.latlng);
          return;
        }
        
        // Check if clicking on interactive UI elements (buttons, controls, etc.)
        if (target.closest('button') || 
            target.closest('.leaflet-control') ||
            target.closest('.leaflet-popup') ||
            target.closest('[role="button"]') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('textarea')) {
          return;
        }
        
        // Check if clicking on the probe popup itself (more specific - check for our popup structure)
        const popupContainer = target.closest('div[style*="z-index: 1200"]');
        if (popupContainer) {
          // Only prevent if it's actually our wind probe popup (has the wind data structure)
          const hasWindContent = popupContainer.querySelector('[style*="font-weight: bold"]');
          if (hasWindContent) {
            return; // Don't create new probe when clicking on existing popup
          }
        }
        
        // Allow the click to create a new probe
        onPick(e.latlng);
      }
    });
    return null;
  }

  // Wind Probe Overlay Component
  function WindProbeOverlay({ probe, setProbe, windField, units }) {
    const map = useMap();
    const elRef = useRef(null);
    const draggingRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const [screenPos, setScreenPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const dragHandlersRef = useRef({ move: null, up: null, leave: null });
    const animationFrameRef = useRef(null);
    const pendingUpdateRef = useRef(null);

    // Update screen position on map move/zoom (but not during drag)
    useEffect(() => {
      if (!probe) return;
      // Don't update screen position if we're currently dragging (we're updating DOM directly)
      if (draggingRef.current) return;
      
      const update = () => {
        // Don't update if dragging
        if (draggingRef.current) return;
        const pt = map.latLngToContainerPoint([probe.lat, probe.lng]);
        setScreenPos({ x: pt.x, y: pt.y });
      };
      update();
      map.on('move zoom resize', update);
      return () => {
        map.off('move zoom resize', update);
      };
    }, [map, probe]);


    if (!probe || !windField) return null;

    // Compute wind at probe
    const vec = windField.getVector(probe.lat, probe.lng);
    const speedMs = vec ? Math.sqrt(vec.u * vec.u + vec.v * vec.v) : null;

    // Convert to display units
    const speed = speedMs == null ? null : (units === 'imperial' ? msToMph(speedMs) : msToKph(speedMs));
    const speedLabel = speed == null ? '—' : `${Math.round(speed)} ${units === 'imperial' ? 'mph' : 'km/h'}`;

    // Compute meteorological "from" direction and "to" direction (for arrow)
    let dirDeg = null; // "from" direction for display
    let arrowDeg = null; // "to" direction for arrow (where wind is going)
    if (vec) {
      const degTo = (Math.atan2(vec.u, vec.v) * 180 / Math.PI + 360) % 360;
      dirDeg = (degTo + 180) % 360; // "from" direction
      arrowDeg = degTo; // "to" direction (where wind is going)
    }

    const compass = dirDeg == null ? '—' : degToCompass16(dirDeg);

    // Cleanup effect to ensure drag state is reset and listeners are removed
    useEffect(() => {
      return () => {
        // Reset drag state on unmount or probe change
        if (draggingRef.current) {
          draggingRef.current = false;
          setIsDragging(false);
        }
        // Clean up any lingering event listeners
        const handlers = dragHandlersRef.current;
        if (handlers.move) {
          window.removeEventListener('mousemove', handlers.move, { capture: true });
          document.removeEventListener('mousemove', handlers.move, { capture: true });
        }
        if (handlers.up) {
          window.removeEventListener('mouseup', handlers.up, { capture: true });
          document.removeEventListener('mouseup', handlers.up, { capture: true });
        }
        if (handlers.leave) {
          window.removeEventListener('mouseleave', handlers.leave, { capture: true });
        }
        dragHandlersRef.current = { move: null, up: null, leave: null };
        // Cancel any pending animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        pendingUpdateRef.current = null;
        setDragOffset({ x: 0, y: 0 });
        // Ensure map dragging is re-enabled
        if (map && map.dragging) {
          map.dragging.enable();
        }
      };
    }, [probe, map]);

    const onMouseDown = useCallback((e) => {
      // Don't start drag if clicking the close button
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }
      
      // Use Leaflet's event handling to stop propagation
      L.DomEvent.stop(e);
      L.DomEvent.disableClickPropagation(elRef.current);
      
      // Disable map dragging while we drag the popup
      map.dragging.disable();
      
      // Clean up any existing listeners first
      const oldHandlers = dragHandlersRef.current;
      if (oldHandlers.move) {
        window.removeEventListener('mousemove', oldHandlers.move, { capture: true });
        document.removeEventListener('mousemove', oldHandlers.move, { capture: true });
      }
      if (oldHandlers.up) {
        window.removeEventListener('mouseup', oldHandlers.up, { capture: true });
        document.removeEventListener('mouseup', oldHandlers.up, { capture: true });
      }
      if (oldHandlers.leave) {
        window.removeEventListener('mouseleave', oldHandlers.leave, { capture: true });
      }
      
      draggingRef.current = true;
      setIsDragging(true);
      const rect = elRef.current.getBoundingClientRect();
      const mapRect = map.getContainer().getBoundingClientRect();
      // Store initial screen position at drag start
      const initialScreenX = screenPos.x;
      const initialScreenY = screenPos.y;
      // Calculate offset from mouse to popup top-left corner
      dragOffsetRef.current = { 
        x: e.clientX - rect.left, 
        y: e.clientY - rect.top,
        initialScreenX,
        initialScreenY
      };

      const handleMouseMove = (moveEvent) => {
        if (!draggingRef.current) return;
        // Stop propagation to prevent map from moving
        L.DomEvent.stop(moveEvent);
        
        // Store the pending update
        const mapRect = map.getContainer().getBoundingClientRect();
        const x = moveEvent.clientX - mapRect.left - dragOffsetRef.current.x;
        const y = moveEvent.clientY - mapRect.top - dragOffsetRef.current.y;
        pendingUpdateRef.current = { x, y };
        
        // Use requestAnimationFrame for smooth updates
        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(() => {
            if (!draggingRef.current || !pendingUpdateRef.current || !elRef.current) {
              animationFrameRef.current = null;
              return;
            }
            
            const { x, y } = pendingUpdateRef.current;
            const { initialScreenX, initialScreenY } = dragOffsetRef.current;
            
            // Calculate drag offset from the initial drag position
            const offsetX = x - initialScreenX;
            const offsetY = y - initialScreenY;
            setDragOffset({ x: offsetX, y: offsetY });
            
            // Convert to lat/lng and update probe state (throttled)
            const ll = map.containerPointToLatLng([x, y]);
            setProbe({ lat: ll.lat, lng: ll.lng });
            
            animationFrameRef.current = null;
            pendingUpdateRef.current = null;
          });
        }
      };

      const handleMouseUp = (upEvent) => {
        L.DomEvent.stop(upEvent);
        draggingRef.current = false;
        setIsDragging(false);
        
        // Cancel any pending animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        // Reset drag offset
        setDragOffset({ x: 0, y: 0 });
        
        // Final position update if there's a pending update
        if (pendingUpdateRef.current) {
          const { x, y } = pendingUpdateRef.current;
          const ll = map.containerPointToLatLng([x, y]);
          setProbe({ lat: ll.lat, lng: ll.lng });
          pendingUpdateRef.current = null;
        }
        
        // Re-enable map dragging
        map.dragging.enable();
        // Remove listeners
        window.removeEventListener('mousemove', handleMouseMove, { capture: true });
        document.removeEventListener('mousemove', handleMouseMove, { capture: true });
        window.removeEventListener('mouseup', handleMouseUp, { capture: true });
        document.removeEventListener('mouseup', handleMouseUp, { capture: true });
        window.removeEventListener('mouseleave', handleMouseLeave, { capture: true });
        dragHandlersRef.current = { move: null, up: null, leave: null };
      };

      const handleMouseLeave = (leaveEvent) => {
        // Reset drag if mouse leaves window
        if (draggingRef.current) {
          draggingRef.current = false;
          setIsDragging(false);
          
          // Cancel any pending animation frame
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          pendingUpdateRef.current = null;
          setDragOffset({ x: 0, y: 0 });
          
          // Re-enable map dragging
          map.dragging.enable();
          window.removeEventListener('mousemove', handleMouseMove, { capture: true });
          document.removeEventListener('mousemove', handleMouseMove, { capture: true });
          window.removeEventListener('mouseup', handleMouseUp, { capture: true });
          document.removeEventListener('mouseup', handleMouseUp, { capture: true });
          window.removeEventListener('mouseleave', handleMouseLeave, { capture: true });
          dragHandlersRef.current = { move: null, up: null, leave: null };
        }
      };

      // Store handlers for cleanup
      dragHandlersRef.current = { move: handleMouseMove, up: handleMouseUp, leave: handleMouseLeave };

      window.addEventListener('mousemove', handleMouseMove, { passive: false, capture: true });
      document.addEventListener('mousemove', handleMouseMove, { passive: false, capture: true });
      window.addEventListener('mouseup', handleMouseUp, { passive: false, capture: true });
      document.addEventListener('mouseup', handleMouseUp, { passive: false, capture: true });
      window.addEventListener('mouseleave', handleMouseLeave, { passive: false, capture: true });
    }, [map, setProbe]);

    // Use Leaflet's event handling on the popup container
    useEffect(() => {
      if (!elRef.current) return;
      // Disable click propagation to map (prevents map click handler from firing)
      L.DomEvent.disableClickPropagation(elRef.current);
      // Stop drag propagation but allow clicks within the popup
      L.DomEvent.on(elRef.current, 'mousedown', (e) => {
        // Only stop if not clicking a button (buttons need to work)
        if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
          L.DomEvent.stop(e);
        }
      });
      
      return () => {
        if (elRef.current) {
          L.DomEvent.off(elRef.current);
        }
      };
    }, []);

  return (
      <div
        ref={elRef}
        style={{
          position: 'absolute',
          left: screenPos.x,
          top: screenPos.y,
          transform: `translate(calc(-10px + ${dragOffset.x}px), calc(-60px + ${dragOffset.y}px))`,
          zIndex: 1200,
          pointerEvents: 'auto',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        onClick={(e) => {
          // Stop map click handler from firing
          L.DomEvent.stop(e);
        }}
      >
        <div
          onMouseDown={onMouseDown}
          style={{
            background: 'rgba(60,60,60,0.9)',
            color: '#fff',
            borderRadius: '6px',
            padding: '8px 10px',
            minWidth: '140px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>Wind</div>
            <button
              onClick={(e) => { 
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent?.stopImmediatePropagation?.();
                setProbe(null); 
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent?.stopImmediatePropagation?.();
                draggingRef.current = false; // Prevent drag
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#fff',
                fontSize: '18px',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '0 4px',
                pointerEvents: 'auto',
                zIndex: 1201,
                position: 'relative'
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div style={{ marginTop: '6px', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {speedLabel}
            {dirDeg != null && arrowDeg != null && (
              <>
                <span style={{ 
                  display: 'inline-block',
                  transform: `rotate(${arrowDeg}deg)`,
                  fontSize: '14px'
                }}>↑</span>
                <span style={{ fontSize: '12px', opacity: 0.9 }}>
                  {compass} ({Math.round(dirDeg)}°)
                </span>
              </>
            )}
          </div>

          {vec === null && (
            <div style={{ marginTop: '4px', fontSize: '10px', opacity: 0.7, fontStyle: 'italic' }}>
              No data here
            </div>
          )}

          <div style={{ marginTop: '6px', fontSize: '10px', opacity: 0.8 }}>
            Click map to move • Drag to reposition
          </div>
        </div>

        {/* Anchor dot */}
        <div style={{
          width: '8px',
          height: '8px',
          background: '#fff',
          borderRadius: '50%',
          marginLeft: '10px',
          marginTop: '6px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)'
        }} />
      </div>
    );
  }

  // Wave Probe Click Handler Component
  function WaveProbeClickHandler({ enabled, onPick }) {
    useMapEvents({
      click(e) {
        if (!enabled) return;
        
        const target = e.originalEvent?.target;
        if (!target) {
          onPick(e.latlng);
          return;
        }
        
        // Check if clicking on interactive UI elements
        if (target.closest('button') || 
            target.closest('.leaflet-control') ||
            target.closest('.leaflet-popup') ||
            target.closest('[role="button"]') ||
            target.closest('input') ||
            target.closest('select') ||
            target.closest('textarea')) {
          return;
        }
        
        // Check if clicking on the probe popup itself
        const popupContainer = target.closest('div[style*="z-index: 1200"]');
        if (popupContainer) {
          const hasWaveContent = popupContainer.querySelector('[style*="font-weight: bold"]');
          if (hasWaveContent) {
            return;
          }
        }
        
        onPick(e.latlng);
      }
    });
    return null;
  }

  // Wave Probe Overlay Component (similar to WindProbeOverlay but for waves)
  function WaveProbeOverlay({ probe, setProbe, waveField, units }) {
    const map = useMap();
    const elRef = useRef(null);
    const draggingRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const [screenPos, setScreenPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const dragHandlersRef = useRef({ move: null, up: null, leave: null });
    const animationFrameRef = useRef(null);
    const pendingUpdateRef = useRef(null);

    // Update screen position on map move/zoom (but not during drag)
    useEffect(() => {
      if (!probe) return;
      if (draggingRef.current) return;
      
      const update = () => {
        if (draggingRef.current) return;
        const pt = map.latLngToContainerPoint([probe.lat, probe.lng]);
        setScreenPos({ x: pt.x, y: pt.y });
      };
      update();
      map.on('move zoom resize', update);
      return () => {
        map.off('move zoom resize', update);
      };
    }, [map, probe]);

    if (!probe || !waveField) return null;

    // Compute wave at probe
    const vec = waveField.getVector(probe.lat, probe.lng);
    const hsMeters = vec ? vec.hs : null;
    
    // Convert to display units
    const hsFeet = hsMeters == null ? null : hsMeters * 3.28084;
    const hsLabel = hsMeters == null ? '—' : `${units === 'imperial' ? Math.round(hsFeet) : hsMeters.toFixed(1)} ${units === 'imperial' ? 'ft' : 'm'}`;

    // Wave direction (meteorological - where waves are coming FROM)
    const dirDeg = vec ? vec.dir_deg : null;
    const arrowDeg = dirDeg != null ? (dirDeg + 180) % 360 : null; // Show where waves are going TO
    const compass = dirDeg == null ? '—' : degToCompass16(dirDeg);

    // Cleanup effect (same as WindProbeOverlay)
    useEffect(() => {
      return () => {
        if (draggingRef.current) {
          draggingRef.current = false;
          setIsDragging(false);
        }
        const handlers = dragHandlersRef.current;
        if (handlers.move) {
          window.removeEventListener('mousemove', handlers.move, { capture: true });
          document.removeEventListener('mousemove', handlers.move, { capture: true });
        }
        if (handlers.up) {
          window.removeEventListener('mouseup', handlers.up, { capture: true });
          document.removeEventListener('mouseup', handlers.up, { capture: true });
        }
        if (handlers.leave) {
          window.removeEventListener('mouseleave', handlers.leave, { capture: true });
        }
        dragHandlersRef.current = { move: null, up: null, leave: null };
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        pendingUpdateRef.current = null;
        setDragOffset({ x: 0, y: 0 });
        if (map && map.dragging) {
          map.dragging.enable();
        }
      };
    }, [probe, map]);

    const onMouseDown = useCallback((e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        return;
      }
      
      L.DomEvent.stop(e);
      L.DomEvent.disableClickPropagation(elRef.current);
      map.dragging.disable();
      
      const oldHandlers = dragHandlersRef.current;
      if (oldHandlers.move) {
        window.removeEventListener('mousemove', oldHandlers.move, { capture: true });
        document.removeEventListener('mousemove', oldHandlers.move, { capture: true });
      }
      if (oldHandlers.up) {
        window.removeEventListener('mouseup', oldHandlers.up, { capture: true });
        document.removeEventListener('mouseup', oldHandlers.up, { capture: true });
      }
      if (oldHandlers.leave) {
        window.removeEventListener('mouseleave', oldHandlers.leave, { capture: true });
      }
      
      draggingRef.current = true;
      setIsDragging(true);
      const rect = elRef.current.getBoundingClientRect();
      const initialScreenX = screenPos.x;
      const initialScreenY = screenPos.y;
      dragOffsetRef.current = { 
        x: e.clientX - rect.left, 
        y: e.clientY - rect.top,
        initialScreenX,
        initialScreenY
      };

      const handleMouseMove = (moveEvent) => {
        if (!draggingRef.current) return;
        L.DomEvent.stop(moveEvent);
        
        const mapRect = map.getContainer().getBoundingClientRect();
        const x = moveEvent.clientX - mapRect.left - dragOffsetRef.current.x;
        const y = moveEvent.clientY - mapRect.top - dragOffsetRef.current.y;
        pendingUpdateRef.current = { x, y };
        
        if (!animationFrameRef.current) {
          animationFrameRef.current = requestAnimationFrame(() => {
            if (!draggingRef.current || !pendingUpdateRef.current || !elRef.current) {
              animationFrameRef.current = null;
              return;
            }
            
            const { x, y } = pendingUpdateRef.current;
            const { initialScreenX, initialScreenY } = dragOffsetRef.current;
            
            const offsetX = x - initialScreenX;
            const offsetY = y - initialScreenY;
            setDragOffset({ x: offsetX, y: offsetY });
            
            const ll = map.containerPointToLatLng([x, y]);
            setProbe({ lat: ll.lat, lng: ll.lng });
            
            animationFrameRef.current = null;
            pendingUpdateRef.current = null;
          });
        }
      };

      const handleMouseUp = (upEvent) => {
        L.DomEvent.stop(upEvent);
        draggingRef.current = false;
        setIsDragging(false);
        
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        setDragOffset({ x: 0, y: 0 });
        
        if (pendingUpdateRef.current) {
          const { x, y } = pendingUpdateRef.current;
          const ll = map.containerPointToLatLng([x, y]);
          setProbe({ lat: ll.lat, lng: ll.lng });
          pendingUpdateRef.current = null;
        }
        
        map.dragging.enable();
        window.removeEventListener('mousemove', handleMouseMove, { capture: true });
        document.removeEventListener('mousemove', handleMouseMove, { capture: true });
        window.removeEventListener('mouseup', handleMouseUp, { capture: true });
        document.removeEventListener('mouseup', handleMouseUp, { capture: true });
        window.removeEventListener('mouseleave', handleMouseLeave, { capture: true });
        dragHandlersRef.current = { move: null, up: null, leave: null };
      };

      const handleMouseLeave = (leaveEvent) => {
        if (draggingRef.current) {
          draggingRef.current = false;
          setIsDragging(false);
          
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          pendingUpdateRef.current = null;
          setDragOffset({ x: 0, y: 0 });
          
          map.dragging.enable();
          window.removeEventListener('mousemove', handleMouseMove, { capture: true });
          document.removeEventListener('mousemove', handleMouseMove, { capture: true });
          window.removeEventListener('mouseup', handleMouseUp, { capture: true });
          document.removeEventListener('mouseup', handleMouseUp, { capture: true });
          window.removeEventListener('mouseleave', handleMouseLeave, { capture: true });
          dragHandlersRef.current = { move: null, up: null, leave: null };
        }
      };

      dragHandlersRef.current = { move: handleMouseMove, up: handleMouseUp, leave: handleMouseLeave };

      window.addEventListener('mousemove', handleMouseMove, { passive: false, capture: true });
      document.addEventListener('mousemove', handleMouseMove, { passive: false, capture: true });
      window.addEventListener('mouseup', handleMouseUp, { passive: false, capture: true });
      document.addEventListener('mouseup', handleMouseUp, { passive: false, capture: true });
      window.addEventListener('mouseleave', handleMouseLeave, { passive: false, capture: true });
    }, [map, setProbe, screenPos]);

    // Use Leaflet's event handling on the popup container
    useEffect(() => {
      if (!elRef.current) return;
      L.DomEvent.disableClickPropagation(elRef.current);
      L.DomEvent.on(elRef.current, 'mousedown', (e) => {
        if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
          L.DomEvent.stop(e);
        }
      });
      
      return () => {
        if (elRef.current) {
          L.DomEvent.off(elRef.current);
        }
      };
    }, []);

    return (
      <div
        ref={elRef}
        style={{
          position: 'absolute',
          left: screenPos.x,
          top: screenPos.y,
          transform: `translate(calc(-10px + ${dragOffset.x}px), calc(-60px + ${dragOffset.y}px))`,
          zIndex: 1200,
          pointerEvents: 'auto',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        onClick={(e) => {
          L.DomEvent.stop(e);
        }}
      >
        <div
          onMouseDown={onMouseDown}
          style={{
            background: 'rgba(60,60,60,0.9)',
            color: '#fff',
            borderRadius: '6px',
            padding: '8px 10px',
            minWidth: '140px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>Waves</div>
            <button
              onClick={(e) => { 
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent?.stopImmediatePropagation?.();
                setProbe(null); 
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent?.stopImmediatePropagation?.();
                draggingRef.current = false;
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#fff',
                fontSize: '18px',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '0 4px',
                pointerEvents: 'auto',
                zIndex: 1201,
                position: 'relative'
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div style={{ marginTop: '6px', fontSize: '16px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {hsLabel}
            {dirDeg != null && arrowDeg != null && (
              <>
                <span style={{ 
                  display: 'inline-block',
                  transform: `rotate(${arrowDeg}deg)`,
                  fontSize: '14px'
                }}>↑</span>
                <span style={{ fontSize: '12px', opacity: 0.9 }}>
                  {compass} ({Math.round(dirDeg)}°)
                </span>
              </>
            )}
          </div>

          {vec === null && (
            <div style={{ marginTop: '4px', fontSize: '10px', opacity: 0.7, fontStyle: 'italic' }}>
              No data here
            </div>
          )}

          <div style={{ marginTop: '6px', fontSize: '10px', opacity: 0.8 }}>
            Click map to move • Drag to reposition
          </div>
        </div>

        <div style={{
          width: '8px',
          height: '8px',
          background: '#fff',
          borderRadius: '50%',
          marginLeft: '10px',
          marginTop: '6px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)'
        }} />
      </div>
    );
  }

  return (
      <div style={{ position: 'relative', height: '100%', width: '100%', paddingBottom: overlayType === 'waves' ? '70px' : overlayType === 'wind' ? '92px' : '0px' }}>
        {/* Control Panel - Hide on mobile when detail view is shown */}
        {!(isMobile && showMobileDetail) && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
          position: 'absolute',
          top: '80px',
          right: '16px',
          zIndex: 50,
          background: 'var(--panel)',
          backdropFilter: 'var(--panel-blur)',
          WebkitBackdropFilter: 'var(--panel-blur)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-l)',
          padding: '12px',
          minWidth: '192px',
          maxWidth: '210px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        }}>

          {/* Refresh + status row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '10px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live'}
            </span>
            <button
              onClick={fetchBuoyData}
              disabled={loading}
              title="Refresh buoy data"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px',
                background: loading ? 'var(--bg-3)' : 'var(--accent-2)',
                color: loading ? 'var(--muted)' : 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 5A4 4 0 1 1 5 1M9 1v4H5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {loading ? 'Loading' : 'Refresh'}
            </button>
          </div>

          {/* Units + Timezone */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                Units
              </label>
              <select
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                style={{
                  width: '100%', padding: '4px 6px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-3)',
                  color: 'var(--fg)',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                <option value="imperial">ft / °F</option>
                <option value="metric">m / °C</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>
                Time
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                style={{
                  width: '100%', padding: '4px 6px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-3)',
                  color: 'var(--fg)',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                <option value="local">Local</option>
                <option value="utc">UTC</option>
              </select>
            </div>
          </div>

          {/* Layers section */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>
              Layers
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '12px', color: 'var(--fg)', marginBottom: '6px' }}>
              <input type="checkbox" checked={showBuoys} onChange={(e) => setShowBuoys(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
              Buoys
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '12px', color: 'var(--fg)' }}>
              <input type="checkbox" checked={showSurfSpots} onChange={(e) => setShowSurfSpots(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
              Surf Spots
            </label>
          </div>

          {/* Overlay mode toggles */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', marginBottom: '10px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '8px' }}>
              Overlay
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => handleOverlayTypeToggle('waves')}
                style={{
                  flex: 1, padding: '5px 0',
                  background: overlayType === 'waves' ? 'var(--accent-2)' : 'var(--bg-3)',
                  color: overlayType === 'waves' ? 'var(--bg)' : 'var(--fg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                }}
              >
                Waves
              </button>
              <button
                onClick={() => handleOverlayTypeToggle('wind')}
                style={{
                  flex: 1, padding: '5px 0',
                  background: overlayType === 'wind' ? 'var(--accent-2)' : 'var(--bg-3)',
                  color: overlayType === 'wind' ? 'var(--bg)' : 'var(--fg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                }}
              >
                Wind
              </button>
            </div>

            {/* Particles toggle — shown when an overlay is active */}
            {overlayType === 'waves' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
                <input type="checkbox" checked={showWaveParticles} onChange={(e) => setShowWaveParticles(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                Show particles
              </label>
            )}
            {overlayType === 'wind' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
                <input type="checkbox" checked={showWindParticles} onChange={(e) => setShowWindParticles(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                Show particles
              </label>
            )}

            {/* Zoom warning */}
            {(overlayType === 'waves' || overlayType === 'wind') && currentZoom < 4 && (
              <div style={{
                marginTop: '8px', padding: '6px 8px',
                background: 'oklch(0.75 0.15 75 / 0.12)',
                border: '1px solid oklch(0.75 0.15 75 / 0.4)',
                borderRadius: 'var(--radius)',
                fontSize: '10px', color: 'var(--fg)', lineHeight: 1.4,
              }}>
                Zoom to level 4+ to load overlay data (current: {currentZoom})
              </div>
            )}
          </div>

          {/* Wind forecast info */}
          {overlayType === 'wind' && windFramesLoading && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', padding: '4px 0' }}>
              Loading forecast…
            </div>
          )}
          {overlayType === 'wind' && windFrames?.hours?.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  Forecast
                </span>
                <button
                  onClick={handleRefreshWindFrames}
                  disabled={windFramesLoading}
                  title="Refresh forecast frames"
                  style={{
                    padding: '3px 6px',
                    background: 'var(--bg-3)',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    cursor: windFramesLoading ? 'not-allowed' : 'pointer',
                    fontSize: '10px',
                  }}
                >
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M9 5A4 4 0 1 1 5 1M9 1v4H5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', lineHeight: 1.6 }}>
                <div>Run: {windFrames.run}</div>
                <div>+{windFrames.hours[selectedFrameIndex]}h — {forecastLocalLabel}</div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: '11px', color: 'var(--fire)', marginTop: '8px', lineHeight: 1.4 }}>
              {error}
            </div>
          )}
        </div>
        )}

        {/* Map Container - Hide on mobile when detail view is shown */}
        {!(isMobile && showMobileDetail) && (
        <MapContainer center={mapCenter} zoom={6.5} style={{ height: '100%', width: '100%' }}>
          <MapRefExposer onMapReady={(map) => { mapRef.current = map; }} />
          
          {/* Wind Probe Click Handler */}
          <WindProbeClickHandler
            enabled={overlayType === 'wind'}
            onPick={(latlng) => setWindProbe({ lat: latlng.lat, lng: latlng.lng })}
          />
          
          {/* Wind Probe Overlay */}
          {overlayType === 'wind' && windProbe && (
            <WindProbeOverlay
              probe={windProbe}
              setProbe={setWindProbe}
              windField={windFieldRef.current}
              units={units}
            />
          )}
          
          {/* Wave Probe Click Handler */}
          <WaveProbeClickHandler
            enabled={overlayType === 'waves'}
            onPick={(latlng) => setWaveProbe({ lat: latlng.lat, lng: latlng.lng })}
          />
          
          {/* Wave Probe Overlay */}
          {overlayType === 'waves' && waveProbe && (
            <WaveProbeOverlay
              probe={waveProbe}
              setProbe={setWaveProbe}
              waveField={waveFieldRef.current}
              units={units}
            />
          )}
          
          <LayersControl position="bottomleft">
            <BaseLayer checked={overlayType === 'none'} name="OpenStreetMap">
        <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
            </BaseLayer>
            
            <BaseLayer checked={overlayType === 'wind' || overlayType === 'waves'} name="Windy Dark">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution="© OpenStreetMap © CARTO"
              />
            </BaseLayer>
            
            <BaseLayer name="Carto Voyager">
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                attribution="&copy; OpenStreetMap &copy; CARTO"
              />
            </BaseLayer>
            
            <BaseLayer name="Satellite">
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
              />
            </BaseLayer>
            
            <BaseLayer name="Terrain">
              <TileLayer
                url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors'
              />
            </BaseLayer>
            
            <BaseLayer name="Ocean">
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}"
                attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
              />
            </BaseLayer>
          </LayersControl>
          
          {/* Labels-only layer above heatmaps for readability - show for both wind and waves */}
          {(overlayType === 'wind' || overlayType === 'waves') && (
            <Pane name="labels" style={{ zIndex: 650, pointerEvents: 'none' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png"
                attribution="&copy; OpenStreetMap &copy; CARTO"
                opacity={0.95}
              />
            </Pane>
          )}

          {/* Show buoys (overlays disabled for now) */}
        {showBuoys && buoys.map((buoy) => {
          const score = scoreBuoy(buoy);
            const hasError = buoy.error;

          return (
              <Marker
                  key={buoy.station}
                  position={[buoy.lat, buoy.lon]}
                    icon={getIcon(hasError ? 0 : score)}
                    eventHandlers={{
                      click: () => handleBuoyClick(buoy)
                    }}
              >
                <Popup>
                    <div style={{ textAlign: 'center' }}>
                      <strong style={{ fontSize: '14px' }}>
                        {buoy.name || `Buoy ${buoy.station}`}
                      </strong>
                      {hasError && (
                        <>
                          <br/>
                          <span style={{ color: 'var(--fire)', fontSize: '12px' }}>
                            {buoy.error}
                          </span>
                        </>
                      )}
                    </div>
                </Popup>
              </Marker>
          );
        })}

          {/* Surf Spots */}
          {showSurfSpots && surfSpots.map((spot) => {
            const conditions = spot.current_conditions;
            const score = conditions?.overall_score || 0;

            return (
              <Marker
                key={spot.id}
                position={[spot.latitude, spot.longitude]}
                icon={getSurfSpotIcon(score)}
                eventHandlers={{
                  click: () => handleSpotClick(spot)
                }}
              >
                <Popup>
                  <div style={{ textAlign: 'center', minWidth: '200px' }}>
                    <strong style={{ fontSize: '16px' }}>
                      {spot.name}
                    </strong>
                    {conditions && (
                      <>
                        <div style={{
                          fontSize: '28px',
                          margin: '8px 0',
                          color: score >= 7 ? 'var(--good)' : score >= 5 ? 'var(--fire)' : 'var(--muted)'
                        }}>
                          {score}/10
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
                          {conditions.rating}
                        </div>
                        <div style={{ fontSize: '12px', marginTop: '8px', color: 'var(--muted)' }}>
                          {conditions.adjusted_height_ft}ft @ {conditions.period_sec}s
                        </div>
                        <div style={{ fontSize: '11px', marginTop: '4px', color: 'var(--muted)' }}>
                          {spot.spot_characteristics?.break_type} · {spot.spot_characteristics?.skill_level}
                        </div>
                        <a
                          href={`/spots/${spot.slug}`}
                          style={{
                            display: 'inline-block',
                            marginTop: '12px',
                            padding: '6px 14px',
                            background: 'var(--accent-2)',
                            color: 'var(--bg)',
                            textDecoration: 'none',
                            borderRadius: 'var(--radius)',
                            fontSize: '12px',
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                          }}
                        >
                          View Details
                        </a>
                      </>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Wind Overlay - Windy-style (heatmap + particles) */}
          {overlayType === 'wind' && windData && windData.vectors && windData.vectors.length > 0 && (
            <>
              <WindCanvasLayer
                windData={windData}
                visible={true}
              />
              {showWindParticles && (
                <WindParticlesLayer
                  windData={windData}
                  visible={true}
                />
              )}
            </>
          )}
          
          {/* Wave Overlay - Heatmap + optional particles */}
          {overlayType === 'waves' && waveData && waveData.vectors && waveData.vectors.length > 0 && (
            <>
              <WaveCanvasLayer
                waveData={waveData}
                visible={true}
                units={units}
              />
              {showWaveParticles && (
                <WaveParticlesLayer
                  waveData={waveData}
                  visible={true}
                />
              )}
            </>
          )}
          
          {/* Optional: Debug vectors (sparse arrows) - uncomment to enable */}
          {false && overlayType === 'wind' && windData && windData.vectors && windData.vectors.length > 0 && (
            <WindGrid
              windData={windData}
              model={selectedWindModel}
              visible={true}
            />
          )}
      </MapContainer>
        )}

        {/* Wind Debug Badge */}
        {overlayType === 'wind' && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 1000,
            background: 'rgba(0,0,0,0.65)',
            color: 'white',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '12px'
          }}>
            Wind: {selectedWindModel.toUpperCase()} | Frame +{selectedForecastHour ?? '—'}h | Vectors: {windData?.vectors?.length ?? 0}
          </div>
        )}

        {/* Buoy Details Panel - Full screen on mobile */}
        {selectedBuoy && (isMobile ? showMobileDetail : true) && (
          <div style={{
            position: 'absolute',
            top: isMobile ? '0' : '80px',
            left: isMobile ? '0' : '16px',
            right: isMobile ? '0' : 'auto',
            bottom: isMobile ? '0' : 'auto',
            zIndex: 50,
            background: 'var(--bg-2)',
            backdropFilter: 'var(--panel-blur)',
            WebkitBackdropFilter: 'var(--panel-blur)',
            border: isMobile ? 'none' : '1px solid var(--border)',
            padding: '16px',
            borderRadius: isMobile ? '0' : 'var(--radius-l)',
            boxShadow: isMobile ? 'none' : '0 4px 24px rgba(0,0,0,0.35)',
            minWidth: isMobile ? 'auto' : '280px',
            maxWidth: isMobile ? 'none' : '320px',
            width: isMobile ? '100%' : 'auto',
            height: isMobile ? '100%' : 'auto',
            maxHeight: isMobile ? 'none' : 'calc(100vh - 100px)',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: isMobile ? '20px' : '16px', color: 'var(--accent)' }}>
                {selectedBuoy.name || `Buoy ${selectedBuoy.station}`}
              </h3>
              <button
                onClick={() => isMobile ? handleCloseMobileDetail() : setSelectedBuoy(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: isMobile ? '28px' : '20px',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  padding: '0',
                  width: isMobile ? '32px' : '24px',
                  height: isMobile ? '32px' : '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={isMobile ? "Back to Map" : "Close"}
              >
                ✕
              </button>
            </div>
            
            {/* Buoy Selector - Mobile Only */}
            {isMobile && buoys.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                  Switch Buoy:
                </label>
                <select
                  value={selectedBuoy.station}
                  onChange={(e) => {
                    const buoy = buoys.find(b => b.station === e.target.value);
                    if (buoy) {
                      setSelectedBuoy(buoy);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    fontSize: '14px',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--bg-3)',
                    color: 'var(--fg)',
                  }}
                >
                  {buoys.map(buoy => (
                    <option key={buoy.station} value={buoy.station}>
                      {buoy.name || `Buoy ${buoy.station}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            {selectedBuoy.error ? (
              <div style={{ color: 'var(--fire)', fontSize: '14px' }}>
                Error: {selectedBuoy.error}
              </div>
            ) : (
              <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>SURF SCORE</div>
                  <div style={{ 
                    fontSize: '24px', 
                    fontWeight: 'bold',
                    color: ['grey', 'red', 'orange', 'green'][scoreBuoy(selectedBuoy)]
                  }}>
                    {scoreBuoy(selectedBuoy)}/3
                  </div>
                </div>
                
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Swell Height:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold', color: 'var(--accent)', fontSize: '14px' }}>
                      {formatWaveHeight(selectedBuoy.wave_height_m)}
                        
                        <TrendIndicator trend={selectedBuoy.wave_trend} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)', fontSize: '11px' }}>Max Face Height:</td>
                      <td style={{ padding: '4px 0', fontSize: '11px' }}>
                      {formatSurfSize(selectedBuoy.surf_height_m)}
                        
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Period:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {selectedBuoy.dominant_period_sec} sec
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Wave Dir:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {selectedBuoy.mean_wave_dir}°
                        <DirectionArrow degrees={parseFloat(selectedBuoy.mean_wave_dir)} color="#0066cc" />
                      </td>
                    </tr>
                    {selectedBuoy.wave_energy && (
                      <tr>
                        <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Wave Energy:</td>
                        <td style={{ padding: '4px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: '80px' }}>
                              <div style={{
                                height: '18px',
                                background: 'var(--bg-3)',
                                borderRadius: '9px',
                                overflow: 'hidden',
                                position: 'relative'
                              }}>
                                <div style={{
                                  height: '100%',
                                  width: `${getEnergyLevel(selectedBuoy.wave_energy).width}%`,
                                  backgroundColor: getEnergyLevel(selectedBuoy.wave_energy).color,
                                  borderRadius: '9px',
                                  transition: 'width 0.3s ease'
                                }} />
                              </div>
                            </div>
                            <div style={{ 
                              fontSize: '11px', 
                              fontWeight: 'bold',
                              color: getEnergyLevel(selectedBuoy.wave_energy).color,
                              minWidth: '85px'
                            }}>
                              {selectedBuoy.wave_energy.toFixed(0)} - {getEnergyLevel(selectedBuoy.wave_energy).label}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 8px 4px 0', color: 'var(--muted)' }}>💨 Wind Speed:</td>
                      <td style={{ padding: '8px 0 4px 0', fontWeight: 'bold' }}>
                        {formatWindSpeed(selectedBuoy.wind_speed_ms)}
                        {selectedBuoy.wind_source && selectedBuoy.wind_source !== 'buoy' && selectedBuoy.wind_source !== 'N/A' && (
                          <div style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 'normal' }}>
                            via {selectedBuoy.wind_source}
                          </div>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Wind Dir:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {getWindDirection(selectedBuoy.wind_dir)}
                        <DirectionArrow degrees={selectedBuoy.wind_dir} color="#FF6B35" />
                      </td>
                    </tr>
                    {selectedBuoy.wind_gust_ms && (
                      <tr>
                        <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Wind Gust:</td>
                        <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                          {formatWindSpeed(selectedBuoy.wind_gust_ms)}
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 8px 4px 0', color: 'var(--muted)' }}>Water Temp:</td>
                      <td style={{ padding: '8px 0 4px 0', fontWeight: 'bold' }}>
                        {formatTemp(selectedBuoy.water_temp_c)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Air Temp:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {formatTemp(selectedBuoy.air_temp_c)}
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 8px 4px 0', color: 'var(--muted)' }}>Station ID:</td>
                      <td style={{ padding: '8px 0 4px 0', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {selectedBuoy.station}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--muted)' }}>Updated:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold', fontSize: '12px' }}>
                        {formatTime(selectedBuoy.timestamp_utc)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Chart Toggle Button */}
                <button
                  onClick={() => {
                    if (!showChart && historicalData.length === 0) {
                      fetchHistoricalData(selectedBuoy.station);
                    }
                    setShowChart(!showChart);
                  }}
                  style={{
                    width: '100%',
                    marginTop: '12px',
                    padding: '8px',
                    background: 'var(--accent-2)',
                    color: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>{showChart ? 'Hide Charts' : 'Wave History'}</span>
                </button>

                {/* Historical Charts */}
                {showChart && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--fg)', fontWeight: 600 }}>
                        Wave History & Forecast
                      </h4>
                      <label style={{
                        fontSize: '11px',
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="checkbox"
                          checked={showForecast}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setShowForecast(checked);
                            if (checked && forecastData.length === 0 && !forecastLoading) {
                              fetchForecastData(selectedBuoy.station);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        5-day forecast
                      </label>
                    </div>
                    
                    {chartLoading && (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
                        Loading chart data…
                      </div>
                    )}

                    {chartError && (
                      <div style={{ padding: '12px', background: 'oklch(0.4 0.15 25 / 0.15)', borderRadius: 'var(--radius)', color: 'var(--fire)', fontSize: '12px', border: '1px solid var(--fire)' }}>
                        {chartError}
                      </div>
                    )}
                    
                    {!chartLoading && !chartError && historicalData.length > 0 && (
                      <>
                        {/* Wave Height Chart */}
                        <div style={{ marginBottom: '20px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Wave Height & Face Height
                            {forecastLoading && <span style={{ color: 'var(--muted)', fontWeight: 'normal', marginLeft: '8px' }}>(Loading…)</span>}
                          </div>
                          <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={showForecast ? [...historicalData, ...forecastData] : historicalData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                              <XAxis 
                                dataKey="time" 
                                tick={{ fontSize: 10 }}
                                interval="preserveStartEnd"
                              />
                              <YAxis 
                                tick={{ fontSize: 10 }}
                                label={{ 
                                  value: units === 'imperial' ? 'Height (ft)' : 'Height (m)', 
                                  angle: -90, 
                                  position: 'insideLeft',
                                  style: { fontSize: 10 }
                                }}
                              />
                              <Tooltip 
                                contentStyle={{ fontSize: '11px' }}
                                formatter={(value, name) => {
                                  const formatted = value ? value.toFixed(2) : 'N/A';
                                  return [formatted, name];
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Line 
                                type="monotone" 
                                dataKey="waveHeight" 
                                stroke="#0066cc" 
                                name="Wave Height (Obs)"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                                connectNulls
                              />
                              <Line 
                                type="monotone" 
                                dataKey="surfHeight" 
                                stroke="#22c55e" 
                                name="Face Height (Obs)"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                                connectNulls
                              />
                              {showForecast && forecastData.length > 0 && (
                                <>
                                  <Line 
                                    type="monotone" 
                                    dataKey="waveHeight" 
                                    stroke="#6ba3ff" 
                                    name="Wave Height (Fcst)"
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    dot={{ r: 1 }}
                                    connectNulls
                                  />
                                  <Line 
                                    type="monotone" 
                                    dataKey="surfHeight" 
                                    stroke="#7cdb8e" 
                                    name="Face Height (Fcst)"
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    dot={{ r: 1 }}
                                    connectNulls
                                  />
                                </>
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Period Chart */}
                        <div style={{ marginBottom: '20px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Wave Period
                          </div>
                          <ResponsiveContainer width="100%" height={150}>
                            <LineChart data={showForecast ? [...historicalData, ...forecastData] : historicalData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                              <XAxis 
                                dataKey="time" 
                                tick={{ fontSize: 10 }}
                                interval="preserveStartEnd"
                              />
                              <YAxis 
                                tick={{ fontSize: 10 }}
                                label={{ 
                                  value: 'Period (sec)', 
                                  angle: -90, 
                                  position: 'insideLeft',
                                  style: { fontSize: 10 }
                                }}
                              />
                              <Tooltip 
                                contentStyle={{ fontSize: '11px' }}
                                formatter={(value) => value ? value.toFixed(1) : 'N/A'}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Line 
                                type="monotone" 
                                dataKey="period" 
                                stroke="#f59e0b" 
                                name="Period (Obs)"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                                connectNulls
                              />
                              {showForecast && forecastData.length > 0 && (
                                <Line 
                                  type="monotone" 
                                  dataKey="period" 
                                  stroke="#ffc266" 
                                  name="Period (Fcst)"
                                  strokeWidth={2}
                                  strokeDasharray="5 5"
                                  dot={{ r: 1 }}
                                  connectNulls
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Energy Chart */}
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Wave Energy Index
                          </div>
                          <ResponsiveContainer width="100%" height={150}>
                            <LineChart data={showForecast ? [...historicalData, ...forecastData] : historicalData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                              <XAxis 
                                dataKey="time" 
                                tick={{ fontSize: 10 }}
                                interval="preserveStartEnd"
                              />
                              <YAxis 
                                tick={{ fontSize: 10 }}
                                label={{ 
                                  value: 'Energy', 
                                  angle: -90, 
                                  position: 'insideLeft',
                                  style: { fontSize: 10 }
                                }}
                              />
                              <Tooltip 
                                contentStyle={{ fontSize: '11px' }}
                                formatter={(value) => value ? value.toFixed(0) : 'N/A'}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px' }} />
                              <Line 
                                type="monotone" 
                                dataKey="energy" 
                                stroke="#ef4444" 
                                name="Energy (Obs)"
                                strokeWidth={2}
                                dot={{ r: 2 }}
                                connectNulls
                              />
                              {showForecast && forecastData.length > 0 && (
                                <Line 
                                  type="monotone" 
                                  dataKey="energy" 
                                  stroke="#ff8888" 
                                  name="Energy (Fcst)"
                                  strokeWidth={2}
                                  strokeDasharray="5 5"
                                  dot={{ r: 1 }}
                                  connectNulls
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    )}
                    
                    {!chartLoading && !chartError && historicalData.length === 0 && (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                        No historical data available
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Windy-style Footer Timeline */}
        {overlayType === 'wind' && windFrames?.hours?.length > 1 && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '92px',
            background: 'var(--panel)',
            backdropFilter: 'var(--panel-blur)',
            WebkitBackdropFilter: 'var(--panel-blur)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            zIndex: 50,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
          }}>
            {/* Left: Play/Pause */}
            <div style={{ width: '80px', display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={handlePlayPause}
                style={{
                  width: 36, height: 36,
                  background: isPlaying ? 'var(--fire)' : 'var(--accent-2)',
                  color: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
            </div>

            {/* Center: Timeline Bar */}
            <div style={{ 
              flex: 1, 
              position: 'relative', 
              height: '50px',
              margin: '0 20px',
              cursor: 'pointer'
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const maxIdx = windFrames.hours.length - 1;
              const nearestIdx = Math.round((percent / 100) * maxIdx);
              setHoveredFrameIndex(nearestIdx);
            }}
            onMouseLeave={() => setHoveredFrameIndex(null)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const maxIdx = windFrames.hours.length - 1;
              const nearestIdx = Math.round((percent / 100) * maxIdx);
              setSelectedFrameIndex(nearestIdx);
            }}
            >
              {/* Daily tick marks */}
              {dailyTicks.map((tick) => {
                const maxIdx = windFrames.hours.length - 1;
                const positionPercent = maxIdx > 0 ? (tick.idx / maxIdx) * 100 : 0;
                return (
                  <div
                    key={tick.idx}
                    style={{
                      position: 'absolute',
                      left: `${positionPercent}%`,
                      transform: 'translateX(-50%)',
                      height: '20px',
                      width: '1px',
                      background: 'var(--border)',
                      top: '0px'
                    }}
                  />
                );
              })}

              {/* Current time marker (playhead) */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(selectedFrameIndex / (windFrames.hours.length - 1)) * 100}%`,
                  transform: 'translateX(-50%)',
                  width: '3px',
                  height: '30px',
                  background: 'var(--accent)',
                  top: '0px',
                  zIndex: 10,
                  boxShadow: '0 0 6px var(--accent)'
                }}
              />

              {/* Time chip above playhead */}
              {selectedTimeUtc && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(selectedFrameIndex / (windFrames.hours.length - 1)) * 100}%`,
                    transform: 'translateX(-50%)',
                    bottom: '32px',
                    background: 'var(--accent)',
                    color: 'var(--bg)',
                    padding: '3px 7px',
                    borderRadius: 'var(--radius)',
                    fontSize: '11px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    zIndex: 11,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                  }}
                >
                  {isPlaying ? formatTimelineHourOnly(selectedTimeUtc) : formatTimelineDayTime(selectedTimeUtc)}
                </div>
              )}

              {/* Hover tooltip */}
              {hoveredFrameIndex !== null && hoveredFrameIndex !== selectedFrameIndex && windFrames?.times_utc?.[hoveredFrameIndex] && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(hoveredFrameIndex / (windFrames.hours.length - 1)) * 100}%`,
                    transform: 'translateX(-50%)',
                    bottom: '32px',
                    background: 'var(--bg-2)',
                    color: 'var(--fg)',
                    padding: '3px 7px',
                    borderRadius: 'var(--radius)',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    zIndex: 12,
                    pointerEvents: 'none',
                    border: '1px solid var(--border)',
                    fontWeight: 600
                  }}
                >
                  {formatTimelineDayTime(windFrames?.times_utc?.[hoveredFrameIndex])}
                </div>
              )}

              {/* Daily labels below */}
              {dailyTicks.map((tick) => {
                const maxIdx = windFrames.hours.length - 1;
                const positionPercent = maxIdx > 0 ? (tick.idx / maxIdx) * 100 : 0;
                return (
                  <div
                    key={`label-${tick.idx}`}
                    style={{
                      position: 'absolute',
                      left: `${positionPercent}%`,
                      transform: 'translateX(-50%)',
                      top: '22px',
                      fontSize: '10px',
                      color: 'var(--muted)',
                      whiteSpace: 'nowrap',
                      fontWeight: 600
                    }}
                  >
                    {tick.label}
                  </div>
                );
              })}
            </div>

            {/* Right: Legend + Labels */}
            <div style={{
              width: '520px',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '16px'
            }}>
              <WindSpeedLegend units="mph" />
              <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--fg)', minWidth: '120px' }}>
                <div><strong>+{windFrames.hours[selectedFrameIndex]}h</strong></div>
                <div>{selectedWindModel.toUpperCase()}</div>
                <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  {forecastUtcLabel.split(' ')[4] || '—'}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Waves Footer with Timeline */}
        {overlayType === 'waves' && waveFrames?.hours?.length > 1 && (
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '92px',
            background: 'var(--panel)',
            backdropFilter: 'var(--panel-blur)',
            WebkitBackdropFilter: 'var(--panel-blur)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            zIndex: 50,
            boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
          }}>
            {/* Left: Play/Pause */}
            <div style={{ width: '80px', display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={handleWavePlayPause}
                style={{
                  width: 36, height: 36,
                  background: isWavePlaying ? 'var(--fire)' : 'var(--accent-2)',
                  color: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isWavePlaying ? '⏸' : '▶'}
              </button>
            </div>

            {/* Center: Timeline Bar */}
            <div style={{
              flex: 1,
              position: 'relative',
              height: '50px',
              margin: '0 20px',
              cursor: 'pointer'
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const maxIdx = waveFrames.hours.length - 1;
              const nearestIdx = Math.round((percent / 100) * maxIdx);
              setHoveredWaveFrameIndex(nearestIdx);
            }}
            onMouseLeave={() => setHoveredWaveFrameIndex(null)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
              const maxIdx = waveFrames.hours.length - 1;
              const nearestIdx = Math.round((percent / 100) * maxIdx);
              handleWaveFrameChange(nearestIdx);
            }}
            >
              {/* Daily tick marks */}
              {waveDailyTicks.map((tick) => {
                const maxIdx = waveFrames.hours.length - 1;
                const positionPercent = maxIdx > 0 ? (tick.idx / maxIdx) * 100 : 0;
                return (
                  <div
                    key={tick.idx}
                    style={{
                      position: 'absolute',
                      left: `${positionPercent}%`,
                      transform: 'translateX(-50%)',
                      height: '20px',
                      width: '1px',
                      background: 'var(--border)',
                      top: '0px'
                    }}
                  />
                );
              })}

              {/* Current time marker (playhead) */}
              <div
                style={{
                  position: 'absolute',
                  left: `${(selectedWaveFrameIndex / (waveFrames.hours.length - 1)) * 100}%`,
                  transform: 'translateX(-50%)',
                  width: '3px',
                  height: '30px',
                  background: 'var(--accent)',
                  top: '0px',
                  zIndex: 10,
                  boxShadow: '0 0 6px var(--accent)'
                }}
              />

              {/* Time chip above playhead */}
              {selectedWaveTimeUtc && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(selectedWaveFrameIndex / (waveFrames.hours.length - 1)) * 100}%`,
                    transform: 'translateX(-50%)',
                    bottom: '32px',
                    background: 'var(--accent)',
                    color: 'var(--bg)',
                    padding: '3px 7px',
                    borderRadius: 'var(--radius)',
                    fontSize: '11px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    zIndex: 11,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                  }}
                >
                  {isWavePlaying ? formatTimelineHourOnly(selectedWaveTimeUtc) : formatTimelineDayTime(selectedWaveTimeUtc)}
                </div>
              )}

              {/* Hover tooltip */}
              {hoveredWaveFrameIndex !== null && hoveredWaveFrameIndex !== selectedWaveFrameIndex && waveFrames?.times_utc?.[hoveredWaveFrameIndex] && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(hoveredWaveFrameIndex / (waveFrames.hours.length - 1)) * 100}%`,
                    transform: 'translateX(-50%)',
                    bottom: '32px',
                    background: 'var(--bg-2)',
                    color: 'var(--fg)',
                    padding: '3px 7px',
                    borderRadius: 'var(--radius)',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    zIndex: 12,
                    pointerEvents: 'none',
                    border: '1px solid var(--border)',
                    fontWeight: 600
                  }}
                >
                  {formatTimelineDayTime(waveFrames?.times_utc?.[hoveredWaveFrameIndex])}
                </div>
              )}

              {/* Daily labels below */}
              {waveDailyTicks.map((tick) => {
                const maxIdx = waveFrames.hours.length - 1;
                const positionPercent = maxIdx > 0 ? (tick.idx / maxIdx) * 100 : 0;
                return (
                  <div
                    key={`label-${tick.idx}`}
                    style={{
                      position: 'absolute',
                      left: `${positionPercent}%`,
                      transform: 'translateX(-50%)',
                      top: '22px',
                      fontSize: '10px',
                      color: 'var(--muted)',
                      whiteSpace: 'nowrap',
                      fontWeight: 600
                    }}
                  >
                    {tick.label}
                  </div>
                );
              })}
            </div>

            {/* Right: Legend + Labels */}
            <div style={{
              width: '520px',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '16px'
            }}>
              <WaveHeightLegend units={units} />
              <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--fg)', minWidth: '120px' }}>
                <div><strong>+{waveFrames.hours[selectedWaveFrameIndex]}h</strong></div>
                <div>WW3</div>
                <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
                  {waveForecastUtcLabel.split(' ')[4] || '—'}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
  );
}