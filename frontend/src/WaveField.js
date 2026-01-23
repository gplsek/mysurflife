import { useRef } from 'react';

class WaveField {
  constructor(vectors) {
    if (!vectors || vectors.length === 0) {
      this.valid = false;
      return;
    }

    this.valid = true;
    this.lats = Array.from(new Set(vectors.map(v => v.lat))).sort((a, b) => a - b);
    this.lons = Array.from(new Set(vectors.map(v => v.lon))).sort((a, b) => a - b);

    this.minLat = Math.min(...this.lats);
    this.maxLat = Math.max(...this.lats);
    this.minLon = Math.min(...this.lons);
    this.maxLon = Math.max(...this.lons);

    this.hsGrid = Array(this.lats.length).fill(0).map(() => Array(this.lons.length).fill(null));
    this.dirGrid = Array(this.lats.length).fill(0).map(() => Array(this.lons.length).fill(null));

    const latMap = new Map(this.lats.map((lat, i) => [lat, i]));
    const lonMap = new Map(this.lons.map((lon, i) => [lon, i]));

    // Collect all hs values for stats
    const hsValues = [];
    const dirValues = [];

    vectors.forEach(v => {
      const latIdx = latMap.get(v.lat);
      const lonIdx = lonMap.get(v.lon);
      if (latIdx !== undefined && lonIdx !== undefined) {
        // Include all points (even with null hs) to ensure bounds cover full expanded bbox
        // null hs values will remain null in the grid, which is fine for interpolation
        if (v.hs != null && !isNaN(v.hs)) {
          this.hsGrid[latIdx][lonIdx] = v.hs;
          hsValues.push(v.hs);
        }
        // dir_deg can be null/NaN, use default if needed
        if (v.dir_deg != null && !isNaN(v.dir_deg)) {
          this.dirGrid[latIdx][lonIdx] = v.dir_deg;
          dirValues.push(v.dir_deg);
        }
      }
    });

    // Compute stats (Task S3)
    this.minHs = hsValues.length > 0 ? Math.min(...hsValues) : 0;
    this.maxHs = hsValues.length > 0 ? Math.max(...hsValues) : 0;
    this.minDir = dirValues.length > 0 ? Math.min(...dirValues) : 0;
    this.maxDir = dirValues.length > 0 ? Math.max(...dirValues) : 0;
    this.vectorCount = vectors.length;
  }

  /**
   * Get debug stats (Task S3)
   */
  debugStats() {
    if (!this.valid) {
      return { valid: false };
    }
    return {
      valid: true,
      vectorCount: this.vectorCount,
      minHs: this.minHs,
      maxHs: this.maxHs,
      minDir: this.minDir,
      maxDir: this.maxDir,
      bounds: {
        minLat: this.minLat,
        maxLat: this.maxLat,
        minLon: this.minLon,
        maxLon: this.maxLon
      },
      gridSize: {
        latCount: this.lats.length,
        lonCount: this.lons.length
      }
    };
  }

