import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
      text: 'Rising',
      path: 'M12 19 L12 5 M12 5 L8 9 M12 5 L16 9'
    },
    holding: { 
      icon: '→', 
      color: '#3b82f6', 
      text: 'Holding',
      path: 'M5 12 L19 12 M19 12 L15 8 M19 12 L15 16'
    },
    falling: { 
      icon: '↓', 
      color: '#ef4444', 
      text: 'Falling',
      path: 'M12 5 L12 19 M12 19 L8 15 M12 19 L16 15'
    }
  };
  
  const config = trendConfig[trend] || trendConfig.holding;
  
  return (
    <span title={config.text} style={{ cursor: 'help' }}>
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
  const wave = b.wave_height_m;
  const period = parseFloat(b.dominant_period_sec);
  const dir = parseFloat(b.mean_wave_dir);

  if (!wave || isNaN(wave) || isNaN(period) || isNaN(dir)) return 0;
  
  // Convert to feet for scoring
  const waveFt = metersToFeet(wave);
  
  if (waveFt > 4 && period > 12 && dir >= 250 && dir <= 310) return 3;
  if (waveFt >= 2 && waveFt <= 4 && period > 10) return 2;
  if (waveFt < 2 || period < 10) return 1;
  return 0;
};

export default function MapOverlay() {
  const [buoys, setBuoys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedBuoy, setSelectedBuoy] = useState(null);
  
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
            maxWidth: '320px'
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
                      <td style={{ padding: '4px 8px 4px 0', color: '#666' }}>Wave Height:</td>
                      <td style={{ padding: '4px 0', fontWeight: 'bold' }}>
                        {formatWaveHeight(selectedBuoy.wave_height_m)}
                        <TrendIndicator trend={selectedBuoy.wave_trend} />
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
              </div>
            )}
          </div>
        )}
      </div>
  );
}