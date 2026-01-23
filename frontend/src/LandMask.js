/**
 * LandMask - GeoJSON-based land polygon masking for wave overlays
 *
 * Uses Natural Earth land polygons to create pixel-perfect coastline masks
 * matching Windy.com's rendering strategy.
 *
 * Strategy:
 * 1. Load Natural Earth 10m/50m land GeoJSON once
 * 2. Convert lat/lng coordinates to canvas pixel space
 * 3. Use canvas clipping to mask land areas
 * 4. Render waves everywhere, land stays transparent (cut out)
 */

class LandMask {
  constructor() {
    this.landGeoJSON = null;
    this.loaded = false;
    this.loading = false;
    this.loadPromise = null;
  }

  /**
   * Load Natural Earth land polygons from public/geojson directory
   * Caches the result for subsequent calls
   */
  async load() {
    if (this.loaded) {
      return this.landGeoJSON;
    }

    if (this.loading) {
      return this.loadPromise;
    }

    this.loading = true;
    this.loadPromise = (async () => {
      try {
        console.log('🗺️ Loading Natural Earth land polygons...');

        // Try 50m first (faster load: 1.6MB vs 9.7MB for 10m)
        // 50m resolution is sufficient for web map coastline masking
        let response;
        let resolution = '50m';
        try {
          response = await fetch('/geojson/ne_50m_land.geojson');
          if (!response.ok) throw new Error('50m not found');
        } catch (e) {
          console.log('🗺️ 50m not found, trying 10m...');
          resolution = '10m';
          response = await fetch('/geojson/ne_10m_land.geojson');
        }

        if (!response.ok) {
          throw new Error(`Failed to load land polygons: ${response.status}`);
        }

        this.landGeoJSON = await response.json();
        this.loaded = true;
        this.loading = false;

        console.log(`✅ Loaded ${this.landGeoJSON.features.length} land polygons (${resolution} resolution)`);
        return this.landGeoJSON;
      } catch (error) {
        console.error('❌ Failed to load land polygons:', error);
        this.loading = false;
        // Return empty GeoJSON to avoid breaking the app
        this.landGeoJSON = { type: 'FeatureCollection', features: [] };
        this.loaded = true;
        return this.landGeoJSON;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Create a canvas clipping path for land polygons within the current map view
   * This creates a "negative" mask - everything inside the path is land (transparent)
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {L.Map} map - Leaflet map instance
   * @param {Object} bounds - Map bounds {north, south, east, west}
   * @returns {boolean} - True if clipping path was created
   */
  createClipPath(ctx, map, bounds) {
    if (!this.loaded || !this.landGeoJSON) {
      return false;
    }

    const { north, south, east, west } = bounds;
    let hasLand = false;

    // Begin path for all land polygons
    ctx.beginPath();

    // Process each land feature
    for (const feature of this.landGeoJSON.features) {
      if (feature.geometry.type === 'Polygon') {
        this._addPolygonToPath(ctx, map, feature.geometry.coordinates, bounds);
        hasLand = true;
      } else if (feature.geometry.type === 'MultiPolygon') {
        for (const polygon of feature.geometry.coordinates) {
          this._addPolygonToPath(ctx, map, polygon, bounds);
          hasLand = true;
        }
      }
    }

    return hasLand;
  }

  /**
   * Add a single polygon to the canvas path
   * GeoJSON format: [[[lng, lat], [lng, lat], ...]] (outer ring + holes)
   */
  _addPolygonToPath(ctx, map, coordinates, bounds) {
    // coordinates[0] is the outer ring
    // coordinates[1+] are holes (islands, etc.)

    for (let ringIndex = 0; ringIndex < coordinates.length; ringIndex++) {
      const ring = coordinates[ringIndex];

      // Skip if ring has too few points
      if (ring.length < 3) continue;

      // Check if any part of this ring is in viewport (quick bbox check)
      const inView = ring.some(([lng, lat]) => {
        return lat >= bounds.south && lat <= bounds.north &&
               lng >= bounds.west && lng <= bounds.east;
      });

      // Skip rings that are completely outside viewport
      if (!inView) continue;

      // Convert first point
      const [firstLng, firstLat] = ring[0];
      const firstPoint = map.latLngToContainerPoint([firstLat, firstLng]);
      ctx.moveTo(firstPoint.x, firstPoint.y);

      // Add remaining points
      for (let i = 1; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        const point = map.latLngToContainerPoint([lat, lng]);
        ctx.lineTo(point.x, point.y);
      }

      // Close the ring
      ctx.closePath();
    }
  }

  /**
   * Apply land mask to canvas using clipping
   * After calling this, any drawing will be clipped to ocean areas only
   *
   * Usage:
   *   landMask.applyMask(ctx, map);
   *   // ... draw waves ...
   *   ctx.restore(); // Remove mask
   */
  applyMask(ctx, map) {
    if (!this.loaded) return false;

    const bounds = map.getBounds();
    const boundsObj = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest()
    };

    // Save context state
    ctx.save();

    // Create clipping path for land
    const hasLand = this.createClipPath(ctx, map, boundsObj);

    if (hasLand) {
      // Invert the clip: we want to draw waves (NOT land)
      // Strategy: Create full canvas rectangle, then subtract land
      const size = map.getSize();

      // Start with full canvas as path
      ctx.rect(0, 0, size.x, size.y);

      // Land polygons are already added to path
      // Use 'evenodd' rule to create inverse clip
      ctx.clip('evenodd');

      return true;
    }

    return false;
  }

  /**
   * Check if a point is over land (for probe/fill-in logic)
   * More accurate than coastline approximation
   */
  isLand(lat, lng) {
    if (!this.loaded || !this.landGeoJSON) {
      return false; // Default to water if data not loaded
    }

    // Point-in-polygon test for all land features
    for (const feature of this.landGeoJSON.features) {
      if (feature.geometry.type === 'Polygon') {
        if (this._pointInPolygon([lng, lat], feature.geometry.coordinates)) {
          return true;
        }
      } else if (feature.geometry.type === 'MultiPolygon') {
        for (const polygon of feature.geometry.coordinates) {
          if (this._pointInPolygon([lng, lat], polygon)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Point-in-polygon test using ray casting algorithm
   * coordinates: [[[lng, lat], ...]] (outer ring + holes)
   */
  _pointInPolygon(point, coordinates) {
    const [lng, lat] = point;

    // Test outer ring (coordinates[0])
    const outerRing = coordinates[0];
    let inside = this._raycast(lng, lat, outerRing);

    // If inside outer ring, check holes (coordinates[1+])
    if (inside) {
      for (let i = 1; i < coordinates.length; i++) {
        const hole = coordinates[i];
        if (this._raycast(lng, lat, hole)) {
          inside = false; // Point is in a hole
          break;
        }
      }
    }

    return inside;
  }

  /**
   * Ray casting algorithm for point-in-polygon test
   */
  _raycast(x, y, ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];

      const intersect = ((yi > y) !== (yj > y)) &&
                       (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }
}

// Singleton instance
const landMask = new LandMask();

export default landMask;
