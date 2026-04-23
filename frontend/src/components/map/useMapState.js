import { useState, useRef, useEffect } from 'react';

export function useMapState() {
  const [state, setState] = useState({
    region:     'all',
    showSpots:  true,
    showBuoys:  true,
    showStorms: true,
    favsOnly:   false,
    query:      '',
  });

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const toggleState = (key) => setState(s => ({ ...s, [key]: !s[key] }));
  const setRegion   = (id)  => setState(s => ({ ...s, region: id }));
  const setQuery    = (q)   => setState(s => ({ ...s, query: q }));

  return { state, stateRef, toggleState, setRegion, setQuery };
}
