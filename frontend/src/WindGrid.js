import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * WindGrid - Smooth iWindsurf-style wind overlay
 * 
 * Features:
 * - Grid-based visualization (not particles)
 * - Smooth color gradients for wind speed
 * - Directional arrows
 * - Semi-transparent to see map underneath
 */
const WindGrid = ({ windData, model, visible }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    if (!visible || !windData || !windData.vectors || windData.vectors.length === 0) {
      // Clean up canvas if not visible
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      return;
    }

    console.log(`🌬️ WindGrid: Rendering ${windData.vectors.length} wind vectors for ${model}`);

    const mapContainer = map.getContainer();
    let canvas = canvasRef.current;

    // Create canvas if it doesn't exist
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wind-grid-canvas';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';  // Allow clicks through
      canvas.style.zIndex = '400';  // Above map tiles, below markers
      canvas.style.opacity = '0.85';  // Semi-transparent
      mapContainer.appendChild(canvas);
      canvasRef.current = canvas;
      console.log('✅ WindGrid: Canvas created');
    }

    const ctx = canvas.getContext('2d');

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
     * Get smooth wind speed color (iWindsurf-inspired)
     * Creates smooth gradients between color stops
     */
    function getWindSpeedColor(speed) {
      // Color stops: [speed, r, g, b, alpha]
      const colorStops = [
        [0,   173, 216, 230, 0.5],   // 0 kts: Light blue
        [5,   135, 206, 250, 0.55],  // 5 kts: Sky blue
        [10,  100, 200, 200, 0.6],   // 10 kts: Turquoise
        [15,  144, 238, 144, 0.65],  // 15 kts: Light green
        [20,  255, 255, 100, 0.7],   // 20 kts: Yellow
        [25,  255, 200,  50, 0.75],  // 25 kts: Yellow-orange
        [30,  255, 140,  30, 0.8],   // 30 kts: Orange
        [35,  255,  80,  30, 0.85],  // 35 kts: Orange-red
        [40,  220,  40,  60, 0.9],   // 40 kts: Red
        [50,  180,  20,  80, 0.95]   // 50+ kts: Dark red
      ];

      // Find the two color stops to interpolate between
      let lowerStop = colorStops[0];
      let upperStop = colorStops[colorStops.length - 1];

      for (let i = 0; i < colorStops.length - 1; i++) {
        if (speed >= colorStops[i][0] && speed <= colorStops[i + 1][0]) {
          lowerStop = colorStops[i];
          upperStop = colorStops[i + 1];
          break;
        }
      }

      // Linear interpolation between color stops
      const t = (speed - lowerStop[0]) / (upperStop[0] - lowerStop[0]);
      const r = Math.round(lowerStop[1] + t * (upperStop[1] - lowerStop[1]));
      const g = Math.round(lowerStop[2] + t * (upperStop[2] - lowerStop[2]));
      const b = Math.round(lowerStop[3] + t * (upperStop[3] - lowerStop[3]));
      const a = lowerStop[4] + t * (upperStop[4] - lowerStop[4]);

      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    /**
     * Draw directional arrow
     */
    function drawArrow(ctx, x, y, direction, speed) {
      const arrowLength = Math.min(35, Math.max(15, speed * 1.5));
      const arrowWidth = speed > 20 ? 3 : 2;

      ctx.save();
      ctx.translate(x, y);
      // Rotate to wind direction - ADD 180° because meteorological convention is "FROM" direction
      // We want to show where wind is GOING (opposite of where it's coming from)
      ctx.rotate((direction + 180) * Math.PI / 180);

      // Arrow shaft
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = arrowWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -arrowLength);
      ctx.stroke();

      // Arrow head
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -arrowLength);
      ctx.lineTo(-6, -arrowLength + 10);
      ctx.lineTo(6, -arrowLength + 10);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    /**
     * Draw smooth wind grid (iWindsurf style - no visible grid lines)
     */
    function drawWindGrid() {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bounds = map.getBounds();
      const zoom = map.getZoom();
      
      // Adaptive cell size - LARGER for smoother appearance
      const cellSize = zoom < 6 ? 80 : zoom < 8 ? 70 : 60;

      // Build spatial index of wind data
      const spatialIndex = new Map();
      
      windData.vectors.forEach(vector => {
        const point = map.latLngToContainerPoint([vector.lat, vector.lon]);
        
        // Store in spatial index
        const gridX = Math.floor(point.x / cellSize);
        const gridY = Math.floor(point.y / cellSize);
        const key = `${gridX},${gridY}`;
        
        if (!spatialIndex.has(key)) {
          spatialIndex.set(key, []);
        }
        spatialIndex.get(key).push({
          ...vector,
          x: point.x,
          y: point.y
        });
      });

      // Fill entire canvas with smooth gradient
      // Cover ENTIRE visible area, not just where we have data
      for (let x = -cellSize; x < canvas.width + cellSize; x += cellSize) {
        for (let y = -cellSize; y < canvas.height + cellSize; y += cellSize) {
          const gridX = Math.floor(x / cellSize);
          const gridY = Math.floor(y / cellSize);
          
          // Find nearest wind data (search in surrounding cells)
          let nearestVector = null;
          let minDist = Infinity;
          
          // Search in 3x3 grid around this cell
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const key = `${gridX + dx},${gridY + dy}`;
              const vectors = spatialIndex.get(key);
              
              if (vectors) {
                vectors.forEach(v => {
                  const dist = Math.sqrt((v.x - x) ** 2 + (v.y - y) ** 2);
                  if (dist < minDist) {
                    minDist = dist;
                    nearestVector = v;
                  }
                });
              }
            }
          }
          
          if (nearestVector) {
            // Draw smooth colored cell (NO BORDERS - fills blend together)
            const color = getWindSpeedColor(nearestVector.speed_kts);
            ctx.fillStyle = color;
            
            // Draw slightly larger than cell size to eliminate gaps
            ctx.fillRect(x - 1, y - 1, cellSize + 2, cellSize + 2);
          }
        }
      }
      
      // Draw arrows AFTER background (on top layer)
      spatialIndex.forEach((vectors, key) => {
        if (vectors.length === 0) return;
        
        // Average wind for this cell
        const avgSpeed = vectors.reduce((sum, v) => sum + v.speed_kts, 0) / vectors.length;
        const avgDir = vectors.reduce((sum, v) => sum + v.direction_deg, 0) / vectors.length;
        const centerX = vectors[0].x;
        const centerY = vectors[0].y;
        
        // Only draw arrow if in visible area
        if (centerX >= 0 && centerX <= canvas.width && 
            centerY >= 0 && centerY <= canvas.height) {
          drawArrow(ctx, centerX, centerY, avgDir, avgSpeed);
        }
      });

      console.log(`🎨 WindGrid: Smooth coverage - ${spatialIndex.size} cells filled entire canvas`);
    }

    // Initial draw
    drawWindGrid();

    // Redraw on map move/zoom
    const handleMapUpdate = () => {
      if (canvasRef.current) {
        resizeCanvas();
        drawWindGrid();
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
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
    };
  }, [map, windData, model, visible]);

  return null;  // Component manages its own canvas
};

export default WindGrid;

