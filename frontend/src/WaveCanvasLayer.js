import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import WaveField from './WaveField';
import landMask from './LandMask';

/**
 * Improved land/water detection using coastline approximation
 * Uses a more accurate coastline approximation for California and Baja
 * 
 * Strategy: Only block clearly inland areas. Be less aggressive to avoid blocking valid ocean data.
 * For production, this should use a proper GeoJSON land polygon from Natural Earth (10m or 50m).
 */
function isLikelyLand(lat, lon) {
  // California and Baja California coastline approximation
  // Be LESS aggressive - only block clearly inland areas to avoid blocking valid ocean data
  
  // California (32°N to 42°N)
  if (lat >= 32 && lat <= 42 && lon >= -125 && lon <= -117) {
    // More accurate coastline: varies by latitude
    // Northern CA (42°N): coast around -124.5°
    // Central CA (37°N): coast around -122.5°
    // Southern CA (32°N): coast around -117.5°
    const coastLon = -124.5 + (lat - 42) * 0.7; // Coastline approximation
    // More aggressive buffer: block if east of coast (0.15° = ~17km) to prevent bleeding onto land
    if (lon > coastLon + 0.15) {
      return true; // Likely on land
    }
  }
  
  // Baja California (23°N to 32°N)
  if (lat >= 23 && lat < 32 && lon >= -118 && lon <= -110) {
    // Baja coastline: roughly follows -115° to -113° longitude
    const coastLon = -115 + (lat - 32) * 0.2;
    // More aggressive buffer: block if east of coast (0.15° = ~17km) to prevent bleeding
    if (lon > coastLon + 0.15) {
      return true; // Likely on land
    }
  }
  
  // Be very conservative for other areas - only mark as land if clearly inland
  // For ocean areas far from known coastlines, assume water
  return false;
}

/**
 * Check if a point is clearly over water (not near land boundary)
 * Used to determine if we should fill NaN gaps (only fill over water)
 * Made less restrictive to fill more gaps near shore
 */
function isClearlyOverWater(lat, lon) {
  // If we're clearly on land, we're not over water
  if (isLikelyLand(lat, lon)) {
    return false;
  }
  
  // More restrictive: only allow filling if we're clearly over water (west of coast)
  // This prevents filling gaps that are actually on land
  if (lat >= 32 && lat <= 42 && lon >= -125 && lon <= -117) {
    const coastLon = -124.5 + (lat - 42) * 0.7;
    const distFromCoast = lon - coastLon;
    // Only allow filling if we're west of the coast (negative distance = west)
    // Add a small buffer (0.05° = ~5.5km) to account for coastline approximation error
    if (distFromCoast > -0.05) {
      // Too close to or east of coast - don't fill (likely on land)
      return false;
    }
  }
  
  // For Baja California
  if (lat >= 23 && lat < 32 && lon >= -118 && lon <= -110) {
    const coastLon = -115 + (lat - 32) * 0.2;
    const distFromCoast = lon - coastLon;
    if (distFromCoast > -0.05) {
      return false;
    }
  }
  
  return true;
}

// Wave height color scale - match Windy.com: darker ocean with lower transparency
// Windy.com uses lower opacity (~40-45%) for realistic ocean feel with dark navy at low heights
const ALPHA_BASE = 0.45; // Base overlay transparency (lower for ocean feel)
const MIN_ALPHA = 0.10; // Minimum alpha for very low waves (dark ocean)
const GAMMA = 0.70; // Gamma boost for mid values (slightly higher for smoother progression)

// Task W1: Hard debug mode flag (set to true to test 3-band palette)
const DEBUG_HARD_COLORS = false; // Set to true for 3-band test

// Task W7: Debug view to detect stripe bug vs stride artifact
const DEBUG_VIEW = false; // Set to 'lat', 'lng', or false to test gradient patterns

// Debug toggle to prove it's rendering vs data
const DEBUG_GRAYSCALE = false; // Set to true to render as grayscale

/**
 * Get wave height color with vivid mode (gamma boost + minimum alpha)
 * Wave heights in meters, but we'll convert to feet for display if needed
 * Task S5: Non-linear scaling for better low-value visibility
 * Task W1: Hard debug mode for testing
 * Task W3: Windy-ish palette with non-linear scaling
 */
