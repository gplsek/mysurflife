import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import WindField from './WindField';

/**
 * WindParticlesLayer - Animated particle flow visualization
 * 
 * Spawns particles that flow along the wind vector field.
 * Uses requestAnimationFrame for smooth animation.
 */

// Trail retention factor. Higher = longer trails. (Windy-style fade without painting black)
const TRAIL_RETAIN = 0.92;
const BASE_STEP_SCALE = 0.15; // Base pixel step per m/s (slower)
const MAX_AGE = 80; // Frames before respawn

class Particle {
  constructor(x, y, map) {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.map = map;
  }

  update(windField) {
    // Convert pixel position to lat/lon
    const latLng = this.map.containerPointToLatLng([this.x, this.y]);
    
    // Interpolate wind vector
    const vec = windField.getVector(latLng.lat, latLng.lng);
    
    if (!vec) {
      // Outside bounds or invalid - respawn
      this.respawn();
      return;
    }

    // Get current zoom level to maintain constant visual speed
    const zoom = this.map.getZoom();
    // Scale factor: at zoom 6.5 (default), scale is 1.0
    // When zoomed IN (higher zoom): need MORE pixels to cover same real-world distance
    // When zoomed OUT (lower zoom): need FEWER pixels to cover same real-world distance
    // Formula: zoomScale = 2^(zoom - referenceZoom)
    const referenceZoom = 6.5;
    const zoomScale = Math.pow(2, zoom - referenceZoom);
    const stepScale = BASE_STEP_SCALE * zoomScale;

    // Convert wind vector (m/s) to pixel displacement
    // Note: v is inverted because screen Y increases downward
    const dx = vec.u * stepScale;
    const dy = -vec.v * stepScale; // Invert v component

    // Update position
    this.x += dx;
    this.y += dy;
    this.age++;

    // Check if particle is still in viewport
    const size = this.map.getSize();
    if (this.x < 0 || this.x > size.x || this.y < 0 || this.y > size.y || this.age > MAX_AGE) {
      this.respawn();
    }
  }

  respawn() {
    const size = this.map.getSize();
    this.x = Math.random() * size.x;
    this.y = Math.random() * size.y;
    this.age = 0;
  }

  draw(ctx) {
    // Draw particle as a small streak for a more Windy-like look
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - 1.5, this.y - 1.5);
    ctx.stroke();
  }
}

const WindParticlesLayer = ({ windData, visible }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const windFieldRef = useRef(null);
  const particlesRef = useRef([]);
  const animationFrameRef = useRef(null);
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    if (!visible || !windData || !windData.vectors || windData.vectors.length === 0) {
      // Stop animation and clean up
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      isAnimatingRef.current = false;
      
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      windFieldRef.current = null;
      particlesRef.current = [];
      return;
    }

    // Build WindField from vectors
    windFieldRef.current = new WindField(windData.vectors);
    if (!windFieldRef.current.valid) {
      console.warn('WindField invalid, cannot render particles');
      return;
    }

    const mapContainer = map.getContainer();
    let canvas = canvasRef.current;

    // Create canvas if it doesn't exist
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wind-particles-canvas';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '401'; // Above heatmap
      canvas.style.background = 'transparent';
      mapContainer.appendChild(canvas);
      canvasRef.current = canvas;
    }

    const ctx = canvas.getContext('2d');

    const stopAnimation = () => {
      isAnimatingRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    const clearCanvas = () => {
      const size = map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);
    };

    const animate = () => {
      if (!isAnimatingRef.current || !windFieldRef.current || !windFieldRef.current.valid) {
        return;
      }

      const size = map.getSize();
      
      // Fade previous frame WITHOUT painting black (prevents black overlay)
      // Use globalAlpha to fade existing content, then reset
      ctx.save();
      ctx.globalAlpha = TRAIL_RETAIN;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';

      // Update and draw particles
      particlesRef.current.forEach(particle => {
        particle.update(windFieldRef.current);
        particle.draw(ctx);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      if (isAnimatingRef.current) return;
      isAnimatingRef.current = true;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Resize canvas to map size
    function resizeCanvas() {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      
      // Respawn particles on resize
      particlesRef.current.forEach(p => p.respawn());
    }

    resizeCanvas();

    // Initialize or update particles when windData changes
    const size = map.getSize();
    if (particlesRef.current.length === 0) {
      // Initialize particles
      for (let i = 0; i < 1500; i++) {
        particlesRef.current.push(new Particle(
          Math.random() * size.x,
          Math.random() * size.y,
          map
        ));
      }
    } else {
      // Update existing particles to stay in bounds
      particlesRef.current.forEach(p => {
        if (p.x < 0 || p.x > size.x || p.y < 0 || p.y > size.y) {
          p.respawn();
        }
      });
    }

    // Pause animation while the map is moving/zooming, restart on end
    const handleMoveStart = () => {
      stopAnimation();
      clearCanvas();
    };

    const handleMoveEnd = () => {
      if (canvasRef.current && windFieldRef.current && windFieldRef.current.valid) {
        resizeCanvas();
        // After resizing, fully clear so we don't retain old trails in a new projection
        clearCanvas();
        // Keep particles inside bounds
        const size = map.getSize();
        particlesRef.current.forEach(p => {
          if (p.x < 0 || p.x > size.x || p.y < 0 || p.y > size.y) p.respawn();
        });
        startAnimation();
      }
    };

    map.on('movestart', handleMoveStart);
    map.on('zoomstart', handleMoveStart);
    map.on('moveend', handleMoveEnd);
    map.on('zoomend', handleMoveEnd);
    map.on('resize', handleMoveEnd);

    // Start animation
    startAnimation();

    // Cleanup
    return () => {
      stopAnimation();

      map.off('movestart', handleMoveStart);
      map.off('zoomstart', handleMoveStart);
      map.off('moveend', handleMoveEnd);
      map.off('zoomend', handleMoveEnd);
      map.off('resize', handleMoveEnd);
      
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      windFieldRef.current = null;
      particlesRef.current = [];
    };
  }, [map, windData, visible]);

  return null; // Component manages its own canvas
};

export default WindParticlesLayer;
