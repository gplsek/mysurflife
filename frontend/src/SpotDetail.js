import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAuth } from './AuthContext';
import AISpotAnalysis from './AISpotAnalysis';
import './SpotDetail.css';

// Skeleton loader component
const SkeletonLoader = ({ height = '100px', className = '' }) => (
  <div className={`skeleton-loader ${className}`} style={{ height }}>
    <div className="skeleton-shimmer"></div>
  </div>
);

// Map interaction controller component
const MapInteractionController = ({ isEditMode }) => {
  const map = useMap();

  useEffect(() => {
    if (isEditMode) {
      // Enable all interactions
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();

      // Add zoom control in bottom right if not already present
      if (!map.zoomControl) {
        L.control.zoom({ position: 'bottomright' }).addTo(map);
      }
    } else {
      // Disable all interactions
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();

      // Remove zoom control
      if (map.zoomControl) {
        map.removeControl(map.zoomControl);
      }
    }
  }, [isEditMode, map]);

  return null;
};

const SpotDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, signOut } = useAuth();

  // Core data (loads first - blocks render)
  const [spot, setSpot] = useState(null);
  const [conditions, setConditions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Secondary data (loads async - doesn't block render)
  const [buoyData, setBuoyData] = useState({});
  const [buoyLoading, setBuoyLoading] = useState(true);

  const [modelForecast, setModelForecast] = useState(null);
  const [modelLoading, setModelLoading] = useState(true);

  const [forecastTimeline, setForecastTimeline] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(true);

  const [selectedHour, setSelectedHour] = useState(0);

  // Edit mode state (admin only)
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedSpot, setEditedSpot] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Admin menu state
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuOpen && !e.target.closest('.admin-menu-container')) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpen]);

  // Sign out handler
  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/');
  };

  // Phase 1: Load critical data (spot + conditions) - blocks render
  useEffect(() => {
    const fetchCriticalData = async () => {
      try {
        setLoading(true);

        // Fetch spot details and conditions in parallel
        const [spotRes, conditionsRes] = await Promise.all([
          fetch(`/api/surf-spots/${slug}`),
          fetch(`/api/surf-spots/${slug}/conditions`)
        ]);

        if (!spotRes.ok) throw new Error(`Failed to fetch spot: ${spotRes.status}`);
        if (!conditionsRes.ok) throw new Error(`Failed to fetch conditions: ${conditionsRes.status}`);

        const spotData = await spotRes.json();
        const conditionsData = await conditionsRes.json();

        setSpot(spotData);
        setConditions(conditionsData);
        setError(null);
      } catch (err) {
        console.error('Error fetching spot data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchCriticalData();
  }, [slug]);

  // Phase 2: Load buoy data (async, non-blocking)
  useEffect(() => {
    const fetchBuoyData = async () => {
      try {
        setBuoyLoading(true);
        const buoyRes = await fetch('/api/buoy-status/all');
        if (buoyRes.ok) {
          const buoyDataArray = await buoyRes.json();
          const buoyMap = {};
          buoyDataArray.forEach(buoy => {
            if (buoy.station) {
              buoyMap[buoy.station] = buoy;
            }
          });
          setBuoyData(buoyMap);
        }
      } catch (err) {
        console.warn('Buoy data fetch failed:', err);
      } finally {
        setBuoyLoading(false);
      }
    };

    if (spot) fetchBuoyData();
  }, [spot]);

  // Phase 3: Load model forecast (async, non-blocking)
  useEffect(() => {
    const fetchModelForecast = async () => {
      try {
        setModelLoading(true);
        const modelRes = await fetch(`/api/surf-spots/${slug}/model-forecast`);
        if (modelRes.ok) {
          const modelData = await modelRes.json();
          setModelForecast(modelData);
        }
      } catch (err) {
        console.warn('Model forecast fetch failed:', err);
      } finally {
        setModelLoading(false);
      }
    };

    if (spot) fetchModelForecast();
  }, [slug, spot]);

  // Phase 4: Load timeline (async, non-blocking, with timeout)
  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        setTimelineLoading(true);
        const timelineController = new AbortController();
        const timelineTimeout = setTimeout(() => timelineController.abort(), 10000);

        const timelineRes = await fetch(`/api/surf-spots/${slug}/forecast-timeline?hours=48`, {
          signal: timelineController.signal
        });
        clearTimeout(timelineTimeout);

        if (timelineRes.ok) {
          const timelineData = await timelineRes.json();
          setForecastTimeline(timelineData);
        }
      } catch (err) {
        console.warn('Timeline fetch failed (non-critical):', err.message);
      } finally {
        setTimelineLoading(false);
      }
    };

    if (spot) fetchTimeline();
  }, [slug, spot]);

  if (loading) {
    return (
      <div className="spot-detail-loading">
        <div className="loading-spinner">🌊 Loading...</div>
      </div>
    );
  }

  if (error || !spot) {
    return (
      <div className="spot-detail-error">
        <h2>❌ Error</h2>
        <p>{error || 'Spot not found'}</p>
        <button onClick={() => navigate('/')}>← Back to Map</button>
      </div>
    );
  }

  // Get wind speed color based on mph (matches homepage wind overlay colors)
  const getWindSpeedColor = (speedMph) => {
    const KTS_TO_MPH = 1.15078;
    const speedKts = speedMph / KTS_TO_MPH;

    // Color stops from WindSpeedLegend.js
    const stops = [
      { kts: 0,  color: 'rgb(173,216,230)' },
      { kts: 5,  color: 'rgb(135,206,250)' },
      { kts: 10, color: 'rgb(100,200,200)' },
      { kts: 15, color: 'rgb(144,238,144)' },
      { kts: 20, color: 'rgb(255,255,100)' },
      { kts: 25, color: 'rgb(255,200,50)' },
      { kts: 30, color: 'rgb(255,140,30)' },
      { kts: 35, color: 'rgb(255,80,30)' },
      { kts: 40, color: 'rgb(220,40,60)' },
      { kts: 50, color: 'rgb(180,20,80)' },
    ];

    // Find the appropriate color stop
    for (let i = 0; i < stops.length - 1; i++) {
      if (speedKts >= stops[i].kts && speedKts < stops[i + 1].kts) {
        // Interpolate between stops
        const t = (speedKts - stops[i].kts) / (stops[i + 1].kts - stops[i].kts);
        return i === 0 ? stops[i].color : stops[i + 1].color;
      }
    }

    // If speed exceeds max, return max color
    return stops[stops.length - 1].color;
  };

  // Custom marker icon for the spot location
  const spotIcon = new L.DivIcon({
    className: 'spot-detail-marker',
    html: `
      <div style="
        background-color: #3b82f6;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
      ">
        🏄
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });

  const characteristics = spot.spot_characteristics || {};
  const score = conditions?.overall_score || 0;
  const scoreColor = score >= 7 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444';

  // Get forecast data for selected hour
  const getForecastAtHour = (hour) => {
    if (!forecastTimeline || !forecastTimeline.timeline) return null;

    // Find the exact hour or closest available hour
    const point = forecastTimeline.timeline.find(p => p.hour === hour);
    if (point) return point;

    // Find closest hour if exact not available
    let closest = forecastTimeline.timeline[0];
    let minDiff = Math.abs(closest.hour - hour);

    for (const p of forecastTimeline.timeline) {
      const diff = Math.abs(p.hour - hour);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    return closest;
  };

  // Get current or forecast wave/wind data based on selected hour
  const getCurrentWaveWind = () => {
    if (selectedHour === 0) {
      // Use current conditions from buoys
      return {
        wave_height_ft: conditions?.adjusted_height_ft,
        wave_direction: conditions?.swell_direction,
        wave_period: conditions?.period_sec,
        surf_height_ft: conditions?.surf_height_ft,
        wind_speed_mph: conditions?.wind_speed_mph || modelForecast?.models?.hrrr?.wind_speed_mph,
        wind_direction: conditions?.wind_direction || modelForecast?.models?.hrrr?.wind_direction,
        isForecast: false
      };
    } else {
      // Use forecast data
      const forecast = getForecastAtHour(selectedHour);
      if (!forecast) return null;

      return {
        wave_height_ft: forecast.wave?.height_ft,
        wave_direction: forecast.wave?.direction,
        wave_period: forecast.wave?.period,
        surf_height_ft: forecast.wave?.surf_height_ft,
        wind_speed_mph: forecast.wind?.speed_mph,
        wind_direction: forecast.wind?.direction,
        isForecast: true,
        forecastHour: forecast.hour
      };
    }
  };

  const currentData = getCurrentWaveWind();

  // Calculate swell arrow position and rotation with concentric circles
  // Arrow pivots around center of spot icon, tip touches inner circle
  // Arrow length is proportional to swell size relative to max in forecast
  const getSwellArrowData = (swellDirection, waveHeight, maxSwellHeight = 8) => {
    if (!swellDirection || !waveHeight) return null;

    // Ensure values are numbers
    const direction = parseFloat(swellDirection);
    const height = parseFloat(waveHeight);
    if (isNaN(direction) || isNaN(height)) return null;

    // Circle radii in pixels
    // Inner circle: 39px center + 5px (half of 10px border) = 44px outer edge
    const innerRadius = 44; // Arrow tips touch outer edge of white circle border
    const outerRadius = 180; // Outer boundary (larger for more scale)
    const arrowHeadWidth = 25; // Width of arrow head triangle

    // Arrow length proportional to wave height relative to max
    const lengthRatio = Math.min(height / maxSwellHeight, 1.0);

    // Total distance from inner to outer circle
    const maxArrowLength = outerRadius - innerRadius;

    // Actual arrow length based on swell size
    const arrowLength = lengthRatio * maxArrowLength;

    // Arrow rotation: swell coming FROM this direction, arrow points toward center
    // Subtract 90° because CSS 0° is right, we want 0° to be up
    const arrowRotation = direction - 90;

    return {
      rotation: arrowRotation,
      length: arrowLength,
      innerRadius: innerRadius,
      arrowHeadWidth: arrowHeadWidth,
      bodyStart: innerRadius + arrowHeadWidth, // Body starts at back of arrow head
      percentage: (lengthRatio * 100).toFixed(0),
    };
  };

  // Calculate wind arrow position and rotation with concentric circles
  // Uses EXACT SAME LOGIC as swell arrow for consistency
  const getWindArrowData = (windDirection, windSpeed, maxWindSpeed = 40) => {
    if (!windDirection || !windSpeed) return null;

    // Ensure values are numbers
    const direction = parseFloat(windDirection);
    const speed = parseFloat(windSpeed);
    if (isNaN(direction) || isNaN(speed)) return null;

    // Circle radii in pixels (SAME AS SWELL)
    const innerRadius = 44;
    const outerRadius = 180;
    const arrowHeadWidth = 25; // Width of arrow head triangle

    // Arrow length proportional to wind speed relative to max (SAME LOGIC AS SWELL)
    const lengthRatio = Math.min(speed / maxWindSpeed, 1.0);
    const maxArrowLength = outerRadius - innerRadius;
    const arrowLength = lengthRatio * maxArrowLength;

    // Arrow rotation (SAME AS SWELL)
    const arrowRotation = direction - 90;

    return {
      rotation: arrowRotation,
      length: arrowLength,
      innerRadius: innerRadius,
      arrowHeadWidth: arrowHeadWidth,
      bodyStart: innerRadius + arrowHeadWidth, // Body starts at back of arrow head
      percentage: (lengthRatio * 100).toFixed(0),
    };
  };

  // Edit mode handlers
  const enterEditMode = () => {
    console.log('🟢 enterEditMode called');
    console.log('📊 spot data:', spot);
    console.log('📋 spot.spot_characteristics:', spot.spot_characteristics);

    const characteristics = spot.spot_characteristics || {};
    console.log('📝 characteristics:', characteristics);

    const editData = {
      // Flatten spot and characteristics into single object
      name: spot.name,
      region: spot.region,
      subregion: spot.subregion || '',
      latitude: spot.latitude,
      longitude: spot.longitude,
      location_description: spot.location_description || '',
      access_description: spot.access_description || '',
      parking_info: spot.parking_info || '',
      break_type: characteristics.break_type || '',
      bottom_type: characteristics.bottom_type || '',
      wave_quality: characteristics.wave_quality || '',
      skill_level: characteristics.skill_level || '',
      best_swell_direction: characteristics.best_swell_direction || '',
      best_wind_direction: characteristics.best_wind_direction || '',
      tide_position: characteristics.tide_position || '',
      works_from_swell_ft: characteristics.works_from_swell_ft || '',
      works_to_swell_ft: characteristics.works_to_swell_ft || '',
    };

    console.log('✏️ editData populated:', editData);
    setEditedSpot(editData);
    setIsEditMode(true);
  };

  const exitEditMode = () => {
    setIsEditMode(false);
    setEditedSpot(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    console.log('🔵 handleSave called');
    console.log('📝 editedSpot:', editedSpot);

    // Validation
    if (!editedSpot.name || !editedSpot.region || !editedSpot.skill_level) {
      console.log('❌ Validation failed: missing required fields');
      setSaveError('Please fill in all required fields (Name, Region, Skill Level)');
      return;
    }

    if (editedSpot.latitude < -90 || editedSpot.latitude > 90) {
      console.log('❌ Validation failed: invalid latitude');
      setSaveError('Latitude must be between -90 and 90');
      return;
    }

    if (editedSpot.longitude < -180 || editedSpot.longitude > 180) {
      console.log('❌ Validation failed: invalid longitude');
      setSaveError('Longitude must be between -180 and 180');
      return;
    }

    try {
      setIsSaving(true);
      setSaveError(null);
      console.log('🔐 Getting auth token...');

      // Get auth token from localStorage
      const token = localStorage.getItem('sb-duebzukxycgfkfjezwjq-auth-token');
      if (!token) {
        console.log('❌ No auth token found');
        throw new Error('Not authenticated');
      }

      const sessionData = JSON.parse(token);
      const accessToken = sessionData.access_token;
      console.log('✅ Token retrieved');

      // Call API
      console.log(`📡 Calling PUT /api/admin/surf-spots/${slug}`);
      const response = await fetch(`/api/admin/surf-spots/${slug}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editedSpot)
      });

      console.log('📥 Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.log('❌ Error response:', errorData);
        throw new Error(errorData.detail || 'Failed to save changes');
      }

      const result = await response.json();
      console.log('✅ Spot updated successfully:', result);

      // Exit edit mode and reload
      exitEditMode();
      window.location.reload();

    } catch (err) {
      console.error('❌ Error saving spot:', err);
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="spot-detail-container">
      {saveError && <div className="save-error">⚠️ {saveError}</div>}

      {/* Hero Image - Static Satellite View (Interactive in Edit Mode) */}
      <div className="hero-section">
        {/* Header Overlay */}
        <div className="spot-detail-header">
          <button
            className="back-button"
            onClick={() => navigate('/')}
          >
            ← Back to Map
          </button>
          <h1>{isEditMode && editedSpot ? editedSpot.name : spot.name}</h1>
          <div className="header-actions">
            {/* Edit Mode Buttons */}
            {isAdmin && !isEditMode && (
              <button className="edit-button" onClick={enterEditMode}>
                ✏️ Edit
              </button>
            )}
            {isAdmin && isEditMode && (
              <>
                <button className="save-button" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? '💾 Saving...' : '💾 Save'}
                </button>
                <button className="cancel-button" onClick={exitEditMode} disabled={isSaving}>
                  ✖️ Cancel
                </button>
              </>
            )}

            {/* Admin Menu or Login Button */}
            {user ? (
              <div className="admin-menu-container" style={{ position: 'relative', marginLeft: '8px' }}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="menu-button"
                >
                  {isAdmin && <span>👑</span>}
                  <span>☰</span>
                </button>

                {menuOpen && (
                  <div className="admin-dropdown-menu">
                    {/* User Info */}
                    <div className="menu-user-info">
                      <div className="menu-user-role">
                        {isAdmin ? 'Admin User' : 'Signed in as'}
                      </div>
                      <div className="menu-user-email">
                        {user.email}
                      </div>
                    </div>

                    {/* Menu Items */}
                    <div className="menu-items">
                      {isAdmin && (
                        <>
                          <Link
                            to="/admin/users"
                            onClick={() => setMenuOpen(false)}
                            className="menu-link"
                          >
                            👥 Manage Users
                          </Link>
                          <Link
                            to="/admin/personas"
                            onClick={() => setMenuOpen(false)}
                            className="menu-link"
                          >
                            🤖 Manage AI Personas
                          </Link>
                          <Link
                            to="/"
                            onClick={() => setMenuOpen(false)}
                            className="menu-link"
                          >
                            🗺️ View All Spots
                          </Link>
                          <div className="menu-divider" />
                        </>
                      )}

                      <button
                        onClick={handleSignOut}
                        className="menu-button-signout"
                      >
                        🚪 Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="login-button">
                Login
              </Link>
            )}
          </div>
        </div>
        <div className="map-container">
          <MapContainer
            center={[
              isEditMode && editedSpot ? editedSpot.latitude : spot.latitude,
              isEditMode && editedSpot ? editedSpot.longitude : spot.longitude
            ]}
            zoom={15}
            dragging={false}
            touchZoom={false}
            doubleClickZoom={false}
            scrollWheelZoom={false}
            boxZoom={false}
            keyboard={false}
            zoomControl={false}
            attributionControl={false}
            className={`hero-map ${isEditMode ? 'edit-mode' : ''}`}
          >
            <MapInteractionController isEditMode={isEditMode} />
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution='&copy; Esri'
            />
            <Marker
              position={[
                isEditMode && editedSpot ? editedSpot.latitude : spot.latitude,
                isEditMode && editedSpot ? editedSpot.longitude : spot.longitude
              ]}
              icon={spotIcon}
              draggable={isEditMode}
              eventHandlers={isEditMode ? {
                dragend: (e) => {
                  const { lat, lng } = e.target.getLatLng();
                  setEditedSpot({
                    ...editedSpot,
                    latitude: parseFloat(lat.toFixed(6)),
                    longitude: parseFloat(lng.toFixed(6))
                  });
                }
              } : {}}
            />
          </MapContainer>

          {isEditMode && editedSpot && (
            <div className="coordinate-display">
              📍 {editedSpot.latitude.toFixed(6)}, {editedSpot.longitude.toFixed(6)}
            </div>
          )}
        </div>

        {/* Wave Quality Badge */}
        {characteristics.wave_quality && (
          <div className="hero-badge">
            🏄 {characteristics.wave_quality.replace('_', ' ')}
          </div>
        )}

        {/* Swell Visualization - Circles and Arrows */}
        {conditions && (
          <div className="swell-circles-container">
            {/* Inner Circle - 20px from spot marker edge */}
            <div className="swell-circle swell-circle-inner" />

            {/* Outer Circle */}
            <div className="swell-circle swell-circle-outer" />

            {/* Swell Arrow */}
            {(() => {
              if (!currentData) return null;

              // TODO: Calculate actual max from 180hr forecast data
              const arrowData = getSwellArrowData(
                currentData.wave_direction,
                currentData.wave_height_ft,
                8 // maxSwellHeight - will be dynamic with timeline
              );
              if (!arrowData) return null;

              return (
                <div
                  className="swell-arrow-container"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) rotate(${arrowData.rotation}deg)`,
                  }}
                >
                  {/* Arrow head at innerRadius */}
                  <div
                    className="swell-arrow-head"
                    style={{
                      position: 'absolute',
                      left: `${arrowData.innerRadius}px`,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  />
                  {/* Arrow body starts at back of arrow head */}
                  <div
                    className="swell-arrow-line"
                    style={{
                      width: `${arrowData.length}px`,
                      left: `${arrowData.bodyStart}px`,
                    }}
                  />
                  <div
                    className="swell-arrow-label"
                    style={{
                      left: `${arrowData.bodyStart + arrowData.length + 10}px`,
                      transform: `translate(0, -50%) rotate(${-arrowData.rotation}deg)`
                    }}
                  >
                    {currentData.wave_height_ft?.toFixed(1)}ft
                  </div>
                </div>
              );
            })()}

            {/* Wind Arrow */}
            {(() => {
              if (!currentData) return null;

              const windDirection = currentData.wind_direction;
              const windSpeed = currentData.wind_speed_mph;

              // Don't show wind arrow if no data available or wind < 1mph
              if (!windDirection || !windSpeed || windSpeed < 1) return null;

              // TODO: Calculate actual max from 180hr forecast data
              const windData = getWindArrowData(
                windDirection,
                windSpeed,
                40 // maxWindSpeed - will be dynamic with timeline
              );

              if (!windData) return null;

              // Get color based on wind speed (matches homepage wind overlay)
              const windColor = getWindSpeedColor(windSpeed);

              return (
                <div
                  className="wind-arrow-container"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) rotate(${windData.rotation}deg)`,
                    '--wind-color': windColor,
                  }}
                >
                  {/* Arrow head at innerRadius */}
                  <div
                    className="wind-arrow-head"
                    style={{
                      position: 'absolute',
                      left: `${windData.innerRadius}px`,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  />
                  {/* Arrow body starts at back of arrow head */}
                  <div
                    className="wind-arrow-line"
                    style={{
                      width: `${windData.length}px`,
                      left: `${windData.bodyStart}px`,
                    }}
                  />
                  <div
                    className="wind-arrow-label"
                    style={{
                      left: `${windData.bodyStart + windData.length + 10}px`,
                      transform: `translate(0, -50%) rotate(${-windData.rotation}deg)`
                    }}
                  >
                    {currentData.wind_speed_mph?.toFixed(0)}mph
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Forecast Timeline Slider */}
      {timelineLoading ? (
        <div className="timeline-section">
          <div className="timeline-header">
            <h3>Forecast Timeline</h3>
          </div>
          <SkeletonLoader height="120px" className="timeline-skeleton" />
        </div>
      ) : forecastTimeline && forecastTimeline.timeline && forecastTimeline.timeline.length > 0 ? (
        <div className="timeline-section">
          <div className="timeline-header">
            <h3>Forecast Timeline</h3>
            <div className="timeline-time">
              {selectedHour === 0 ? (
                <span className="current-badge">Current Conditions</span>
              ) : (
                <>
                  <span className="forecast-badge">
                    +{selectedHour}hrs ({new Date(Date.now() + selectedHour * 3600000).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })})
                  </span>
                  {currentData && !currentData.wind_direction && (
                    <span style={{marginLeft: '8px', fontSize: '12px', color: '#64748b'}}>
                      (Wind forecast unavailable)
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="timeline-slider-container">
            <input
              type="range"
              min="0"
              max="48"
              step="6"
              value={selectedHour}
              onChange={(e) => setSelectedHour(parseInt(e.target.value))}
              className="timeline-slider"
            />
            <div className="timeline-labels">
              <span>Now</span>
              <span>12h</span>
              <span>24h</span>
              <span>36h</span>
              <span>48h</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Current Conditions Card */}
      <div className="conditions-section">
        <div className="section-header">
          <h2>
            {selectedHour === 0 ? 'Current Conditions' : `Forecast Conditions (+${selectedHour}hrs)`}
          </h2>
          {selectedHour === 0 && conditions?.timestamp && (
            <span className="timestamp">
              Last Updated: {new Date(conditions.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {selectedHour > 0 && (
            <span className="timestamp">
              {new Date(Date.now() + selectedHour * 3600000).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          )}
        </div>

        {(conditions || currentData) && (
          <div className="score-card">
            {selectedHour === 0 && (
              <div className="score-main" style={{ color: scoreColor }}>
                <div className="score-value">{conditions.emoji} {score}/10</div>
                <div className="score-rating">{conditions.rating}</div>
              </div>
            )}
            {selectedHour > 0 && (
              <div className="score-main" style={{ color: '#64748b' }}>
                <div className="score-value">📊 Forecast</div>
                <div className="score-rating">Model Data</div>
              </div>
            )}

            <div className="conditions-summary">
              <div className="condition-item">
                <span className="icon">📏</span>
                <span className="label">Height:</span>
                <span className="value">
                  {(() => {
                    const height = currentData?.wave_height_ft || conditions?.adjusted_height_ft;
                    if (height !== null && height !== undefined) {
                      return typeof height === 'number' ? height.toFixed(1) : height;
                    }
                    return '--';
                  })()} ft
                </span>
              </div>
              <div className="condition-item">
                <span className="icon">🏄</span>
                <span className="label">Surf Height:</span>
                <span className="value">
                  {(() => {
                    const surfHeight = currentData?.surf_height_ft;
                    if (surfHeight !== null && surfHeight !== undefined) {
                      return typeof surfHeight === 'number' ? surfHeight.toFixed(1) : surfHeight;
                    }
                    return '--';
                  })()} ft
                </span>
              </div>
              <div className="condition-item">
                <span className="icon">⏱️</span>
                <span className="label">Period:</span>
                <span className="value">
                  {(() => {
                    const period = currentData?.wave_period;
                    if (period !== null && period !== undefined) {
                      return typeof period === 'number' ? period.toFixed(1) : period;
                    }
                    return '--';
                  })()} s
                </span>
              </div>
              <div className="condition-item">
                <span className="icon">🧭</span>
                <span className="label">Swell:</span>
                <span className="value">
                  {(() => {
                    const dir = currentData?.wave_direction || conditions?.swell_direction;
                    if (dir !== null && dir !== undefined) {
                      return typeof dir === 'number' ? Math.round(dir) : dir;
                    }
                    return '--';
                  })()}°
                </span>
              </div>

              <div className="condition-item">
                <span className="icon">💨</span>
                <span className="label">Wind:</span>
                <span className="value">
                  {(() => {
                    const windSpeed = currentData?.wind_speed_mph;
                    const windDir = currentData?.wind_direction;

                    if (windSpeed !== null && windSpeed !== undefined) {
                      const speedStr = typeof windSpeed === 'number' ? Math.round(windSpeed) : windSpeed;
                      const dirStr = windDir !== null && windDir !== undefined
                        ? (typeof windDir === 'number' ? Math.round(windDir) : windDir)
                        : '--';
                      return `${speedStr} mph @ ${dirStr}°`;
                    }
                    return '--';
                  })()}
                </span>
              </div>
            </div>

            {/* Score Breakdown - only show for current conditions */}
            {selectedHour === 0 && (
              <div className="score-breakdown">
                <h3>Score Breakdown:</h3>
                <ScoreBar
                  label="Swell Direction"
                  score={conditions.swell_direction_score}
                  max={3}
                />
                <ScoreBar
                  label="Swell Size"
                  score={conditions.swell_size_score}
                  max={3}
                />
                <ScoreBar
                  label="Wind Direction"
                  score={conditions.wind_direction_score}
                  max={2}
                />
                <ScoreBar
                  label="Wind Speed"
                  score={conditions.wind_speed_score}
                  max={2}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spot Information */}
      <div className="info-section">
        <h2>Spot Information</h2>

        {!isEditMode ? (
          <>
            <div className="info-grid">
              {characteristics.break_type && (
                <InfoRow icon="🌊" label="Break Type" value={characteristics.break_type} />
              )}
              {characteristics.bottom_type && (
                <InfoRow icon="🪨" label="Bottom" value={characteristics.bottom_type} />
              )}
              {characteristics.wave_quality && (
                <InfoRow icon="⭐" label="Wave Quality" value={characteristics.wave_quality.replace(/_/g, ' ')} />
              )}
              {characteristics.skill_level && (
                <InfoRow icon="🎯" label="Skill Level" value={characteristics.skill_level} />
              )}
              {characteristics.best_swell_direction && (
                <InfoRow icon="📐" label="Best Swell" value={characteristics.best_swell_direction} />
              )}
              {characteristics.best_wind_direction && (
                <InfoRow icon="💨" label="Best Wind" value={characteristics.best_wind_direction} />
              )}
              {characteristics.tide_position && (
                <InfoRow icon="🌊" label="Best Tide" value={characteristics.tide_position} />
              )}
              {characteristics.works_from_swell_ft && characteristics.works_to_swell_ft && (
                <InfoRow
                  icon="📏"
                  label="Works"
                  value={`${characteristics.works_from_swell_ft}-${characteristics.works_to_swell_ft} ft`}
                />
              )}
              {characteristics.hazards && characteristics.hazards.length > 0 && (
                <InfoRow
                  icon="⚠️"
                  label="Hazards"
                  value={characteristics.hazards.join(', ')}
                />
              )}
            </div>

            {/* Location Info */}
            {(spot.location_description || spot.access_description || spot.parking_info) && (
              <div className="location-info">
                {spot.location_description && (
                  <div className="location-item">
                    <strong>📍 Location:</strong> {spot.location_description}
                  </div>
                )}
                {spot.access_description && (
                  <div className="location-item">
                    <strong>🚶 Access:</strong> {spot.access_description}
                  </div>
                )}
                {spot.parking_info && (
                  <div className="location-item">
                    <strong>🅿️ Parking:</strong> {spot.parking_info}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="edit-form">
            <div className="form-section">
              <h3>Basic Info</h3>
              <FormField
                label="Spot Name"
                value={editedSpot.name}
                onChange={(value) => setEditedSpot({...editedSpot, name: value})}
                required
              />
              <FormField
                label="Region"
                value={editedSpot.region}
                onChange={(value) => setEditedSpot({...editedSpot, region: value})}
                required
              />
              <FormField
                label="Subregion"
                value={editedSpot.subregion}
                onChange={(value) => setEditedSpot({...editedSpot, subregion: value})}
              />
            </div>

            <div className="form-section">
              <h3>Characteristics</h3>
              <FormSelect
                label="Break Type"
                value={editedSpot.break_type}
                onChange={(value) => setEditedSpot({...editedSpot, break_type: value})}
                options={['beach', 'reef', 'point', 'river_mouth', 'jetty', 'mixed']}
              />
              <FormSelect
                label="Bottom Type"
                value={editedSpot.bottom_type}
                onChange={(value) => setEditedSpot({...editedSpot, bottom_type: value})}
                options={['sand', 'rock', 'reef', 'cobblestone', 'mixed']}
              />
              <FormSelect
                label="Wave Quality"
                value={editedSpot.wave_quality}
                onChange={(value) => setEditedSpot({...editedSpot, wave_quality: value})}
                options={['world_class', 'regional_classic', 'good', 'fun']}
              />
              <FormSelect
                label="Skill Level"
                value={editedSpot.skill_level}
                onChange={(value) => setEditedSpot({...editedSpot, skill_level: value})}
                options={['beginner', 'intermediate', 'experienced', 'expert', 'pros_only']}
                required
              />
            </div>

            <div className="form-section">
              <h3>Conditions</h3>
              <FormField
                label="Best Swell Direction"
                value={editedSpot.best_swell_direction}
                onChange={(value) => setEditedSpot({...editedSpot, best_swell_direction: value})}
                placeholder="e.g., NW, W, SW"
              />
              <FormField
                label="Best Wind Direction"
                value={editedSpot.best_wind_direction}
                onChange={(value) => setEditedSpot({...editedSpot, best_wind_direction: value})}
                placeholder="e.g., E, NE"
              />
              <FormField
                label="Tide Position"
                value={editedSpot.tide_position}
                onChange={(value) => setEditedSpot({...editedSpot, tide_position: value})}
                placeholder="e.g., low, mid, high, all"
              />
              <div className="form-row">
                <FormField
                  label="Works From (ft)"
                  type="number"
                  value={editedSpot.works_from_swell_ft}
                  onChange={(value) => setEditedSpot({...editedSpot, works_from_swell_ft: parseFloat(value) || ''})}
                />
                <FormField
                  label="Works To (ft)"
                  type="number"
                  value={editedSpot.works_to_swell_ft}
                  onChange={(value) => setEditedSpot({...editedSpot, works_to_swell_ft: parseFloat(value) || ''})}
                />
              </div>
            </div>

            <div className="form-section">
              <h3>Location & Access</h3>
              <FormTextarea
                label="Location Description"
                value={editedSpot.location_description}
                onChange={(value) => setEditedSpot({...editedSpot, location_description: value})}
                rows={3}
              />
              <FormTextarea
                label="Access Description"
                value={editedSpot.access_description}
                onChange={(value) => setEditedSpot({...editedSpot, access_description: value})}
                rows={3}
              />
              <FormTextarea
                label="Parking Info"
                value={editedSpot.parking_info}
                onChange={(value) => setEditedSpot({...editedSpot, parking_info: value})}
                rows={2}
              />
            </div>
          </div>
        )}
      </div>

      {/* AI Spot Analysis */}
      <div className="ai-analysis-section">
        <AISpotAnalysis
          spotSlug={slug}
          spotName={spot.name}
        />
      </div>

      {/* Model Forecast Data */}
      {modelLoading ? (
        <div className="buoy-sources-section">
          <h2>Model Forecast Data</h2>
          <SkeletonLoader height="150px" />
        </div>
      ) : modelForecast?.models ? (
        <div className="buoy-sources-section">
          <h2>Model Forecast Data</h2>
          <div className="buoy-list">
            {/* WaveWatch III (WW3) */}
            {modelForecast.models.ww3 && !modelForecast.models.ww3.error && (
              <div className="buoy-item-row">
                <div className="buoy-header">
                  <span className="buoy-id">WW3</span>
                  <span className="buoy-name">{modelForecast.models.ww3.model}</span>
                  <span className="buoy-role">({modelForecast.models.ww3.resolution})</span>
                </div>
                <div className="buoy-data">
                  {modelForecast.models.ww3.wave_height_ft !== null && (
                    <span className="buoy-data-item">
                      📏 {modelForecast.models.ww3.wave_height_ft.toFixed(1)}ft
                    </span>
                  )}
                  {modelForecast.models.ww3.period_sec !== null && (
                    <span className="buoy-data-item">
                      ⏱️ {modelForecast.models.ww3.period_sec.toFixed(1)}s
                    </span>
                  )}
                  {modelForecast.models.ww3.direction !== null && (
                    <span className="buoy-data-item">
                      🧭 {modelForecast.models.ww3.direction}°
                    </span>
                  )}
                  <span className="buoy-data-item" style={{color: '#94a3b8'}}>
                    ~{modelForecast.models.ww3.grid_distance_km.toFixed(0)}km from spot
                  </span>
                </div>
              </div>
            )}

            {/* HRRR Wind */}
            {modelForecast.models.hrrr && !modelForecast.models.hrrr.error && (
              <div className="buoy-item-row">
                <div className="buoy-header">
                  <span className="buoy-id">HRRR</span>
                  <span className="buoy-name">{modelForecast.models.hrrr.model}</span>
                  <span className="buoy-role">({modelForecast.models.hrrr.resolution})</span>
                </div>
                <div className="buoy-data">
                  {modelForecast.models.hrrr.wind_speed_mph !== null && (
                    <span className="buoy-data-item">
                      💨 {modelForecast.models.hrrr.wind_speed_mph.toFixed(0)}mph
                    </span>
                  )}
                  {modelForecast.models.hrrr.wind_direction !== null && (
                    <span className="buoy-data-item">
                      @ {modelForecast.models.hrrr.wind_direction}°
                    </span>
                  )}
                  <span className="buoy-data-item" style={{color: '#94a3b8'}}>
                    ~{modelForecast.models.hrrr.grid_distance_km.toFixed(0)}km from spot
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="buoy-note">
            Model data represents forecasted conditions from NOAA models (nowcast). Buoy data below shows actual observations.
          </div>
        </div>
      ) : null}

      {/* Buoy Data Sources */}
      {buoyLoading ? (
        <div className="buoy-sources-section">
          <h2>Buoy Observations</h2>
          <SkeletonLoader height="200px" />
        </div>
      ) : conditions?.buoys_used && conditions.buoys_used.length > 0 ? (
        <div className="buoy-sources-section">
          <h2>Buoy Observations</h2>
          <div className="buoy-list">
            {conditions.buoys_used.map((buoy, idx) => {
              const buoyId = buoy.id || buoy;
              const buoyInfo = buoyData[buoyId];

              return (
                <div key={buoyId || idx} className="buoy-item-row">
                  <div className="buoy-header">
                    <span className="buoy-id">{buoyId}</span>
                    {buoyInfo?.name && (
                      <span className="buoy-name">{buoyInfo.name}</span>
                    )}
                    {buoy.weight && (
                      <span className="buoy-weight">{(buoy.weight * 100).toFixed(0)}%</span>
                    )}
                    {buoy.role && (
                      <span className="buoy-role">({buoy.role})</span>
                    )}
                  </div>

                  {buoyInfo && (
                    <div className="buoy-data">
                      {buoyInfo.wave_height_m !== null && (
                        <span className="buoy-data-item">
                          📏 {(buoyInfo.wave_height_m * 3.28084).toFixed(1)}ft
                        </span>
                      )}
                      {buoyInfo.dominant_period_sec !== null && (
                        <span className="buoy-data-item">
                          ⏱️ {buoyInfo.dominant_period_sec?.toFixed(1)}s
                        </span>
                      )}
                      {buoyInfo.mean_wave_dir !== null && (
                        <span className="buoy-data-item">
                          🧭 {buoyInfo.mean_wave_dir}°
                        </span>
                      )}
                      {buoyInfo.wind_speed_ms !== null && (
                        <span className="buoy-data-item">
                          💨 {(buoyInfo.wind_speed_ms * 2.23694).toFixed(0)}mph
                        </span>
                      )}
                      {buoyInfo.wind_direction !== null && buoyInfo.wind_speed_ms !== null && (
                        <span className="buoy-data-item">
                          @ {buoyInfo.wind_direction}°
                        </span>
                      )}
                      {buoyInfo.water_temp_c !== null && (
                        <span className="buoy-data-item">
                          🌡️ {((buoyInfo.water_temp_c * 9/5) + 32).toFixed(1)}°F
                        </span>
                      )}
                    </div>
                  )}

                  {!buoyInfo && (
                    <div className="buoy-data">
                      <span className="buoy-data-item" style={{color: '#94a3b8'}}>
                        No data available
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

// Helper component for score bars
const ScoreBar = ({ label, score, max }) => {
  const percentage = (score / max) * 100;
  const color = percentage >= 70 ? '#22c55e' : percentage >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="score-bar-container">
      <div className="score-bar-header">
        <span className="score-bar-label">{label}</span>
        <span className="score-bar-value">{score?.toFixed(1) || '0.0'}/{max}</span>
      </div>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{
            width: `${percentage}%`,
            backgroundColor: color
          }}
        />
      </div>
    </div>
  );
};

// Helper component for info rows
const InfoRow = ({ icon, label, value }) => (
  <div className="info-row">
    <span className="info-icon">{icon}</span>
    <span className="info-label">{label}:</span>
    <span className="info-value">{value}</span>
  </div>
);

// Form helper components
const FormField = ({ label, value, onChange, type = 'text', placeholder = '', required = false }) => (
  <div className="form-field">
    <label className="form-label">
      {label}
      {required && <span className="required">*</span>}
    </label>
    <input
      type={type}
      className="form-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
    />
  </div>
);

const FormSelect = ({ label, value, onChange, options, required = false }) => (
  <div className="form-field">
    <label className="form-label">
      {label}
      {required && <span className="required">*</span>}
    </label>
    <select
      className="form-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    >
      <option value="">-- Select --</option>
      {options.map(opt => (
        <option key={opt} value={opt}>
          {opt.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </option>
      ))}
    </select>
  </div>
);

const FormTextarea = ({ label, value, onChange, rows = 3, placeholder = '' }) => (
  <div className="form-field">
    <label className="form-label">{label}</label>
    <textarea
      className="form-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
    />
  </div>
);

export default SpotDetail;