function getWaveHeightColor(hsMeters, alphaBase = ALPHA_BASE, units = 'imperial') {
  // Guard against invalid values
  if (hsMeters === null || hsMeters === undefined || Number.isNaN(hsMeters) || !Number.isFinite(hsMeters)) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Task W1: Hard debug mode - 3-band palette
  if (DEBUG_HARD_COLORS) {
    const debugAlpha = 0.85; // High alpha for visibility
    if (hsMeters < 2) {
      return { r: 0, g: 0, b: 200, a: debugAlpha }; // Deep blue
    } else if (hsMeters < 3) {
      return { r: 0, g: 200, b: 0, a: debugAlpha }; // Green
    } else {
      return { r: 200, g: 0, b: 0, a: debugAlpha }; // Red
    }
  }

  // Task W9: Convert to feet early and use Windy-style palette
  const hsFt = Math.max(0, hsMeters * 3.28084); // Convert meters to feet
  
  // Debug: Log color mapping (first few calls only) - moved to end of function
  
  // Debug: Log color mapping (first few calls only)
  if (!window.__waveColorDebug) {
    window.__waveColorDebug = { count: 0 };
  }
  if (window.__waveColorDebug.count < 5) {
    window.__waveColorDebug.count++;
    console.log('🌊 Color mapping:', { hsMeters, hsFt, color: 'will be calculated' });
  }

  // Windy.com vibrant waves palette: deep purple → magenta → pink → blue → cyan → yellow → orange → red
  // MUST match WaveHeightLegend.js color stops exactly (converted from meters to feet)
  // Purple/magenta dominant for better visibility and matches Windy.com exactly
  const colorStops = [
    [0,   60,  0,   120, 1.0],  // 0ft (0m): Deep purple (calm)
    [2,   100, 0,   180, 1.0],  // 2ft (0.6m): Purple
    [4,   180, 0,   200, 1.0],  // 4ft (1.2m): Magenta
    [6,   220, 0,   180, 1.0],  // 6ft (1.8m): Pink/magenta
    [8,   150, 50,  255, 1.0],  // 8ft (2.4m): Purple-blue
    [10,  50,  150, 255, 1.0],  // 10ft (3.0m): Blue
    [12,  0,   200, 255, 1.0],  // 12ft (3.7m): Cyan
    [15,  255, 255, 0,   1.0],  // 15ft (4.6m): Yellow
    [18,  255, 100, 0,   1.0],  // 18ft (5.5m): Orange
    [22,  255, 0,   0,   1.0]   // 22ft (6.7m): Red (massive waves)
  ];

  // Find which two stops to interpolate between
  let lowerStop = colorStops[0];
  let upperStop = colorStops[colorStops.length - 1];

  for (let i = 0; i < colorStops.length - 1; i++) {
    if (hsFt >= colorStops[i][0] && hsFt <= colorStops[i + 1][0]) {
      lowerStop = colorStops[i];
      upperStop = colorStops[i + 1];
      break;
    }
  }

  // Interpolate between stops
  const stopRange = upperStop[0] - lowerStop[0];
  const localT = stopRange > 0 ? (hsFt - lowerStop[0]) / stopRange : 0;
  const clampedT = Math.max(0, Math.min(1, localT));
  
  // Task W9: Apply gamma so low-mid pops (non-linear scaling)
  const tg = Math.pow(clampedT, 0.65);
  
  // Interpolate colors using gamma-corrected t
  const r = Math.round(lowerStop[1] + tg * (upperStop[1] - lowerStop[1]));
  const g = Math.round(lowerStop[2] + tg * (upperStop[2] - lowerStop[2]));
  const b = Math.round(lowerStop[3] + tg * (upperStop[3] - lowerStop[3]));
  
  // Debug: Log color result (first few calls only) - show actual values
  if (!window.__waveColorDebug) {
    window.__waveColorDebug = { count: 0 };
  }
  if (window.__waveColorDebug.count < 3) {
    window.__waveColorDebug.count++;
    console.log('🌊 Color result:', 
      `hsMeters=${hsMeters?.toFixed(2)}m`, 
      `hsFt=${hsFt.toFixed(1)}ft`,
      `RGB(${r},${g},${b})`,
      `stops[${lowerStop[0]}ft-${upperStop[0]}ft]`,
      `t=${localT?.toFixed(2)}`
    );
  }
  
  // Match Windy.com: darker ocean feel with lower transparency at low heights
  // Lower waves = more transparent (dark navy barely visible)
  // Higher waves = more opaque (bright colors stand out)
  const heightNorm = Math.min(hsFt / 20, 1); // Normalize to 0-20ft range
  const alphaBoost = Math.pow(heightNorm, 0.8); // Non-linear: low waves very transparent
  const baseAlpha = MIN_ALPHA + (alphaBase - MIN_ALPHA) * alphaBoost;
  const a = Math.max(MIN_ALPHA, baseAlpha); // Ensure minimum alpha

  return { r, g, b, a };
}

