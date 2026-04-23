const GRID = 55;

export function buildClusters(visibleSpots, map) {
  const cells = new Map();
  for (const spot of visibleSpots) {
    const pt = map.latLngToContainerPoint([spot.latitude, spot.longitude]);
    const key = `${Math.floor(pt.x / GRID)},${Math.floor(pt.y / GRID)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(spot);
  }
  return cells;
}
