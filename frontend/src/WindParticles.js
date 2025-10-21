import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Custom Wind Particle Animation Component
 * Creates Windy-style animated particles that follow wind vectors
 */
const WindParticles = ({ windData, visible = true }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animationRef = useRef(null);

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
    
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'wind-particle-canvas';
      canvasRef.current = canvas;
      mapContainer.appendChild(canvas);
      console.log('WindParticles: Canvas created and appended');
    }

    // Set canvas dimensions and styling
    canvas.width = mapSize.x;
    canvas.height = mapSize.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0px';
    canvas.style.left = '0px';
    canvas.style.width = mapSize.x + 'px';
    canvas.style.height = mapSize.y + 'px';
    canvas.style.zIndex = '1000'; // Very high to ensure visibility
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    
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
    console.log('Canvas context:', ctx ? 'valid' : 'INVALID');
    
    // Fill canvas with semi-transparent blue to confirm it's visible
    ctx.fillStyle = 'rgba(0, 100, 200, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw large visible test markers
    ctx.fillStyle = 'red';
    ctx.fillRect(50, 50, 200, 100);
    ctx.fillRect(canvas.width - 250, 50, 200, 100);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('WIND TEST', 60, 110);
    ctx.fillText('OVERLAY ACTIVE', canvas.width - 240, 110);
    console.log('WindParticles: Test rectangles drawn, canvas filled with blue');
    
    const particles = [];
    const numParticles = 500; // Fewer, larger particles for testing
    const maxAge = 100;

    // Color scheme (like Windy)
    const getWindColor = (speed) => {
      if (speed < 5) return 'rgba(0, 255, 0, 0.5)';      // Green (light)
      if (speed < 10) return 'rgba(100, 200, 255, 0.5)'; // Blue
      if (speed < 15) return 'rgba(255, 200, 0, 0.5)';   // Yellow
      if (speed < 25) return 'rgba(255, 100, 0, 0.5)';   // Orange
      return 'rgba(255, 0, 0, 0.5)';                     // Red (strong)
    };

    // Initialize particles
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        age: Math.random() * maxAge
      });
    }
    particlesRef.current = particles;

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

      if (!nearest || minDist > 1.0) {
        return { u: 0, v: 0, speed: 0 };
      }

      return {
        u: nearest.u_component || 0,
        v: nearest.v_component || 0,
        speed: nearest.speed_kts || 0
      };
    };

    // Convert pixel to lat/lon
    const pixelToLatLng = (x, y) => {
      const containerPoint = { x, y };
      return map.containerPointToLatLng([x, y]);
    };

    // Convert lat/lon to pixel
    const latLngToPixel = (lat, lon) => {
      const point = map.latLngToContainerPoint([lat, lon]);
      return { x: point.x, y: point.y };
    };

    // Animation loop
    let frameCount = 0;
    const animate = () => {
      frameCount++;
      if (frameCount === 1 || frameCount % 60 === 0) {
        console.log(`WindParticles animate frame ${frameCount}, particles: ${particles.length}`);
      }
      
      // Clear canvas completely for testing (no fade effect)
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw a visible background so we know canvas is rendering
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Update and draw particles
      let drawnCount = 0;
      particles.forEach(particle => {
        // Get lat/lon of particle
        const latLng = pixelToLatLng(particle.x, particle.y);
        
        // Get wind at position
        const wind = getWindAt(latLng.lat, latLng.lng);
        
        // Move particle based on wind
        const scale = 0.8; // Speed multiplier
        const pixelVelocity = {
          x: wind.u * scale,
          y: -wind.v * scale // Flip Y for screen coordinates
        };

        particle.x += pixelVelocity.x;
        particle.y += pixelVelocity.y;
        particle.age++;

        // Respawn if too old or out of bounds
        if (particle.age > maxAge || 
            particle.x < 0 || particle.x > canvas.width ||
            particle.y < 0 || particle.y > canvas.height) {
          particle.x = Math.random() * canvas.width;
          particle.y = Math.random() * canvas.height;
          particle.age = 0;
        }

        // Draw particle - make it LARGE and BRIGHT for visibility
        ctx.fillStyle = 'rgba(255, 255, 0, 0.9)'; // Bright yellow, very visible
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2); // 3px radius circle
        ctx.fill();
        drawnCount++;
      });
      
      if (frameCount === 1 || frameCount % 60 === 0) {
        console.log(`  Drew ${drawnCount} particles, sample particle:`, {
          x: particles[0].x.toFixed(1),
          y: particles[0].y.toFixed(1),
          age: particles[0].age,
          canvasSize: `${canvas.width}x${canvas.height}`
        });
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    // Start animation
    animate();

    // Update canvas on map move/zoom
    const updateCanvas = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
    };

    map.on('moveend', updateCanvas);
    map.on('zoomend', updateCanvas);

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      map.off('moveend', updateCanvas);
      map.off('zoomend', updateCanvas);
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [map, windData, visible]);

  return null;
};

export default WindParticles;

