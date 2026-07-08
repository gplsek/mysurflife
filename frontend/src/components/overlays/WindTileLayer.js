/**
 * WindTileLayer.js — imperative controller for the server-baked wind tile layer.
 *
 * Portable: mounted by pages/MapLab.jsx today, pages/Map.jsx in Phase D.
 * Tiles are pre-colored PNGs from /api/tiles/wind (ramp baked server-side from
 * backend/config/ramps.json) — the browser only blits pixels.
 */
import L from 'leaflet';

// Override for CDN cutover or non-default backend port during development.
export const TILE_API_BASE = process.env.REACT_APP_TILE_API || '';

export function windTileUrl({ model, run, hour, variable = 'speed' }) {
  const query = variable === 'speed' ? '' : `?var=${variable}`;
  return `${TILE_API_BASE}/api/tiles/wind/${model}/${run}/${hour}/{z}/{x}/{y}.png${query}`;
}

export async function fetchWindManifest(model = 'gfs') {
  const resp = await fetch(`${TILE_API_BASE}/api/tiles/wind/${model}/runs`);
  if (!resp.ok) throw new Error(`wind manifest ${resp.status}`);
  return resp.json();
}

export class WindTileController {
  constructor(map, { opacity = 0.8, maxNativeZoom = 7, zIndex = 210, onLoading, onLoad } = {}) {
    this.map = map;
    this.opacity = opacity;
    this.maxNativeZoom = maxNativeZoom;
    this.zIndex = zIndex;
    this.onLoading = onLoading;
    this.onLoad = onLoad;
    this.layer = null;
    this.frame = null;
  }

  setFrame(frame) {
    const url = windTileUrl(frame);
    this.frame = frame;
    if (!this.layer) {
      this.layer = L.tileLayer(url, {
        opacity: this.opacity,
        zIndex: this.zIndex,
        maxNativeZoom: this.maxNativeZoom,
        maxZoom: 18,
        tileSize: 256,
        crossOrigin: true,
        updateWhenZooming: false,
        keepBuffer: 4,
        className: 'wind-tile-layer',
      });
      if (this.onLoading) this.layer.on('loading', this.onLoading);
      if (this.onLoad) this.layer.on('load', this.onLoad);
      this.layer.addTo(this.map);
    } else {
      // setUrl keeps the current tiles visible until replacements decode,
      // so scrubbing reads as a crossfade rather than a blank flash.
      this.layer.setUrl(url);
    }
  }

  setOpacity(opacity) {
    this.opacity = opacity;
    if (this.layer) this.layer.setOpacity(opacity);
  }

  remove() {
    if (this.layer) {
      this.layer.off();
      this.layer.remove();
      this.layer = null;
    }
  }
}

/**
 * Warm the browser HTTP cache for the tiles currently in view at another
 * forecast hour, so scrubbing to hour±N paints instantly.
 */
export function prefetchFrame(map, frame, { maxNativeZoom = 7 } = {}) {
  const zoom = Math.min(map.getZoom(), maxNativeZoom);
  const n = 2 ** zoom;
  const bounds = map.getBounds();

  const lonToX = (lon) => Math.floor(((lon + 180) / 360) * n);
  const latToY = (lat) => {
    const rad = (lat * Math.PI) / 180;
    const yn = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
    return Math.floor(yn * n);
  };

  const x0 = lonToX(bounds.getWest());
  const x1 = lonToX(bounds.getEast());
  const y0 = Math.max(0, latToY(bounds.getNorth()));
  const y1 = Math.min(n - 1, latToY(bounds.getSouth()));

  const template = windTileUrl(frame);
  let count = 0;
  for (let x = x0; x <= x1 && count < 32; x++) {
    for (let y = y0; y <= y1 && count < 32; y++) {
      const url = template
        .replace('{z}', zoom)
        .replace('{x}', ((x % n) + n) % n)
        .replace('{y}', y);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      count += 1;
    }
  }
}
