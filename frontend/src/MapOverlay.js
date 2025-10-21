import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl } from 'react-leaflet';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import WindParticles from './WindParticles';
import WaveParticles from './WaveParticles';

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

export default function MapOverlay() {
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
  const [overlayType, setOverlayType] = useState('none'); // 'none', 'wind', 'swell'
  const [selectedWindModel, setSelectedWindModel] = useState('hrrr'); // 'gfs', 'hrrr', 'nam'
  const [overlayData, setOverlayData] = useState({
    wind: null,
    swell: null
  });
  
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
    if (overlayType === type) {
      // If clicking the same type, turn it off
      setOverlayType('none');
    } else {
      // Switch to the new type
      setOverlayType(type);
      if (type === 'wind') {
        fetchWindOverlay(selectedWindModel);
      } else if (type === 'swell') {
        fetchSwellOverlay();
      }
    }
  };

  // Handle wind model selection (only when wind overlay is active)
  const handleWindModelChange = (model) => {
    setSelectedWindModel(model);
    if (overlayType === 'wind') {
      fetchWindOverlay(model);
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

  return (
      <div style={{ position: 'relative', height: 'calc(100vh - 80px)', width: '100%' }}>
        {/* Control Panel */}
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 1000,
          backgroundColor: 'white',
          padding: '12px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          minWidth: '220px'
        }}>
          <button
              onClick={fetchBuoyData}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px 16px',
                backgroundColor: loading ? '#ccc' : '#0066cc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
          >
            {loading ? 'Loading...' : '🔄 Refresh Data'}
          </button>
          
          {/* Units Selector */}
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
              Units:
            </label>
            <select
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  fontSize: '12px'
                }}
            >
              <option value="imperial">Imperial (ft, °F)</option>
              <option value="metric">Metric (m, °C)</option>
            </select>
          </div>

          {/* Timezone Selector */}
          <div style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
              Timezone:
            </label>
            <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  fontSize: '12px'
                }}
            >
              <option value="local">Local Time</option>
              <option value="utc">UTC</option>
            </select>
          </div>

          {/* Overlay Controls - DISABLED FOR NOW */}
          {false && (
          <div style={{ 
            marginTop: '12px', 
            paddingTop: '12px', 
            borderTop: '2px solid #eee' 
          }}>
            <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
              🌊 Ocean Overlays: (Coming Soon)
            </label>
          </div>
          )}
          
          {lastUpdated && (
              <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
                Last updated:<br/>
                {lastUpdated.toLocaleTimeString()}
              </div>
          )}
          
          {error && (
              <div style={{ fontSize: '12px', marginTop: '8px', color: '#d32f2f', fontWeight: 'bold' }}>
                ⚠️ Error: {error}
              </div>
          )}
          
          {/* Legend */}
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #eee' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
              Surf Score:
            </div>
            <div style={{ fontSize: '11px', lineHeight: '1.6' }}>
              <span style={{ color: 'green' }}>🟢</span> Excellent (3)<br/>
              <span style={{ color: 'orange' }}>🟠</span> Good (2)<br/>
              <span style={{ color: 'red' }}>🔴</span> Fair (1)<br/>
              <span style={{ color: 'grey' }}>⚫</span> Poor/No Data (0)
            </div>
          </div>
        </div>

        {/* Map Container */}
        <MapContainer center={mapCenter} zoom={6.5} style={{ height: '100%', width: '100%' }}>
          <LayersControl position="bottomleft">
            <BaseLayer checked name="OpenStreetMap">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
          
          {/* Show buoys (overlays disabled for now) */}
          {buoys.map((buoy) => {
            const score = scoreBuoy(buoy);
            const hasError = buoy.error;
            
            return (
                <Marker
                    key={buoy.station}
                    position={[buoy.lat, buoy.lon]}
                    icon={getIcon(hasError ? 0 : score)}
                    eventHandlers={{
                      click: () => setSelectedBuoy(buoy)
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
                          <span style={{ color: '#d32f2f', fontSize: '12px' }}>
                            ⚠️ {buoy.error}
                          </span>
                        </>
                      )}
                    </div>
                  </Popup>
                </Marker>
            );
          })}

          {/* Overlays disabled for now - will be redesigned */}
          {false && overlayType === 'wind' && overlayData.wind?.[selectedWindModel] && (
            <WindParticles 
              key={`particles-${selectedWindModel}`}
              windData={overlayData.wind[selectedWindModel]}
              visible={true}
            />
          )}

          {false && overlayType === 'swell' && overlayData.swell && (
            <WaveParticles 
              swellData={overlayData.swell}
              visible={true}
            />
          )}
        </MapContainer>

        {/* Buoy Details Panel */}
        {selectedBuoy && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 1000,
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            minWidth: '280px',
            maxWidth: '320px',
            maxHeight: 'calc(100vh - 20px)',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#0066cc' }}>
                {selectedBuoy.name || `Buoy ${selectedBuoy.station}`}
              </h3>
              <button
                onClick={() => setSelectedBuoy(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#666',
                  padding: '0',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
            
            {selectedBuoy.error ? (
              <div style={{ color: '#d32f2f', fontSize: '14px' }}>
                ⚠️ Error: {selectedBuoy.error}
              </div>
            ) : (
              <div style={{ fontSize: '14px', lineHeight: '1.8' }}>
                <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #eee' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>SURF SCORE</div>
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
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Swell Height:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold', color: '#0066cc', fontSize: '14px' }}>
                      {formatWaveHeight(selectedBuoy.wave_height_m)}
                        
                        <TrendIndicator trend={selectedBuoy.wave_trend} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: '#666', fontSize: '11px' }}>Max Face Height:</td>
                      <td style={{ padding: '4px 0', fontSize: '11px' }}>
                      {formatSurfSize(selectedBuoy.surf_height_m)}
                        
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Period:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {selectedBuoy.dominant_period_sec} sec
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Wave Dir:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {selectedBuoy.mean_wave_dir}°
                        <DirectionArrow degrees={parseFloat(selectedBuoy.mean_wave_dir)} color="#0066cc" />
                      </td>
                    </tr>
                    {selectedBuoy.wave_energy && (
                      <tr>
                        <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Wave Energy:</td>
                        <td style={{ padding: '4px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: '80px' }}>
                              <div style={{
                                height: '18px',
                                backgroundColor: '#e5e7eb',
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
                    <tr style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '8px 8px 4px 0', color: '#666' }}>💨 Wind Speed:</td>
                      <td style={{ padding: '8px 0 4px 0', fontWeight: 'bold' }}>
                        {formatWindSpeed(selectedBuoy.wind_speed_ms)}
                        {selectedBuoy.wind_source && selectedBuoy.wind_source !== 'buoy' && selectedBuoy.wind_source !== 'N/A' && (
                          <div style={{ fontSize: '10px', color: '#888', fontWeight: 'normal' }}>
                            via {selectedBuoy.wind_source}
                          </div>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Wind Dir:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {getWindDirection(selectedBuoy.wind_dir)}
                        <DirectionArrow degrees={selectedBuoy.wind_dir} color="#FF6B35" />
                      </td>
                    </tr>
                    {selectedBuoy.wind_gust_ms && (
                      <tr>
                        <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Wind Gust:</td>
                        <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                          {formatWindSpeed(selectedBuoy.wind_gust_ms)}
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '8px 8px 4px 0', color: '#666' }}>Water Temp:</td>
                      <td style={{ padding: '8px 0 4px 0', fontWeight: 'bold' }}>
                        {formatTemp(selectedBuoy.water_temp_c)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Air Temp:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {formatTemp(selectedBuoy.air_temp_c)}
                      </td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '8px 8px 4px 0', color: '#666' }}>Station ID:</td>
                      <td style={{ padding: '8px 0 4px 0', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {selectedBuoy.station}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Updated:</td>
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
                    padding: '10px',
                    backgroundColor: '#0066cc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#0052a3'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#0066cc'}
                >
                  <span>{showChart ? '📊 Hide Charts' : '📈 Show Wave History'}</span>
                </button>

                {/* Historical Charts */}
                {showChart && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '2px solid #eee' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', color: '#333' }}>
                        📈 Wave History & Forecast
                      </h4>
                      <label style={{ 
                        fontSize: '11px', 
                        color: '#666', 
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
                      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                        Loading chart data...
                      </div>
                    )}
                    
                    {chartError && (
                      <div style={{ padding: '12px', backgroundColor: '#fee', borderRadius: '6px', color: '#d32f2f', fontSize: '12px' }}>
                        ⚠️ {chartError}
                      </div>
                    )}
                    
                    {!chartLoading && !chartError && historicalData.length > 0 && (
                      <>
                        {/* Wave Height Chart */}
                        <div style={{ marginBottom: '20px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', marginBottom: '8px' }}>
                            Wave Height & Face Height
                            {forecastLoading && <span style={{ color: '#999', fontWeight: 'normal', marginLeft: '8px' }}>(Loading forecast...)</span>}
                          </div>
                          <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={showForecast ? [...historicalData, ...forecastData] : historicalData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
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
                          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', marginBottom: '8px' }}>
                            Wave Period
                          </div>
                          <ResponsiveContainer width="100%" height={150}>
                            <LineChart data={showForecast ? [...historicalData, ...forecastData] : historicalData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
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
                          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#666', marginBottom: '8px' }}>
                            Wave Energy Index
                          </div>
                          <ResponsiveContainer width="100%" height={150}>
                            <LineChart data={showForecast ? [...historicalData, ...forecastData] : historicalData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
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
                      <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '12px' }}>
                        No historical data available
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
  );
}