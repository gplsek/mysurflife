import { useState, useRef, useEffect, useCallback } from 'react';

const REFRESH_INTERVAL = 60_000;

async function _authHeaders() {
  try {
    const { getAuthHeaders } = await import('../../supabaseClient');
    return await getAuthHeaders();
  } catch {
    return {};
  }
}

export function useMapBundle() {
  const [spots,     setSpots]     = useState([]);
  const [buoys,     setBuoys]     = useState([]);
  const [storms,    setStorms]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const spotsRef  = useRef(spots);
  const buoysRef  = useRef(buoys);
  const stormsRef = useRef(storms);
  useEffect(() => { spotsRef.current  = spots;  }, [spots]);
  useEffect(() => { buoysRef.current  = buoys;  }, [buoys]);
  useEffect(() => { stormsRef.current = storms; }, [storms]);

  const fetchBundle = useCallback(async (signal) => {
    try {
      const res = await fetch('/api/map/bundle?include_storms=true&include_buoys=true', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSpots(data.spots  || []);
      setBuoys(data.buoys  || []);
      setStorms(data.storms || []);
      setUpdatedAt(data.updated_at || new Date().toISOString());
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('map/bundle fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchBundle(ctrl.signal);
    const timer = setInterval(() => fetchBundle(ctrl.signal), REFRESH_INTERVAL);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [fetchBundle]);

  const toggleFavorite = useCallback(async (slug) => {
    const current = spotsRef.current.find(s => s.slug === slug);
    if (!current) return;

    const isFav = current.fav;

    // Optimistic update
    setSpots(prev => prev.map(s => s.slug === slug ? { ...s, fav: !isFav } : s));

    try {
      const headers = await _authHeaders();
      if (!headers['Authorization']) return; // not logged in, revert

      let res;
      if (isFav) {
        res = await fetch(`/api/user/favorites/${slug}`, { method: 'DELETE', headers });
      } else {
        res = await fetch('/api/user/favorites', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const favSet = new Set(data.favorites || []);

      // Reconcile with server response
      setSpots(prev => prev.map(s => ({ ...s, fav: favSet.has(s.slug) })));
    } catch (err) {
      // Revert on failure
      console.warn('toggleFavorite failed:', err);
      setSpots(prev => prev.map(s => s.slug === slug ? { ...s, fav: isFav } : s));
    }
  }, []);

  return { spots, buoys, storms, loading, updatedAt, spotsRef, buoysRef, stormsRef, toggleFavorite };
}
