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
      // Rotate to wind direction (where it's going, not coming from)
      ctx.rotate((direction) * Math.PI / 180);

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
     * Draw smooth wind grid
     */
    function drawWindGrid() {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bounds = map.getBounds();
      const zoom = map.getZoom();
      
      // Adaptive cell size based on zoom level
      const cellSize = zoom < 6 ? 60 : zoom < 8 ? 50 : 40;

      // Group vectors by cell for smoother rendering
      const cellMap = new Map();

      windData.vectors.forEach(vector => {
        const point = map.latLngToContainerPoint([vector.lat, vector.lon]);

        // Skip if out of bounds
        if (point.x < -cellSize || point.x > canvas.width + cellSize ||
            point.y < -cellSize || point.y > canvas.height + cellSize) {
          return;
        }

        // Snap to grid
        const cellX = Math.floor(point.x / cellSize) * cellSize;
        const cellY = Math.floor(point.y / cellSize) * cellSize;
        const cellKey = `${cellX},${cellY}`;

        if (!cellMap.has(cellKey)) {
          cellMap.set(cellKey, []);
        }
        cellMap.get(cellKey).push({
          ...vector,
          x: point.x,
          y: point.y
        });
      });

      // Draw cells
      cellMap.forEach((vectors, cellKey) => {
        if (vectors.length === 0) return;

        // Average wind speed and direction for this cell
        const avgSpeed = vectors.reduce((sum, v) => sum + v.speed_kts, 0) / vectors.length;
        const avgDir = vectors.reduce((sum, v) => sum + v.direction_deg, 0) / vectors.length;
        const centerX = vectors[0].x;
        const centerY = vectors[0].y;

        // Draw colored background cell
        const color = getWindSpeedColor(avgSpeed);
        ctx.fillStyle = color;
        ctx.fillRect(
          centerX - cellSize / 2,
          centerY - cellSize / 2,
          cellSize,
          cellSize
        );

        // Draw arrow at cell center
        drawArrow(ctx, centerX, centerY, avgDir, avgSpeed);
      });

      console.log(`🎨 WindGrid: Drew ${cellMap.size} grid cells`);
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

