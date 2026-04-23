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
    showBuoys:  true,
    showStorms: true,
    favsOnly:   false,
    query:      '',
  });

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const toggleState = (key) => setState(s => ({ ...s, [key]: !s[key] }));
  const setRegion = (id) => {
    try { localStorage.setItem(REGION_KEY, id); } catch {}
    setState(s => ({ ...s, region: id }));
  };
  const setQuery = (q) => setState(s => ({ ...s, query: q }));

  return { state, stateRef, toggleState, setRegion, setQuery };
}
