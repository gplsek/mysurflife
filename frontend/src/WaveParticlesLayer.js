import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import WaveField from './WaveField';

/**
 * WaveParticlesLayer - Animated particle flow visualization for waves
 * 
 * Spawns particles that flow along the wave direction field.
 * Movement speed is based on wave height (slower than wind).
 * Uses requestAnimationFrame for smooth animation.
 */

// Trail retention factor. Higher = longer trails.
const TRAIL_RETAIN = 0.94; // Slightly longer trails than wind
const BASE_STEP_SCALE = 0.08; // Base pixel step per m/s (much slower than wind)
const MAX_AGE = 100; // Frames before respawn (longer than wind)
const PARTICLE_COUNT = 1200; // Number of particles (fewer than wind)

class WaveParticle {
  constructor(x, y, map) {
    this.x = x;
    this.y = y;
    this.age = 0;
    this.map = map;
    this.respawn(); // Initial respawn to set random position
  }

  update(waveField) {
    // Convert pixel position to lat/lon
    const latLng = this.map.containerPointToLatLng([this.x, this.y]);
    
    // Interpolate wave vector
    const vec = waveField.getVector(latLng.lat, latLng.lng);
    
    if (!vec) {
      // Outside bounds or invalid - respawn
      this.respawn();
      return;
    }

    // Get current zoom level to maintain constant visual speed
    const zoom = this.map.getZoom();
    const zoomScale = Math.pow(2, zoom - 6.5); // Reference zoom 6.5

    // Wave speed is based on wave height (hs in meters)
    // Clamp between 0.1 and 1.2 pixels/frame
    const hsSpeed = Math.max(0.1, Math.min(1.2, vec.hs * 0.35));
    const stepScale = BASE_STEP_SCALE * zoomScale * hsSpeed;

    // Convert wave direction (degrees) to pixel displacement
    // Direction is where waves are coming FROM (meteorological convention)
    // For particle flow, we want to show where waves are going TO
    const dirRad = (vec.dir_deg * Math.PI) / 180;
    const dx = Math.sin(dirRad) * stepScale;
    const dy = -Math.cos(dirRad) * stepScale; // Invert Y (screen Y increases downward)

    // Store for drawing
    this.lastDx = dx;
    this.lastDy = dy;

    // Update position
    this.x += dx;
    this.y += dy;
    this.age++;

    // Check if particle is still in viewport or too old
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
    this.lastDx = 0;
    this.lastDy = 0;
  }

  draw(ctx) {
    // Draw particle as a small streak for a more Windy-like look
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'; // Slightly more transparent than wind
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    // Draw a short line segment in the direction of movement
    const prevX = this.x - (this.lastDx || 0) * 2;
    const prevY = this.y - (this.lastDy || 0) * 2;
    ctx.lineTo(prevX, prevY);
    ctx.stroke();
  }
}

const WaveParticlesLayer = ({ waveData, visible }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const waveFieldRef = useRef(null);
  const particlesRef = useRef([]);
  const animationFrameRef = useRef(null);
  const isAnimatingRef = useRef(false);

  // Update WaveField when waveData changes
  useEffect(() => {
    if (waveData?.vectors?.length) {
      waveFieldRef.current = new WaveField(waveData.vectors);
    } else {
      waveFieldRef.current = null;
    }
  }, [waveData]);

  useEffect(() => {
    if (!visible || !waveFieldRef.current || !waveFieldRef.current.valid) {
      // Stop animation and clean up
      stopAnimation();
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.remove();
        canvasRef.current = null;
      }
      particlesRef.current = []; // Clear particles
      return;
    }

    const mapContainer = map.getContainer();
    let canvas = canvasRef.current;

    // Create canvas if it doesn't exist
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wave-particles-canvas';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '401'; // Above heatmap (400)
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
      if (!isAnimatingRef.current || !waveFieldRef.current || !waveFieldRef.current.valid) {
        return;
      }

      const size = map.getSize();
      
      // Fade previous frame WITHOUT painting black (prevents black overlay)
      // Use destination-in with white to fade, not black
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(255, 255, 255, ${TRAIL_RETAIN})`;
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'source-over';

      // Update and draw particles
      particlesRef.current.forEach(particle => {
        particle.update(waveFieldRef.current);
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
      
      // Respawn particles on resize to ensure they are within new bounds
      particlesRef.current.forEach(p => p.respawn());
    }

    resizeCanvas();

    // Initialize particles if not already done or if waveData changed
    if (particlesRef.current.length === 0 || waveData !== particlesRef.current._lastWaveData) {
      particlesRef.current = []; // Clear existing particles
      const size = map.getSize();
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particlesRef.current.push(new WaveParticle(
          Math.random() * size.x,
          Math.random() * size.y,
          map
        ));
      }
      particlesRef.current._lastWaveData = waveData; // Store for comparison
    }

    // Pause animation while the map is moving/zooming, restart on end
    const handleMoveStart = () => {
      stopAnimation();
      clearCanvas();
    };

    const handleMoveEnd = () => {
      if (canvasRef.current && waveFieldRef.current && waveFieldRef.current.valid) {
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
      waveFieldRef.current = null;
      particlesRef.current = [];
    };
  }, [map, waveData, visible]);

  return null; // Component manages its own canvas
};

export default WaveParticlesLayer;




