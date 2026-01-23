import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import WindField from './WindField';

/**
 * WindCanvasLayer - Smooth wind speed heatmap overlay
 * 
 * Draws a continuous-looking wind intensity field using canvas.
 * Updates on map move/zoom and when windData changes.
 */

// Vivid mode tuning constants - match waves vibrancy
const ALPHA_BASE = 0.50; // Base overlay transparency (match waves)
const MIN_ALPHA = 0.20; // Minimum alpha floor for low winds (more vibrant)
const GAMMA = 0.65; // Gamma boost for mid values (lower = more pop, helps low speeds)

/**
 * Get wind speed color with vivid mode (gamma boost + minimum alpha)
 */
function getWindSpeedColor(speed, alphaBase = ALPHA_BASE) {
  // Guard against invalid values
  if (speed === null || speed === undefined || Number.isNaN(speed) || !Number.isFinite(speed)) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // More vibrant colors matching waves - full saturation for better visibility on dark map
  const colorStops = [
    [0,   80,  120, 180, 0.6],   // 0 kts: Deeper blue (more vibrant)
    [5,   100, 160, 220, 0.65],  // 5 kts: Sky blue (brighter)
    [10,  80,  220, 220, 0.7],   // 10 kts: Bright turquoise
    [15,  120, 255, 120, 0.75],  // 15 kts: Bright green
    [20,  255, 255, 80,  0.8],   // 20 kts: Bright yellow
    [25,  255, 220, 40,  0.85],  // 25 kts: Yellow-orange (brighter)
    [30,  255, 160, 20,  0.9],   // 30 kts: Bright orange
    [35,  255, 100, 20,  0.95],  // 35 kts: Orange-red (brighter)
    [40,  255, 40,  40,  1.0],   // 40 kts: Bright red
    [50,  220, 20,  60,  1.0]    // 50+ kts: Deep red (brighter)
  ];

  const minStop = colorStops[0][0];
  const maxStop = colorStops[colorStops.length - 1][0];
  const s = Math.max(minStop, Math.min(maxStop, speed));

  let lowerStop = colorStops[0];
  let upperStop = colorStops[colorStops.length - 1];

  for (let i = 0; i < colorStops.length - 1; i++) {
    if (s >= colorStops[i][0] && s <= colorStops[i + 1][0]) {
      lowerStop = colorStops[i];
      upperStop = colorStops[i + 1];
      break;
    }
  }

  const rawT = (s - lowerStop[0]) / (upperStop[0] - lowerStop[0]);
  const t = Math.max(0, Math.min(1, rawT));
  
  // Apply gamma boost for mid values
  const tg = Math.pow(t, GAMMA);
  
  // Interpolate colors using gamma-corrected t
  const r = Math.round(lowerStop[1] + tg * (upperStop[1] - lowerStop[1]));
  const g = Math.round(lowerStop[2] + tg * (upperStop[2] - lowerStop[2]));
  const b = Math.round(lowerStop[3] + tg * (upperStop[3] - lowerStop[3]));
  
  // Interpolate alpha with minimum floor
  // Boost low speeds even more for visibility
  let baseAlpha = lowerStop[4] + tg * (upperStop[4] - lowerStop[4]);
  
  // Extra boost for very low speeds (0-10 mph / 0-8.7 kts)
  if (speed < 9) {
    const lowSpeedBoost = 1.0 + (9 - speed) * 0.15; // Up to 2.35x boost at 0 kts
    baseAlpha = Math.min(1.0, baseAlpha * lowSpeedBoost);
  }
  
  const a = Math.max(MIN_ALPHA, baseAlpha) * alphaBase;

  return { r, g, b, a };
}