const WaveCanvasLayer = ({ waveData, visible, units = 'imperial' }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const waveFieldRef = useRef(null);
  const redrawRequestedRef = useRef(false);

  // PERFORMANCE: Cancellation flag to stop stale renders
  const renderCancelledRef = useRef(false);

  // Load GeoJSON land polygons on mount (once)
  // When loaded, request a single redraw (not a full component re-render)
  useEffect(() => {
    landMask.load().then(() => {
      console.log('✅ Land mask ready');
      redrawRequestedRef.current = true; // Signal that redraw is needed
    }).catch(err => {
      console.warn('⚠️ Land mask failed to load, using fallback:', err);
      redrawRequestedRef.current = true; // Continue anyway (will use empty mask)
    });
  }, []);

  useEffect(() => {
    // PERFORMANCE: Reset cancellation flag for this render
    renderCancelledRef.current = false;

    if (!visible || !waveData || !waveData.vectors || waveData.vectors.length === 0) {
      // Clean up canvas if not visible
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      waveFieldRef.current = null;
      return;
    }

    // Build WaveField from vectors
    waveFieldRef.current = new WaveField(waveData.vectors);
    if (!waveFieldRef.current.valid) {
      console.warn('WaveField invalid, cannot render heatmap');
      return;
    }
    
    // Log debug stats (Task S3)
    const stats = waveFieldRef.current.debugStats();
    console.log('🌊 WaveField stats:', stats);
    
    // Debug: Check if data bounds cover map bounds
    if (stats.valid) {
      const mapBounds = map.getBounds();
      const dataBounds = stats.bounds;
      const mapWidth = mapBounds.getEast() - mapBounds.getWest();
      const mapHeight = mapBounds.getNorth() - mapBounds.getSouth();
      const dataWidth = dataBounds.maxLon - dataBounds.minLon;
      const dataHeight = dataBounds.maxLat - dataBounds.minLat;
      
      const coverageX = (dataWidth / mapWidth) * 100;
      const coverageY = (dataHeight / mapHeight) * 100;
      
      if (coverageX < 80 || coverageY < 80) {
        console.warn(`🌊 Data bounds (${dataWidth.toFixed(2)}° x ${dataHeight.toFixed(2)}°) don't fully cover map bounds (${mapWidth.toFixed(2)}° x ${mapHeight.toFixed(2)}°). Coverage: ${coverageX.toFixed(1)}% x ${coverageY.toFixed(1)}%`);
        console.warn(`🌊 Data bounds: ${dataBounds.minLat.toFixed(2)},${dataBounds.minLon.toFixed(2)} to ${dataBounds.maxLat.toFixed(2)},${dataBounds.maxLon.toFixed(2)}`);
        console.warn(`🌊 Map bounds: ${mapBounds.getSouth().toFixed(2)},${mapBounds.getWest().toFixed(2)} to ${mapBounds.getNorth().toFixed(2)},${mapBounds.getEast().toFixed(2)}`);
      }
    }

    // Use Leaflet's tile-pane (like Windy.com) - this ensures proper layering with labels
    // Windy.com structure: tile-pane (200) contains basemap (20), overlay (10), labels in marker-pane (600)
    const tilePane = map.getPane('tilePane') || map.getContainer().querySelector('.leaflet-tile-pane');
    if (!tilePane) {
      console.warn('🌊 Tile pane not found, falling back to map container');
      return;
    }
    
    let canvas = canvasRef.current;

    // Create canvas if it doesn't exist
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wave-heatmap-canvas';
      canvas.className = 'leaflet-layer wave-overlay-layer';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '25'; // Within tile-pane: above basemap (20) so waves render on top with transparency
      canvas.style.background = 'transparent';
      canvas.style.opacity = '1';
      canvas.style.transition = 'opacity 0.2s ease-in-out'; // Smooth fade during zoom transitions
      tilePane.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('Failed to get canvas context');
      return;
    }

    // Match wind layer: ensure canvas context is default (no global alpha/compositing interference)
    ctx.globalCompositeOperation = 'source-over';
    
    // Enable image smoothing for smoother appearance
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Resize canvas to map size
    function resizeCanvas() {
      if (!canvasRef.current) return;
      const size = map.getSize();
      if (!size || size.x === 0 || size.y === 0) {
        console.warn('🌊 Cannot resize canvas: invalid map size', size);
        return;
      }
      // Only resize if size actually changed (avoids unnecessary redraws)
      if (canvas.width !== size.x || canvas.height !== size.y) {
        canvas.width = size.x;
        canvas.height = size.y;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
        console.log(`🌊 Canvas resized to ${size.x}x${size.y} (zoom=${map.getZoom()})`);
      }
    }

    resizeCanvas();

    /**
     * Draw smooth heatmap using offscreen canvas for better definition
     * Low-res sampling → scaled up with smoothing = clearer gradients, less muddy wash
     */
    function drawHeatmap() {
      // PERFORMANCE: Track render time for optimization
      const renderStartTime = performance.now();

      // PERFORMANCE: Check if render was cancelled before starting
      if (renderCancelledRef.current) {
        console.log('🚫 Wave render cancelled before start');
        return;
      }

      if (!canvasRef.current || !waveFieldRef.current || !waveFieldRef.current.valid) {
        console.warn('🌊 Cannot draw: canvas or waveField invalid');
        return;
      }
      
      // Get canvas context (may need to re-get if canvas was recreated)
      const drawCtx = canvasRef.current.getContext('2d');
      if (!drawCtx) {
        console.warn('🌊 Cannot draw: no canvas context');
        return;
      }
      if (!waveFieldRef.current || !waveFieldRef.current.valid) {
        console.warn('🌊 Cannot draw: waveField invalid');
        return;
      }

      const size = map.getSize();
      // Guard: ensure map has valid size before drawing
      if (!size || size.x === 0 || size.y === 0) {
        console.warn('🌊 Map size not ready, skipping draw');
        return;
      }
      
      // Ensure canvas size matches map size (in case resizeCanvas wasn't called)
      if (canvasRef.current.width !== size.x || canvasRef.current.height !== size.y) {
        resizeCanvas();
      }
      
      const zoom = map.getZoom();
      console.log(`🌊 Drawing wave heatmap: size=${size.x}x${size.y}, zoom=${zoom}`);
      
      // Get actual data range for color normalization
      const stats = waveFieldRef.current.debugStats();
      const dataMinHs = stats.minHs;
      const dataMaxHs = stats.maxHs;
      
      // PERFORMANCE: Aggressive resolution scaling based on zoom level
      // At low zoom (zoomed out), render at much lower resolution and upscale
      // This prevents processing millions of pixels when showing large areas
      // Trade-off: Slight quality loss at low zoom vs 10-20x performance gain
      let scale;
      if (zoom < 6) {
        scale = 4; // 1/16th pixels - very aggressive for continental view
      } else if (zoom < 8) {
        scale = 3; // 1/9th pixels - aggressive for regional view
      } else if (zoom < 10) {
        scale = 2; // 1/4 pixels - moderate for state view
      } else {
        scale = 1; // Full resolution for local/coastal view
      }

      let offWidth = Math.ceil(size.x / scale);
      let offHeight = Math.ceil(size.y / scale);

      // PERFORMANCE: Render budget cap - prevent any single frame from taking too long
      // Cap at 100k samples max per frame (typically renders in <100ms)
      const MAX_SAMPLES = 100000;
      const totalSamples = offWidth * offHeight;

      if (totalSamples > MAX_SAMPLES) {
        // Increase scale factor to reduce samples below cap
        const additionalScaling = Math.ceil(Math.sqrt(totalSamples / MAX_SAMPLES));
        scale *= additionalScaling;
        offWidth = Math.ceil(size.x / scale);
        offHeight = Math.ceil(size.y / scale);
        console.warn(`⚠️ Render budget cap: ${totalSamples.toLocaleString()} -> ${(offWidth * offHeight).toLocaleString()} samples (scale=${scale})`);
      }

      // Add more padding to sample well beyond edges for smoother boundary coverage
      const edgePadding = 4; // Sample 4 pixels beyond edges for better fill-in
      const paddedOffWidth = offWidth + edgePadding * 2;
      const paddedOffHeight = offHeight + edgePadding * 2;

      // Create or reuse offscreen canvas at lower resolution (with padding for edge coverage)
      let offscreenCanvas = offscreenCanvasRef.current;
      
      if (!offscreenCanvas || offscreenCanvas.width !== paddedOffWidth || offscreenCanvas.height !== paddedOffHeight) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = paddedOffWidth;
        offscreenCanvas.height = paddedOffHeight;
        offscreenCanvasRef.current = offscreenCanvas;
        console.log(`🌊 Created offscreen canvas: ${paddedOffWidth}x${paddedOffHeight} (scale=${scale}, padding=${edgePadding})`);
      }
      
      const offCtx = offscreenCanvas.getContext('2d');
      // Clear offscreen canvas before drawing
      offCtx.clearRect(0, 0, paddedOffWidth, paddedOffHeight);
      
      // Create ImageData for offscreen canvas (one pixel per sample, with padding)
      const offImageData = offCtx.createImageData(paddedOffWidth, paddedOffHeight);
      const offData = offImageData.data;

      // Task S4: Debug logging (one-time)
      if (!window.__waveDebugOnce) {
        window.__waveDebugOnce = true;
        const center = map.getCenter();
        const centerHs = waveFieldRef.current.getHs(center.lat, center.lng);
        console.log('🌊 Wave sample @center:', { lat: center.lat, lng: center.lng, hs: centerHs });
      }
      
      // Task S7: Track sample points for debug dots
      const debugSamplePoints = [];
      let filledCount = 0;
      let processedSamples = 0;
      
      // Edge detection: identify edge regions that need extra sampling
      // Near edges (within 10% of width/height), sample at higher density
      const edgeThreshold = Math.max(offWidth, offHeight) * 0.1;
      
      // Sample at scale intervals - one pixel per sample
      // Write exactly one pixel per offscreen pixel into offImageData
      // Sample at CENTER of each offscreen pixel to avoid corner artifacts
      // Include edge padding to sample beyond map bounds for smoother edge coverage
      // For edge pixels, use finer sampling (every pixel) to match Windy.com coverage
      for (let paddedY = 0; paddedY < paddedOffHeight; paddedY++) {
        // PERFORMANCE: Check cancellation every 10 rows to avoid wasting CPU
        if (renderCancelledRef.current && paddedY % 10 === 0) {
          console.log(`🚫 Wave render cancelled mid-draw at row ${paddedY}/${paddedOffHeight}`);
          return;
        }

        for (let paddedX = 0; paddedX < paddedOffWidth; paddedX++) {
          // Convert padded coordinates to logical offscreen coordinates
          // Account for edge padding: sample extends beyond visible bounds
          const offX = paddedX - edgePadding;
          const offY = paddedY - edgePadding;
          
          // Calculate screen position
          // For pixels within visible bounds, sample at center or exact edges
          let screenX = offX * scale + scale / 2;
          let screenY = offY * scale + scale / 2;
          
          // Check if we're in an edge region (near boundaries)
          const isEdgeX = offX >= 0 && offX < offWidth && (offX < edgeThreshold || offX >= offWidth - edgeThreshold);
          const isEdgeY = offY >= 0 && offY < offHeight && (offY < edgeThreshold || offY >= offHeight - edgeThreshold);
          const isEdgeRegion = isEdgeX || isEdgeY;
          
          // For pixels within visible bounds, ensure we sample at exact edges
          // For edge regions, use finer sampling (closer to pixel-perfect)
          if (offX >= 0 && offX < offWidth) {
            if (offX === 0) screenX = 0; // Left edge
            else if (offX === offWidth - 1) screenX = size.x - 1; // Right edge
            else if (isEdgeRegion && scale > 1) {
              // In edge region, sample closer to actual pixel position for better coverage
              screenX = offX * scale; // Use left edge of sample cell instead of center
            }
          }
          if (offY >= 0 && offY < offHeight) {
            if (offY === 0) screenY = 0; // Top edge
            else if (offY === offHeight - 1) screenY = size.y - 1; // Bottom edge
            else if (isEdgeRegion && scale > 1) {
              // In edge region, sample closer to actual pixel position for better coverage
              screenY = offY * scale; // Use top edge of sample cell instead of center
            }
          }
          
          // For edge padding pixels (outside visible bounds), calculate position relative to edge
          // This allows sampling beyond bounds for smoother interpolation
          if (offX < 0) screenX = offX * scale; // Left padding
          if (offX >= offWidth) screenX = size.x + (offX - offWidth + 1) * scale; // Right padding
          if (offY < 0) screenY = offY * scale; // Top padding
          if (offY >= offHeight) screenY = size.y + (offY - offHeight + 1) * scale; // Bottom padding
          
          // Convert pixel to lat/lon (may be outside bounds for edge padding)
          // containerPointToLatLng can handle points slightly outside bounds
          let latLng;
          try {
            latLng = map.containerPointToLatLng([screenX, screenY]);
          } catch (e) {
            // If conversion fails (too far outside), skip this pixel
            const idx = (paddedY * paddedOffWidth + paddedX) * 4;
            offData[idx] = 0;
            offData[idx + 1] = 0;
            offData[idx + 2] = 0;
            offData[idx + 3] = 0;
            continue;
          }
          
          // Land masking disabled for Windy-style edge-to-edge coverage
          // Windy.com renders everywhere and lets data fade naturally via alpha
          // Areas without data will be transparent due to hs === null check below
          
          // Interpolate wave height (hs is in meters from WaveField)
          // Use improved extrapolation method that handles NaN corners intelligently
          // This fills the near-shore band by searching for nearest valid ocean cells
          let hs = waveFieldRef.current.getHs(latLng.lat, latLng.lng);
          
          // If null, try aggressive extrapolation EVERYWHERE for Windy-style coverage
          // Windy.com extrapolates data across the entire viewport, even over land
          // This creates smooth gradients that fade to transparent at edges
          if (hs === null && (offX >= 0 && offX < offWidth && offY >= 0 && offY < offHeight)) {
            // Try extrapolation with very large radius to reach distant data
            // Radius 1.0° = ~111km - aggressive to fill entire viewport
            hs = waveFieldRef.current.getHsWithExtrapolation(latLng.lat, latLng.lng, 1.0, 20);
          }

          processedSamples++;
          const idx = (paddedY * paddedOffWidth + paddedX) * 4;
          
          // Debug: Log first few samples to verify data
          if (!window.__waveSampleDebug) {
            window.__waveSampleDebug = { count: 0 };
          }
          if (window.__waveSampleDebug.count < 3 && hs !== null && hs !== undefined) {
            window.__waveSampleDebug.count++;
            console.log('🌊 Sample:', 
              `lat=${latLng.lat.toFixed(2)}, lng=${latLng.lng.toFixed(2)}, hs=${hs.toFixed(2)}m (${(hs * 3.28084).toFixed(1)}ft)`
            );
          }
          
          // Task W7: Debug view to detect stripe bug vs stride artifact
          let debugHs = hs;
          if (DEBUG_VIEW === 'lat') {
            // Color by latitude gradient only
            const bounds = map.getBounds();
            const latRange = bounds.getNorth() - bounds.getSouth();
            const latNorm = (latLng.lat - bounds.getSouth()) / latRange;
            debugHs = latNorm * 6.0; // Map to 0-6m range for color lookup
          } else if (DEBUG_VIEW === 'lng') {
            // Color by longitude gradient only
            const bounds = map.getBounds();
            const lngRange = bounds.getEast() - bounds.getWest();
            const lngNorm = (latLng.lng - bounds.getWest()) / lngRange;
            debugHs = lngNorm * 6.0; // Map to 0-6m range for color lookup
          }
          
          // Fix chevrons: Only write RGBA when hs != null (don't paint default color)
          // Start with fully transparent ImageData (already initialized to 0)
          if (debugHs !== null && debugHs !== undefined && !Number.isNaN(debugHs)) {
            filledCount++;
            
            // Task: DEBUG_GRAYSCALE to prove it's rendering vs data
            if (DEBUG_GRAYSCALE) {
              // Render hs as grayscale (map minHs..maxHs to 0..255) with constant alpha
              const stats = waveFieldRef.current.debugStats();
              const hsRange = stats.maxHs - stats.minHs;
              const grayValue = hsRange > 0 
                ? Math.round(((debugHs - stats.minHs) / hsRange) * 255)
                : 128;
              offData[idx] = grayValue;     // R
              offData[idx + 1] = grayValue; // G
              offData[idx + 2] = grayValue; // B
              offData[idx + 3] = 255;       // A
            } else {
              // Use actual wave height (no normalization) for absolute color scale
              // A 4ft wave should always be blue, regardless of other waves in view
              // This matches the legend which shows absolute values
              // hs is in meters, getWaveHeightColor converts to feet internally
              const color = getWaveHeightColor(debugHs, ALPHA_BASE, units);
              offData[idx] = color.r;     // R
              offData[idx + 1] = color.g; // G
              offData[idx + 2] = color.b; // B
              // Set pixel alpha directly (alpha already calculated in color function)
              offData[idx + 3] = Math.round(color.a * 255); // A
            }
            
            // Task S7: Collect sample points for debug dots (first 10)
            if (debugSamplePoints.length < 10 && Math.random() < 0.1) {
              debugSamplePoints.push({ lat: latLng.lat, lng: latLng.lng, screenX, screenY, hs });
            }
          } else {
            // Ensure transparent if no data
            offData[idx] = 0;
            offData[idx + 1] = 0;
            offData[idx + 2] = 0;
            offData[idx + 3] = 0;
          }
        }
      }
      
      // Task S4: Log sample coverage
      if (!window.__waveDebugCoverage) {
        window.__waveDebugCoverage = true;
        console.log('🌊 Wave canvas coverage:', {
          filledCount,
          processedSamples,
          coveragePercent: ((filledCount / processedSamples) * 100).toFixed(1) + '%'
        });
      }
      
      // Put ImageData into offscreen canvas
      offCtx.putImageData(offImageData, 0, 0);

      // Aggressive fill-in pass: For any remaining transparent pixels, interpolate from neighbors
      // This eliminates empty squares/tiles near shore by filling gaps (match Windy.com coverage)
      const fillPassData = offCtx.getImageData(0, 0, paddedOffWidth, paddedOffHeight);
      const fillData = fillPassData.data;
      let filledPixels = 0;
      
      // More aggressive fill-in: Fill larger gaps to reduce missing chunks
      // Use 2-pixel radius and require only 1 neighbor to fill more gaps
      const searchRadius = 2;
      for (let y = searchRadius; y < paddedOffHeight - searchRadius; y++) {
        for (let x = searchRadius; x < paddedOffWidth - searchRadius; x++) {
          const idx = (y * paddedOffWidth + x) * 4;
          const alpha = fillData[idx + 3];
          
          // Only fill if transparent and in visible bounds
          if (alpha === 0) {
            const offX = x - edgePadding;
            const offY = y - edgePadding;
            
            if (offX >= 0 && offX < offWidth && offY >= 0 && offY < offHeight) {
              // Calculate lat/lng for this pixel to check if we're over water
              const screenX = offX * scale;
              const screenY = offY * scale;
              const latLng = map.containerPointToLatLng([screenX, screenY]);
              
              // Check 4 cardinal directions (more conservative than 8)
              let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
              let neighborCount = 0;
              
              const directions = [[-1, 0], [0, -1], [0, 1], [1, 0]]; // Only cardinal directions
              for (const [dx, dy] of directions) {
                const nX = x + dx;
                const nY = y + dy;
                if (nX < 0 || nX >= paddedOffWidth || nY < 0 || nY >= paddedOffHeight) continue;
                
                const nIdx = (nY * paddedOffWidth + nX) * 4;
                const nAlpha = fillData[nIdx + 3];
                
                if (nAlpha > 30) { // Lower threshold to use more neighbors
                  rSum += fillData[nIdx];
                  gSum += fillData[nIdx + 1];
                  bSum += fillData[nIdx + 2];
                  aSum += nAlpha;
                  neighborCount++;
                }
              }
              
              // STRICT land check: Require 3 neighbors AND explicit NOT land check
              // This prevents bleeding onto land while still filling ocean gaps
              if (neighborCount >= 3 && !isLikelyLand(latLng.lat, latLng.lng) && isClearlyOverWater(latLng.lat, latLng.lng)) {
                const r = Math.round(rSum / neighborCount);
                const g = Math.round(gSum / neighborCount);
                const b = Math.round(bSum / neighborCount);
                const a = Math.min(255, Math.round(aSum / neighborCount * 0.5)); // More fade (50%) to be conservative
                
                fillData[idx] = r;
                fillData[idx + 1] = g;
                fillData[idx + 2] = b;
                fillData[idx + 3] = a;
                filledPixels++;
              }
            }
          }
        }
      }
      
      // Put filled data back
      if (filledPixels > 0) {
        offCtx.putImageData(fillPassData, 0, 0);
        console.log(`🌊 Filled ${filledPixels} gaps (aggressive fill-in)`);
      }

      // NOTE: Self-blur operation removed - it was causing black areas
      // Blur converts transparent pixels to semi-transparent black when drawing canvas onto itself
      // Edge smoothing is handled by browser's imageSmoothingEnabled instead

      // Draw offscreen canvas scaled up smoothly (no block fill artifacts)
      // Clear main canvas completely before drawing (prevents black wash)
      drawCtx.clearRect(0, 0, size.x, size.y);

      // Match wind layer: use source-over (not multiply) and no globalAlpha
      // Alpha is already embedded in pixel data from getWaveHeightColor
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.imageSmoothingEnabled = true; // Critical for smooth scaling
      drawCtx.imageSmoothingQuality = 'high';

      // Scale up offscreen canvas smoothly (bilinear interpolation)
      // Draw from padded canvas, but crop to visible bounds for final output
      // This ensures edge pixels are sampled and smoothly interpolated
      const sourceX = edgePadding;
      const sourceY = edgePadding;
      const sourceWidth = offWidth;
      const sourceHeight = offHeight;

      // Debug: Log draw parameters (first draw only)
      if (!window.__waveDrawDebug) {
        window.__waveDrawDebug = true;
        console.log(`🌊 Draw params: offscreen=${paddedOffWidth}x${paddedOffHeight}, source=${sourceX},${sourceY},${sourceWidth}x${sourceHeight}, dest=0,0,${size.x}x${size.y}, scale=${scale}`);
      }

      // Apply GeoJSON land masking for pixel-perfect coastlines (Windy.com strategy)
      // Save context state before clipping
      drawCtx.save();

      // Create clipping path from Natural Earth land polygons
      // This masks land areas, allowing waves to render only in ocean
      const maskApplied = landMask.applyMask(drawCtx, map);
      if (!maskApplied && !window.__landMaskWarned) {
        console.warn('⚠️ Land mask not loaded yet, rendering without coastline clipping');
        window.__landMaskWarned = true;
      }

      // Draw offscreen canvas scaled up to main canvas
      // imageSmoothingEnabled provides smooth scaling without blur artifacts
      // Will be clipped to ocean areas only by land mask
      drawCtx.drawImage(
        offscreenCanvas,
        sourceX, sourceY, sourceWidth, sourceHeight, // Source: crop padding
        0, 0, size.x, size.y // Destination: full screen
      );

      // Restore context (remove clipping mask)
      drawCtx.restore();

      // Task S7: Draw debug dots at sample points
      // Enable via: window.__waveDebugDots = true in console
      if (window.__waveDebugDots && debugSamplePoints.length > 0) {
        drawCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        drawCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        drawCtx.lineWidth = 1;
        debugSamplePoints.forEach(point => {
          const pointXY = map.latLngToContainerPoint([point.lat, point.lng]);
          drawCtx.beginPath();
          drawCtx.arc(pointXY.x, pointXY.y, 4, 0, Math.PI * 2);
          drawCtx.fill();
          drawCtx.stroke();
        });
      }

      // PERFORMANCE: Log render metrics
      const renderTime = performance.now() - renderStartTime;
      const finalSamples = (offWidth * offHeight).toLocaleString();
      console.log(`🎨 Wave render: ${renderTime.toFixed(0)}ms | ${finalSamples} samples | scale=${scale} | zoom=${zoom}`);

      // Store in window for debugging and analysis
      if (!window.__wavePerf) window.__wavePerf = [];
      window.__wavePerf.push({
        time: renderTime,
        samples: offWidth * offHeight,
        zoom: zoom,
        scale: scale,
        resolution: `${offWidth}x${offHeight}`,
        timestamp: Date.now()
      });
      // Keep only last 20 renders
      if (window.__wavePerf.length > 20) window.__wavePerf.shift();
    }

    // Initial draw - ensure map is ready before drawing
    // Use requestAnimationFrame to ensure map container is fully initialized
    const initialDraw = () => {
      const size = map.getSize();
      if (size && size.x > 0 && size.y > 0) {
        // Map is ready, draw immediately
        if (canvasRef.current && waveFieldRef.current && waveFieldRef.current.valid) {
          drawHeatmap();
        }
      } else {
        // Map not ready yet, wait for map load event or retry
        if (map.loaded) {
          // Map is loaded but size might not be set yet, retry on next frame
          requestAnimationFrame(initialDraw);
        } else {
          // Wait for map to load
          map.once('load', () => {
            requestAnimationFrame(() => {
              if (canvasRef.current && waveFieldRef.current && waveFieldRef.current.valid) {
                drawHeatmap();
              }
            });
          });
        }
      }
    };
    
    // Start initial draw attempt
    requestAnimationFrame(initialDraw);

    // Check if land mask requested a redraw (loaded after initial render)
    const checkRedrawRequest = () => {
      if (redrawRequestedRef.current && canvasRef.current && waveFieldRef.current && waveFieldRef.current.valid) {
        redrawRequestedRef.current = false; // Clear flag
        drawHeatmap(); // Redraw with land mask
      }
    };
    const redrawCheckInterval = setInterval(checkRedrawRequest, 100); // Check every 100ms

    // Redraw on map move/zoom - debounced to prevent excessive redraws
    let mapUpdateTimeout = null;
    let mapUpdateRAF = null;
    const handleMapUpdate = () => {
      // Clear any pending updates
      if (mapUpdateTimeout) {
        clearTimeout(mapUpdateTimeout);
        mapUpdateTimeout = null;
      }
      if (mapUpdateRAF) {
        cancelAnimationFrame(mapUpdateRAF);
        mapUpdateRAF = null;
      }
      
      // Debounce redraw to avoid excessive updates during rapid map changes
      mapUpdateTimeout = setTimeout(() => {
        if (canvasRef.current && waveFieldRef.current && waveFieldRef.current.valid) {
          // Resize canvas first to match new map size (only if changed)
          resizeCanvas();
          // Then redraw with new view (use requestAnimationFrame for smooth rendering)
          mapUpdateRAF = requestAnimationFrame(() => {
            if (canvasRef.current && waveFieldRef.current && waveFieldRef.current.valid) {
              drawHeatmap();
            }
          });
        }
      }, 150); // Debounce 150ms to prevent excessive redraws
    };

    // Listen to map events for redraw
    // CRITICAL: Must listen to zoomend to redraw canvas at new zoom level
    // MapOverlay fetches new data on zoom, but canvas must redraw to display it
    // Strategy: Keep canvas visible during zoom (show stale data) for smooth UX
    map.on('moveend', handleMapUpdate);
    map.on('zoomend', handleMapUpdate);  // Redraw with new data on zoom
    map.on('resize', handleMapUpdate);

    // Cleanup
    return () => {
      // PERFORMANCE: Cancel any in-flight render when component updates/unmounts
      renderCancelledRef.current = true;

      // Clear any pending updates
      if (mapUpdateTimeout) {
        clearTimeout(mapUpdateTimeout);
        mapUpdateTimeout = null;
      }
      if (mapUpdateRAF) {
        cancelAnimationFrame(mapUpdateRAF);
        mapUpdateRAF = null;
      }
      clearInterval(redrawCheckInterval); // Clear land mask redraw check

      map.off('moveend', handleMapUpdate);
      map.off('zoomend', handleMapUpdate);
      map.off('resize', handleMapUpdate);

      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      waveFieldRef.current = null;
      offscreenCanvasRef.current = null;
    };
  }, [map, waveData, visible, units]); // Note: landMaskReady NOT in deps (prevents re-render)

  return null; // Component manages its own canvas
};

export default WaveCanvasLayer;

