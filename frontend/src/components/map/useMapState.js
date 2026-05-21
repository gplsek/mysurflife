import { useState, useRef, useEffect } from 'react';

const REGION_KEY = 'msl_map_region';

function readSavedRegion() {
  try { return localStorage.getItem(REGION_KEY) || 'all'; }
  catch { return 'all'; }
}

export function useMapState() {
  const [state, setState] = useState({
    region:     readSavedRegion(),
    showSpots:  true,
    showBuoys:  false,
    showStorms: false,
    stormStrength: 'all',   // all | gale | storm | hurricane (client-side filter)
    favsOnly:   false,
    query:      '',
  });

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const toggleState = (key) => setState(s => {
    const next = !s[key];
    // Spots and buoys are mutually exclusive — too busy together
    if (key === 'showSpots' && next) return { ...s, showSpots: true, showBuoys: false };
    if (key === 'showBuoys' && next) return { ...s, showBuoys: true, showSpots: false };
    return { ...s, [key]: next };
  });
  const setRegion = (id) => {
    try { localStorage.setItem(REGION_KEY, id); } catch {}
    setState(s => ({ ...s, region: id }));
  };
  const setQuery = (q) => setState(s => ({ ...s, query: q }));
  const setStormStrength = (level) => setState(s => ({ ...s, stormStrength: level }));

  return { state, stateRef, toggleState, setRegion, setQuery, setStormStrength };
}