const WindCanvasLayer = ({ windData, visible }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const windFieldRef = useRef(null);
  const offscreenCanvasRef = useRef(null); // Cache offscreen canvas

  useEffect(() => {
    if (!visible || !windData || !windData.vectors || windData.vectors.length === 0) {
      // Clean up canvas if not visible
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      windFieldRef.current = null;
      return;
    }

    // Build WindField from vectors
    windFieldRef.current = new WindField(windData.vectors);
    if (!windFieldRef.current.valid) {
      console.warn('WindField invalid, cannot render heatmap');
      return;
    }

    // Use Leaflet's tile-pane (like waves) for consistent layering
    const tilePane = map.getPane('tilePane') || map.getContainer().querySelector('.leaflet-tile-pane');
    if (!tilePane) {
      console.warn('🌬️ Tile pane not found, falling back to map container');
      return;
    }
    
    let canvas = canvasRef.current;

    // Create canvas if it doesn't exist
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wind-heatmap-canvas';
      canvas.className = 'leaflet-layer wind-overlay-layer';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '25'; // Within tile-pane: above basemap (20), match waves
      canvas.style.background = 'transparent';
      canvas.style.opacity = '1';
      tilePane.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const ctx = canvas.getContext('2d');
    
    // Enable image smoothing for smoother appearance
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Resize canvas to map size
    function resizeCanvas() {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }

    resizeCanvas();

    /**
     * Draw smooth heatmap using offscreen canvas for better definition
     * Low-res sampling → scaled up with smoothing = clearer gradients, less muddy wash
     */
    function drawHeatmap() {
      if (!windFieldRef.current || !windFieldRef.current.valid) return;

      const size = map.getSize();
      const zoom = map.getZoom();
      
      // Zoom-aware stride: smaller stride when zoomed in for better quality
      const stride = zoom >= 8 ? 2 : zoom >= 6 ? 3 : 4;

      // Create or reuse offscreen canvas at lower resolution
      let offscreenCanvas = offscreenCanvasRef.current;
      const offWidth = Math.ceil(size.x / stride);
      const offHeight = Math.ceil(size.y / stride);
      
      if (!offscreenCanvas || offscreenCanvas.width !== offWidth || offscreenCanvas.height !== offHeight) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = offWidth;
        offscreenCanvas.height = offHeight;
        offscreenCanvasRef.current = offscreenCanvas;
      }
      
      const offCtx = offscreenCanvas.getContext('2d');
      
      // Create ImageData for offscreen canvas (one pixel per sample)
      const offImageData = offCtx.createImageData(offWidth, offHeight);
      const offData = offImageData.data;

      // Sample at stride intervals - one pixel per sample
      for (let offY = 0; offY < offHeight; offY++) {
        for (let offX = 0; offX < offWidth; offX++) {
          // Convert offscreen pixel to map pixel
          const mapX = offX * stride;
          const mapY = offY * stride;
          
          // Convert pixel to lat/lon
          const latLng = map.containerPointToLatLng([mapX, mapY]);
          
          // Interpolate wind speed
          const speed = windFieldRef.current.getSpeed(latLng.lat, latLng.lng);
          
          const idx = (offY * offWidth + offX) * 4;
          
          if (speed !== null && speed !== undefined) {
            const color = getWindSpeedColor(speed, ALPHA_BASE);
            offData[idx] = color.r;     // R
            offData[idx + 1] = color.g; // G
            offData[idx + 2] = color.b; // B
            offData[idx + 3] = Math.round(color.a * 255); // A
          } else {
            // Transparent for invalid data
            offData[idx] = 0;
            offData[idx + 1] = 0;
            offData[idx + 2] = 0;
            offData[idx + 3] = 0;
          }
        }
      }

      // Put ImageData into offscreen canvas
      offCtx.putImageData(offImageData, 0, 0);

      // Clear main canvas completely before drawing (prevents black wash)
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      
      // Scale up offscreen canvas to full size (smoothing creates continuous field)
      // Only colored pixels are drawn, transparent areas stay transparent
      ctx.drawImage(offscreenCanvas, 0, 0, size.x, size.y);
    }

    // Initial draw
    drawHeatmap();

    // Redraw on map move/zoom
    const handleMapUpdate = () => {
      if (canvasRef.current && windFieldRef.current && windFieldRef.current.valid) {
        resizeCanvas();
        drawHeatmap();
      }
    };

    map.on('moveend', handleMapUpdate);
    map.on('zoomend', handleMapUpdate);
    map.on('resize', handleMapUpdate);

    // Cleanup
    return () => {
      map.off('moveend', handleMapUpdate);
      map.off('zoomend', handleMapUpdate);
      map.off('resize', handleMapUpdate);
      
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      windFieldRef.current = null;
    };
  }, [map, windData, visible]);

  return null; // Component manages its own canvas
};

export default WindCanvasLayer;