  // Helper to find index in a sorted array
  _findIndex(arr, val) {
    let low = 0, high = arr.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (arr[mid] === val) return mid;
      if (arr[mid] < val) low = mid + 1;
      else high = mid - 1;
    }
    return low - 1; // Returns index of largest element <= val
  }

  /**
   * Bilinear interpolation of wave height and direction at given lat/lon
   * Returns {hs, dir_deg} or null if outside bounds
   */
  interpolate(lat, lon) {
    if (!this.valid) return null;

    // Check bounds - allow small extrapolation beyond bounds (0.5° = ~55km)
    // This allows rendering when zoomed out beyond data bounds
    const latMargin = 0.5;
    const lonMargin = 0.5;
    if (lat < this.minLat - latMargin || lat > this.maxLat + latMargin || 
        lon < this.minLon - lonMargin || lon > this.maxLon + lonMargin) {
      return null; // Too far outside bounds
    }
    
    // If slightly outside bounds, clamp to bounds for index lookup
    const clampedLat = Math.max(this.minLat, Math.min(this.maxLat, lat));
    const clampedLon = Math.max(this.minLon, Math.min(this.maxLon, lon));

    // Find surrounding grid cell indices (use clamped coordinates)
    const latIdx0 = this._findIndex(this.lats, clampedLat);
    const lonIdx0 = this._findIndex(this.lons, clampedLon);

    if (latIdx0 < 0 || lonIdx0 < 0 || latIdx0 >= this.lats.length - 1 || lonIdx0 >= this.lons.length - 1) {
      // Handle exact matches or points very close to the edge
      const latExact = this.lats.findIndex(l => Math.abs(l - lat) < 0.001);
      const lonExact = this.lons.findIndex(l => Math.abs(l - lon) < 0.001);
      
      if (latExact !== -1 && lonExact !== -1) {
        const hs = this.hsGrid[latExact][lonExact];
        const dir = this.dirGrid[latExact][lonExact];
        if (hs !== null && dir !== null) {
          return { hs, dir_deg: dir };
        }
      }
      return null;
    }

    const latIdx1 = latIdx0 + 1;
    const lonIdx1 = lonIdx0 + 1;

    const lat0 = this.lats[latIdx0];
    const lat1 = this.lats[latIdx1];
    const lon0 = this.lons[lonIdx0];
    const lon1 = this.lons[lonIdx1];

    // Get hs/dir values at the four corners
    const hs00 = this.hsGrid[latIdx0][lonIdx0];
    const hs01 = this.hsGrid[latIdx0][lonIdx1];
    const hs10 = this.hsGrid[latIdx1][lonIdx0];
    const hs11 = this.hsGrid[latIdx1][lonIdx1];

    const dir00 = this.dirGrid[latIdx0][lonIdx0];
    const dir01 = this.dirGrid[latIdx0][lonIdx1];
    const dir10 = this.dirGrid[latIdx1][lonIdx0];
    const dir11 = this.dirGrid[latIdx1][lonIdx1];

    // Calculate interpolation weights
    const xWeight = (lon - lon0) / (lon1 - lon0);
    const yWeight = (lat - lat0) / (lat1 - lat0);

    // Improved: Handle NaN corners by reweighting remaining valid corners
    // This fills near-shore gaps by using available ocean data
    const cornerData = [
      { hs: hs00, dir: dir00, weight: (1 - xWeight) * (1 - yWeight) },
      { hs: hs01, dir: dir01, weight: xWeight * (1 - yWeight) },
      { hs: hs10, dir: dir10, weight: (1 - xWeight) * yWeight },
      { hs: hs11, dir: dir11, weight: xWeight * yWeight }
    ];
    
    const validCorners = cornerData.filter(c => c.hs !== null && c.dir !== null);
    
    // If no valid corners, return null
    if (validCorners.length === 0) {
      return null;
    }
    
    // If all corners valid, use standard bilinear interpolation
    if (validCorners.length === 4) {
      // Standard bilinear interpolation
      const hs = (hs00 * (1 - xWeight) + hs01 * xWeight) * (1 - yWeight) +
                 (hs10 * (1 - xWeight) + hs11 * xWeight) * yWeight;

      // For direction, handle circular interpolation (0-360 degrees)
      const dirToRad = (d) => (d * Math.PI) / 180;
      const radToDir = (r) => ((r * 180) / Math.PI + 360) % 360;
      
      const dir00Rad = dirToRad(dir00);
      const dir01Rad = dirToRad(dir01);
      const dir10Rad = dirToRad(dir10);
      const dir11Rad = dirToRad(dir11);
      
      // Interpolate direction as unit vectors
      const u00 = Math.sin(dir00Rad);
      const v00 = Math.cos(dir00Rad);
      const u01 = Math.sin(dir01Rad);
      const v01 = Math.cos(dir01Rad);
      const u10 = Math.sin(dir10Rad);
      const v10 = Math.cos(dir10Rad);
      const u11 = Math.sin(dir11Rad);
      const v11 = Math.cos(dir11Rad);
      
      const u = (u00 * (1 - xWeight) + u01 * xWeight) * (1 - yWeight) +
                (u10 * (1 - xWeight) + u11 * xWeight) * yWeight;
      const v = (v00 * (1 - xWeight) + v01 * xWeight) * (1 - yWeight) +
                (v10 * (1 - xWeight) + v11 * xWeight) * yWeight;
      
      const dir_deg = radToDir(Math.atan2(u, v));

      return { hs, dir_deg };
    }
    
    // If some corners are NaN, reweight remaining valid corners
    // This fills near-shore gaps by using available ocean data
    let totalWeight = 0;
    for (const corner of validCorners) {
      totalWeight += corner.weight;
    }
    
    if (totalWeight === 0) {
      return null;
    }
    
    let hsSum = 0;
    let dirSumU = 0;
    let dirSumV = 0;
    
    const dirToRad = (d) => (d * Math.PI) / 180;
    const radToDir = (r) => ((r * 180) / Math.PI + 360) % 360;
    
    for (const corner of validCorners) {
      // Normalize weight by total valid weight
      const normalizedWeight = corner.weight / totalWeight;
      hsSum += corner.hs * normalizedWeight;
      
      // Direction as unit vector
      const dirRad = dirToRad(corner.dir);
      dirSumU += Math.sin(dirRad) * normalizedWeight;
      dirSumV += Math.cos(dirRad) * normalizedWeight;
    }
    
    const hs = hsSum;
    const dir_deg = radToDir(Math.atan2(dirSumU, dirSumV));
    
    return { hs, dir_deg };
  }
  
  /**
   * Near-shore extrapolation: Search for nearest valid ocean cells when point is NaN
   * This fills the missing near-shore band by pulling data from nearby valid cells
   */
  getHsWithExtrapolation(lat, lon, searchRadius = 0.1, maxCells = 4) {
    // First try standard interpolation
    let hs = this.getHs(lat, lon);
    if (hs !== null) {
      return hs;
    }
    
    // If null, search for nearest valid cells (extrapolation for near-shore band OR areas outside data bounds)
    // Use adaptive search step based on radius for better coverage
    const searchStep = Math.max(0.02, searchRadius / 10); // Adaptive step size
    const maxDist = searchRadius;
    
    let nearestHs = null;
    let nearestDist = Infinity;
    let cellsChecked = 0;
    
    // Search in expanding rings
    for (let radius = searchStep; radius <= maxDist && cellsChecked < maxCells * 10; radius += searchStep) {
      const steps = Math.max(4, Math.floor(radius / searchStep * 2)); // More steps for larger radius
      
      for (let step = 0; step < steps && cellsChecked < maxCells * 10; step++) {
        const angle = (step / steps) * Math.PI * 2;
        const searchLat = lat + Math.cos(angle) * radius;
        const searchLng = lon + Math.sin(angle) * radius;
        
        // Check bounds
        if (searchLat < this.minLat || searchLat > this.maxLat ||
            searchLng < this.minLon || searchLng > this.maxLon) {
          continue;
        }
        
        const searchHs = this.getHs(searchLat, searchLng);
        cellsChecked++;
        
        if (searchHs !== null) {
          const dist = Math.sqrt(
            Math.pow(searchLat - lat, 2) + 
            Math.pow(searchLng - lon, 2)
          );
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestHs = searchHs;
          }
          
          // If we found a close valid cell, use it (with distance-based fade)
          if (nearestDist < searchRadius * 0.5) {
            const fadeFactor = Math.max(0, 1.0 - (nearestDist / (searchRadius * 0.5)));
            return nearestHs * fadeFactor;
          }
        }
      }
    }
    
    // Return nearest found value (if any) with fade
    if (nearestHs !== null && nearestDist < maxDist) {
      const fadeFactor = Math.max(0, 1.0 - (nearestDist / maxDist));
      return nearestHs * fadeFactor;
    }
    
    return null;
  }

  getVector(lat, lon) {
    return this.interpolate(lat, lon);
  }

  getHs(lat, lon) {
    // Task S3: Return null (not 0) if outside bounds
    if (!this.valid) return null;
    
    // Check bounds - allow small extrapolation beyond bounds (0.5° = ~55km)
    // This allows rendering when zoomed out beyond data bounds
    const latMargin = 0.5;
    const lonMargin = 0.5;
    if (lat < this.minLat - latMargin || lat > this.maxLat + latMargin || 
        lon < this.minLon - lonMargin || lon > this.maxLon + lonMargin) {
      return null; // Too far outside bounds
    }
    
    const vec = this.interpolate(lat, lon);
    return vec ? vec.hs : null;
  }

  getDir(lat, lon) {
    const vec = this.interpolate(lat, lon);
    return vec ? vec.dir_deg : null;
  }
}

export default WaveField;

