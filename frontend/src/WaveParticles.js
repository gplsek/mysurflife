import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Custom Wave/Swell Particle Animation Component
 * Creates Windy-style animated particles that follow ocean swell direction
 */
const WaveParticles = ({ swellData, visible = true }) => {
  const map = useMap();
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animationRef = useRef(null);

  useEffect(() => {
    console.log('WaveParticles useEffect triggered', { visible, hasData: !!swellData, waveData: swellData?.wave_data?.length });
    
    if (!visible || !swellData || !swellData.wave_data || swellData.wave_data.length === 0) {
      console.log('WaveParticles: Not rendering - conditions not met');
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.style.display = 'none';
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    console.log('WaveParticles: Creating canvas with', swellData.wave_data.length, 'wave points');
    
    // Create or get custom Leaflet pane for particles
    let particlePane = map.getPane('particlePane');
    if (!particlePane) {
      particlePane = map.createPane('particlePane');
      particlePane.style.zIndex = '650'; // Between markers (600) and popups (700)
      particlePane.style.pointerEvents = 'none';
      console.log('WaveParticles: Created custom Leaflet pane', { zIndex: particlePane.style.zIndex });
    }
    
    // Create canvas overlay
    let canvas = canvasRef.current;
    
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      canvas.id = 'wave-particle-canvas';
      canvasRef.current = canvas;
      particlePane.appendChild(canvas);
      console.log('WaveParticles: Canvas appended to custom pane', {
        paneZIndex: particlePane.style.zIndex,
        canvasId: canvas.id
      });
    }
    
    const mapContainer = map.getContainer();

    canvas.style.display = 'block';
    canvas.width = mapContainer.offsetWidth;
    canvas.height = mapContainer.offsetHeight;

    const ctx = canvas.getContext('2d');
    const particles = [];
    const numParticles = 2500;
    const maxAge = 120; // Longer lifespan for wave particles
    const fadeOpacity = 0.03; // Low opacity for trail effect (was 0.97 which covered everything!)

    // Wave color scheme (based on wave height)
    const getWaveColor = (height) => {
      if (height < 2) return 'rgba(144, 238, 144, 0.6)';  // Light green (small)
      if (height < 4) return 'rgba(135, 206, 250, 0.6)';  // Sky blue (moderate)
      if (height < 6) return 'rgba(255, 215, 0, 0.6)';    // Gold (good)
      if (height < 8) return 'rgba(255, 140, 0, 0.6)';    // Dark orange (big)
      return 'rgba(220, 20, 60, 0.6)';                    // Crimson (huge)
    };

    // Initialize particles
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        age: Math.random() * maxAge,
        size: 1 + Math.random() * 1 // Variable particle size
      });
    }
    particlesRef.current = particles;

    // Get swell at position
    const getSwellAt = (lat, lon) => {
      // Find nearest swell data point
      let nearest = null;
      let minDist = Infinity;

      for (const wave of swellData.wave_data) {
        const dist = Math.sqrt(
          Math.pow(wave.lat - lat, 2) + 
          Math.pow(wave.lon - lon, 2)
        );
        if (dist < minDist) {
          minDist = dist;
          nearest = wave;
        }
      }

      if (!nearest || minDist > 1.5) {
        return { direction: 0, height: 0, period: 0 };
      }

      return {
        direction: nearest.direction_deg || 0,
        height: nearest.wave_height_ft || 0,
        period: nearest.period_sec || 10
      };
    };

    // Convert pixel to lat/lon
    const pixelToLatLng = (x, y) => {
      return map.containerPointToLatLng([x, y]);
    };

    // Animation loop
    const animate = () => {
      // Fade effect for trails
      ctx.fillStyle = `rgba(255, 255, 255, ${fadeOpacity})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Update and draw particles
      particles.forEach(particle => {
        // Get lat/lon of particle
        const latLng = pixelToLatLng(particle.x, particle.y);
        
        // Get swell at position
        const swell = getSwellAt(latLng.lat, latLng.lng);
        
        // Convert swell direction to velocity
        // Wave direction is "from", so we move particles in that direction
        const directionRad = (swell.direction * Math.PI) / 180;
        
        // Speed based on wave period (longer period = faster/more powerful)
        const speed = Math.max(0.5, swell.period / 10) * 1.2;
        
        // Move particle in swell direction
        particle.x += Math.sin(directionRad) * speed;
        particle.y -= Math.cos(directionRad) * speed; // Negative for screen coords
        
        // Add slight wave motion (oscillation)
        const oscillation = Math.sin(particle.age * 0.1) * 0.5;
        particle.x += oscillation * Math.cos(directionRad);
        particle.y += oscillation * Math.sin(directionRad);
        
        particle.age++;

        // Respawn if too old or out of bounds
        if (particle.age > maxAge || 
            particle.x < 0 || particle.x > canvas.width ||
            particle.y < 0 || particle.y > canvas.height) {
          particle.x = Math.random() * canvas.width;
          particle.y = Math.random() * canvas.height;
          particle.age = 0;
          particle.size = 1 + Math.random() * 1;
        }

        // Draw particle
        const opacity = 1 - (particle.age / maxAge);
        const color = getWaveColor(swell.height);
        ctx.fillStyle = color.replace('0.6', opacity * 0.8);
        
        // Draw elongated particle (more wave-like)
        ctx.beginPath();
        ctx.ellipse(
          particle.x, 
          particle.y, 
          particle.size * 1.5, // Width
          particle.size * 0.8,  // Height (elongated)
          directionRad,          // Rotation to match swell direction
          0, 
          2 * Math.PI
        );
        ctx.fill();
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    // Start animation
    animate();

    // Update canvas on map move/zoom
    const updateCanvas = () => {
      canvas.width = mapContainer.offsetWidth;
      canvas.height = mapContainer.offsetHeight;
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
  }, [map, swellData, visible]);

  return null;
};

export default WaveParticles;

