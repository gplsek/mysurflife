import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Wind Forecast Grid Overlay
 * Shows wind speed (colored cells) and direction (arrows) like iWindsurf
 */
const WindParticles = ({ windData, visible = true }) => {
  const map = useMap();
  const canvasRef = useRef(null);

  useEffect(() => {
    console.log('WindParticles useEffect triggered', { visible, hasData: !!windData, vectors: windData?.vectors?.length });
    
    if (!visible || !windData || !windData.vectors || windData.vectors.length === 0) {
      console.log('WindParticles: Not rendering - conditions not met');
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.style.display = 'none';
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    console.log('WindParticles: Creating canvas with', windData.vectors.length, 'vectors');
    
    const mapContainer = map.getContainer();
    const mapSize = map.getSize();
    
    // Create canvas overlay directly in map container (not pane)
    let canvas = canvasRef.current;
    
    // Check if canvas still exists in DOM
    if (canvas && !document.body.contains(canvas)) {
      console.warn('WindParticles: Canvas was removed from DOM! Recreating...');
      canvas = null;
      canvasRef.current = null;
    }
    
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wind-particle-canvas-' + Date.now();
      canvas.className = 'particle-overlay-canvas';
      canvasRef.current = canvas;
      mapContainer.appendChild(canvas);
      console.log('WindParticles: NEW Canvas created and appended', {
        id: canvas.id,
        parentTag: mapContainer.tagName,
        parentClass: mapContainer.className
      });
    } else {
      console.log('WindParticles: Reusing existing canvas', { id: canvas.id });
    }

    // Set canvas dimensions and styling
    canvas.width = mapSize.x;
    canvas.height = mapSize.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0px';
    canvas.style.left = '0px';
    canvas.style.width = mapSize.x + 'px';
    canvas.style.height = mapSize.y + 'px';
    canvas.style.zIndex = '400'; // Above map tiles (200) but below markers (600) and UI (1000)
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    canvas.style.opacity = '0.8'; // Slightly transparent so map shows through
    
    console.log('WindParticles: Canvas created/shown', { 
      width: canvas.width, 
      height: canvas.height, 
      zIndex: canvas.style.zIndex,
      position: canvas.style.position,
      display: canvas.style.display,
      inDOM: document.body.contains(canvas),
      parent: canvas.parentElement?.className
    });

    const ctx = canvas.getContext('2d');
    
    // Grid cell size (pixels)
    const cellSize = 50;
    
    // Color scheme for wind speed (iWindsurf style)
    const getWindColor = (speed) => {
      if (speed < 5) return { bg: 'rgba(144, 238, 144, 0.4)', arrow: '#2d5016' };   // Light green
      if (speed < 10) return { bg: 'rgba(135, 206, 250, 0.5)', arrow: '#1e3a8a' };  // Light blue
      if (speed < 15) return { bg: 'rgba(65, 105, 225, 0.6)', arrow: '#1e3a8a' };   // Royal blue
      if (speed < 20) return { bg: 'rgba(255, 215, 0, 0.6)', arrow: '#713f12' };    // Gold
      if (speed < 25) return { bg: 'rgba(255, 140, 0, 0.7)', arrow: '#7c2d12' };    // Orange
      return { bg: 'rgba(220, 20, 60, 0.8)', arrow: '#7f1d1d' };                    // Crimson
    };

    // Get wind vector at position
    const getWindAt = (lat, lon) => {
      // Find nearest wind vector
      let nearest = null;
      let minDist = Infinity;

      for (const vector of windData.vectors) {
        const dist = Math.sqrt(
          Math.pow(vector.lat - lat, 2) + 
          Math.pow(vector.lon - lon, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          nearest = vector;
        }
      }

      if (!nearest || minDist > 1.5) {
        return null;
      }

      return {
        speed: nearest.speed_kts || 0,
        direction: nearest.direction_deg || 0
      };
    };

    // Draw arrow pointing in wind direction
    const drawArrow = (x, y, direction, color, size = 20) => {
      ctx.save();
      ctx.translate(x, y);
      // Add 180 degrees because wind direction is "from", we want to show "to"
      ctx.rotate(((direction + 180) * Math.PI) / 180);
      
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      
      // Arrow shaft
      ctx.beginPath();
      ctx.moveTo(0, -size/2);
      ctx.lineTo(0, size/2);
      ctx.stroke();
      
      // Arrow head
      ctx.beginPath();
      ctx.moveTo(0, size/2);
      ctx.lineTo(-size/4, size/4);
      ctx.lineTo(size/4, size/4);
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();
    };

    // Draw the grid once
    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw grid cells
      for (let x = 0; x < canvas.width; x += cellSize) {
        for (let y = 0; y < canvas.height; y += cellSize) {
          // Get center of cell
          const centerX = x + cellSize / 2;
          const centerY = y + cellSize / 2;
          
          // Convert to lat/lon
          const latLng = map.containerPointToLatLng([centerX, centerY]);
          
          // Get wind data
          const wind = getWindAt(latLng.lat, latLng.lng);
          
          if (wind) {
            const colors = getWindColor(wind.speed);
            
            // Draw colored background cell
            ctx.fillStyle = colors.bg;
            ctx.fillRect(x, y, cellSize, cellSize);
            
            // Draw wind direction arrow
            drawArrow(centerX, centerY, wind.direction, colors.arrow, cellSize * 0.6);
          }
        }
      }
    };

    // Initial draw
    drawGrid();
    
    // Update canvas size and redraw on map changes
    const handleMapChange = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      drawGrid(); // Redraw after resize
    };

    map.on('moveend', drawGrid);
    map.on('zoomend', handleMapChange);

    // Cleanup
    return () => {
      map.off('moveend', drawGrid);
      map.off('zoomend', handleMapChange);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [map, windData, visible]);

  return null;
};

export default WindParticles;

