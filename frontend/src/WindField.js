/**
 * WindField - Structured grid with bilinear interpolation for wind vectors
 * 
 * Takes windData.vectors and builds a grid that can interpolate u/v components
 * at any lat/lon point within the data bounds.
 */

class WindField {
  constructor(vectors) {
    if (!vectors || vectors.length === 0) {
      this.valid = false;
      return;
    }

    // Extract unique, sorted lat/lon arrays
    const latSet = new Set();
    const lonSet = new Set();
    
    vectors.forEach(v => {
      latSet.add(v.lat);
      lonSet.add(v.lon);
    });

    this.lats = Array.from(latSet).sort((a, b) => a - b);
    this.lons = Array.from(lonSet).sort((a, b) => a - b);

    // Build 2D grids for u and v components
    this.uGrid = Array(this.lats.length).fill(null).map(() => Array(this.lons.length).fill(null));
    this.vGrid = Array(this.lats.length).fill(null).map(() => Array(this.lons.length).fill(null));
    this.speedGrid = Array(this.lats.length).fill(null).map(() => Array(this.lons.length).fill(null));

    // Create lookup map for fast access
    const latIndexMap = new Map();
    const lonIndexMap = new Map();
    this.lats.forEach((lat, i) => latIndexMap.set(lat, i));
    this.lons.forEach((lon, i) => lonIndexMap.set(lon, i));

    // Populate grids
    vectors.forEach(v => {
      const latIdx = latIndexMap.get(v.lat);
      const lonIdx = lonIndexMap.get(v.lon);
      
      if (latIdx !== undefined && lonIdx !== undefined) {
        this.uGrid[latIdx][lonIdx] = v.u_component || 0;
        this.vGrid[latIdx][lonIdx] = v.v_component || 0;
        this.speedGrid[latIdx][lonIdx] = v.speed_kts || 0;
      }
    });

    // Calculate bounds
    this.minLat = Math.min(...this.lats);
    this.maxLat = Math.max(...this.lats);
    this.minLon = Math.min(...this.lons);
    this.maxLon = Math.max(...this.lons);

    this.valid = true;
  }

  /**
   * Bilinear interpolation of u/v components at given lat/lon
   * Returns {u, v, speedKts} or null if outside bounds
   */
  interpolate(lat, lon) {
    if (!this.valid) return null;

    // Check bounds
    if (lat < this.minLat || lat > this.maxLat || 
        lon < this.minLon || lon > this.maxLon) {
      return null;
    }

    // Find surrounding grid cell indices
    let latIdx0 = -1;
    let latIdx1 = -1;
    
    // Handle edge case: exactly on first or last point
    if (lat <= this.lats[0]) {
      latIdx0 = 0;
      latIdx1 = this.lats.length > 1 ? 1 : 0;
    } else if (lat >= this.lats[this.lats.length - 1]) {
      latIdx0 = this.lats.length - 2;
      latIdx1 = this.lats.length - 1;
    } else {
      for (let i = 0; i < this.lats.length - 1; i++) {
        if (this.lats[i] <= lat && lat <= this.lats[i + 1]) {
          latIdx0 = i;
          latIdx1 = i + 1;
          break;
        }
      }
    }

    let lonIdx0 = -1;
    let lonIdx1 = -1;
    
    // Handle edge case: exactly on first or last point
    if (lon <= this.lons[0]) {
      lonIdx0 = 0;
      lonIdx1 = this.lons.length > 1 ? 1 : 0;
    } else if (lon >= this.lons[this.lons.length - 1]) {
      lonIdx0 = this.lons.length - 2;
      lonIdx1 = this.lons.length - 1;
    } else {
      for (let i = 0; i < this.lons.length - 1; i++) {
        if (this.lons[i] <= lon && lon <= this.lons[i + 1]) {
          lonIdx0 = i;
          lonIdx1 = i + 1;
          break;
        }
      }
    }

    // If we still can't find indices, try exact match
    if (latIdx0 === -1 || lonIdx0 === -1) {
      const latExact = this.lats.findIndex(l => Math.abs(l - lat) < 0.001);
      const lonExact = this.lons.findIndex(l => Math.abs(l - lon) < 0.001);
      
      if (latExact !== -1 && lonExact !== -1) {
        const u = this.uGrid[latExact][lonExact];
        const v = this.vGrid[latExact][lonExact];
        const speed = this.speedGrid[latExact][lonExact];
        if (u !== null && v !== null) {
          return { u, v, speedKts: speed || 0 };
        }
      }
      return null;
    }

    // Get corner values
    const u00 = this.uGrid[latIdx0][lonIdx0];
    const u01 = this.uGrid[latIdx0][lonIdx1];
    const u10 = this.uGrid[latIdx1][lonIdx0];
    const u11 = this.uGrid[latIdx1][lonIdx1];

    const v00 = this.vGrid[latIdx0][lonIdx0];
    const v01 = this.vGrid[latIdx0][lonIdx1];
    const v10 = this.vGrid[latIdx1][lonIdx0];
    const v11 = this.vGrid[latIdx1][lonIdx1];

    // Check if we have valid data at all corners
    if (u00 === null || u01 === null || u10 === null || u11 === null ||
        v00 === null || v01 === null || v10 === null || v11 === null) {
      return null;
    }

    // Bilinear interpolation weights
    const lat0 = this.lats[latIdx0];
    const lat1 = this.lats[latIdx1];
    const lon0 = this.lons[lonIdx0];
    const lon1 = this.lons[lonIdx1];

    const tLat = (lat - lat0) / (lat1 - lat0);
    const tLon = (lon - lon0) / (lon1 - lon0);

    // Interpolate u
    const u0 = u00 * (1 - tLon) + u01 * tLon;
    const u1 = u10 * (1 - tLon) + u11 * tLon;
    const u = u0 * (1 - tLat) + u1 * tLat;

    // Interpolate v
    const v0 = v00 * (1 - tLon) + v01 * tLon;
    const v1 = v10 * (1 - tLon) + v11 * tLon;
    const v = v0 * (1 - tLat) + v1 * tLat;

    // Calculate speed from interpolated u/v
    const speedKts = Math.sqrt(u * u + v * v) * 1.94384; // m/s to knots

    return { u, v, speedKts };
  }

  /**
   * Get wind speed at a point (convenience method)
   */
  getSpeed(lat, lon) {
    const vec = this.interpolate(lat, lon);
    return vec ? vec.speedKts : null;
  }

  /**
   * Get wind vector at a point (convenience method)
   */
  getVector(lat, lon) {
    return this.interpolate(lat, lon);
  }
}

export default WindField;

